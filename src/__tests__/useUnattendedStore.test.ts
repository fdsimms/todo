import { useUnattendedStore } from '../store/useUnattendedStore';
import {
  dbClearUnattendedLog,
  dbGetUnattendedLog,
  dbInsertUnattendedEntries,
  dbPruneUnattendedLog,
} from '../db/database';
import type { Task, UnattendedEntry } from '../types';

jest.mock('../db/database', () => ({
  dbGetUnattendedLog: jest.fn(() => []),
  dbInsertUnattendedEntries: jest.fn(),
  dbPruneUnattendedLog: jest.fn(),
  dbClearUnattendedLog: jest.fn(),
}));

const mockSettings = { completedRetentionDays: null as number | null, dayResetTime: '00:00' };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.completedRetentionDays = null;
  useUnattendedStore.setState({ entries: [], initialized: false });
});

const state = () => useUnattendedStore.getState();

const generated = (overrides: Partial<Task> = {}) => ({
  id: 't1',
  title: 'Use up Spinach',
  generatedKind: 'groceryUseUp' as const,
  ...overrides,
}) as Pick<Task, 'id' | 'title' | 'generatedKind'>;

const aged = (id: string, at: string): UnattendedEntry => ({
  id, at, action: 'created', kind: 'birthday', title: 'Card for Ada', taskId: 'x', count: 1,
});

describe('record', () => {
  it('writes the entry and holds it, stamping the id and the time itself', () => {
    state().record({ action: 'created', kind: 'weather', title: 'Sunscreen', taskId: 't9' });
    expect(dbInsertUnattendedEntries).toHaveBeenCalledWith([
      expect.objectContaining({ action: 'created', kind: 'weather', title: 'Sunscreen', count: 1 }),
    ]);
    expect(state().entries).toHaveLength(1);
    expect(state().entries[0].id).toBeTruthy();
    expect(state().entries[0].at).toBeTruthy();
  });

  it('defaults the count to one, the answer for everything but a purge', () => {
    state().record({ action: 'expired', kind: null, title: 'Bin day', taskId: 't2' });
    expect(state().entries[0].count).toBe(1);
  });

  it('keeps a purge’s own count', () => {
    state().record({ action: 'purged', kind: null, title: '', taskId: null, count: 40 });
    expect(state().entries[0].count).toBe(40);
  });

  it('holds newest first, matching what the next launch reads back', () => {
    // A list that reorders itself on relaunch is the usual way one of these
    // drifts out of step with its own table.
    state().record({ action: 'created', kind: 'weather', title: 'First', taskId: 'a' });
    state().record({ action: 'created', kind: 'weather', title: 'Second', taskId: 'b' });
    expect(state().entries.map(e => e.title)).toEqual(['Second', 'First']);
  });
});

describe('recordMany', () => {
  it('writes a sweep’s rows under one call', () => {
    state().recordMany([
      { action: 'expired', kind: null, title: 'A', taskId: 'a' },
      { action: 'expired', kind: null, title: 'B', taskId: 'b' },
    ]);
    expect(dbInsertUnattendedEntries).toHaveBeenCalledTimes(1);
    expect(state().entries).toHaveLength(2);
  });

  it('keeps the caller’s order newest-last within the batch', () => {
    state().recordMany([
      { action: 'expired', kind: null, title: 'A', taskId: 'a' },
      { action: 'expired', kind: null, title: 'B', taskId: 'b' },
    ]);
    expect(state().entries.map(e => e.title)).toEqual(['B', 'A']);
  });

  it('does nothing at all for an empty batch', () => {
    state().recordMany([]);
    expect(dbInsertUnattendedEntries).not.toHaveBeenCalled();
  });

  it('never throws into the pass that called it', () => {
    // Every caller is an unattended sweep. An entry lost is a line missing from
    // a screen; an entry that throws is a task that never got written.
    (dbInsertUnattendedEntries as jest.Mock).mockImplementationOnce(() => { throw new Error('disk'); });
    expect(() => state().record({ action: 'created', kind: 'weather', title: 'X', taskId: 'x' })).not.toThrow();
    expect(state().entries).toHaveLength(0);
  });
});

describe('recordGenerated', () => {
  it('reads the kind off the row, so an entry can’t name the wrong generator', () => {
    state().recordGenerated('created', generated());
    expect(state().entries[0]).toMatchObject({
      action: 'created', kind: 'groceryUseUp', title: 'Use up Spinach', taskId: 't1',
    });
  });

  it('refuses a row that isn’t a generated task', () => {
    // A row with no kind was not written by a generator, and the two sweeps
    // record themselves rather than coming through here.
    state().recordGenerated('cleared', generated({ generatedKind: null }));
    expect(state().entries).toHaveLength(0);
    expect(dbInsertUnattendedEntries).not.toHaveBeenCalled();
  });
});

describe('purgeOldEntries', () => {
  it('bounds the ledger even with retention off, which nothing else does', () => {
    const old = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
    useUnattendedStore.setState({ entries: [aged('old', old), aged('new', new Date().toISOString())] });
    expect(state().purgeOldEntries()).toBe(1);
    expect(state().entries.map(e => e.id)).toEqual(['new']);
    expect(dbPruneUnattendedLog).toHaveBeenCalled();
  });

  it('follows a shorter retention window when the user set one', () => {
    mockSettings.completedRetentionDays = 90;
    const fortyDays = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
    useUnattendedStore.setState({ entries: [aged('mid', fortyDays)] });
    // Inside both bounds, so it stays.
    expect(state().purgeOldEntries()).toBe(0);
    expect(dbPruneUnattendedLog).not.toHaveBeenCalled();
  });

  it('deletes by date rather than by the ids it collected', () => {
    // This store's copy is what was loaded at launch; an entry synced in from
    // another device since is equally out of the window.
    const old = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
    useUnattendedStore.setState({ entries: [aged('old', old)] });
    state().purgeOldEntries();
    expect(dbPruneUnattendedLog).toHaveBeenCalledWith(expect.any(String));
  });

  it('writes nothing when there is nothing old enough', () => {
    useUnattendedStore.setState({ entries: [aged('new', new Date().toISOString())] });
    expect(state().purgeOldEntries()).toBe(0);
    expect(dbPruneUnattendedLog).not.toHaveBeenCalled();
  });
});

describe('initialize and clearAll', () => {
  it('loads the ledger and marks itself initialized', () => {
    (dbGetUnattendedLog as jest.Mock).mockReturnValueOnce([aged('a', new Date().toISOString())]);
    state().initialize();
    expect(state().entries).toHaveLength(1);
    expect(state().initialized).toBe(true);
  });

  it('empties both the table and the store', () => {
    useUnattendedStore.setState({ entries: [aged('a', new Date().toISOString())] });
    state().clearAll();
    expect(dbClearUnattendedLog).toHaveBeenCalled();
    expect(state().entries).toEqual([]);
  });
});
