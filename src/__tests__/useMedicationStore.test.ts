import { useMedicationStore, setDoseEffects } from '../store/useMedicationStore';
import {
  dbGetAllMedicationLogs,
  dbInsertMedicationLog,
  dbUpdateMedicationLog,
  dbDeleteMedicationLog,
  dbDeleteMedicationLogsForTask,
  dbGetSetting,
  dbSetSetting,
} from '../db/database';

jest.mock('../db/database', () => ({
  dbGetAllMedicationLogs: jest.fn(() => []),
  dbInsertMedicationLog: jest.fn(),
  dbUpdateMedicationLog: jest.fn(),
  dbDeleteMedicationLog: jest.fn(),
  dbDeleteMedicationLogsForTask: jest.fn(),
  dbGetSetting: jest.fn(() => null),
  dbSetSetting: jest.fn(),
}));

jest.mock('../utils/dateUtils', () => ({
  dayKeyOf: jest.fn((d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }),
  getCurrentDayStart: jest.fn(() => new Date(2026, 8, 11)),
  getDayStart: jest.fn((d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())),
}));

beforeEach(() => {
  jest.clearAllMocks();
  useMedicationStore.setState({ logs: [], archived: [], settings: {}, milestoneDismissed: [], initialized: false });
});

const state = () => useMedicationStore.getState();

describe('initialize', () => {
  it('loads the whole history', () => {
    state().initialize();
    expect(dbGetAllMedicationLogs).toHaveBeenCalled();
    expect(state().initialized).toBe(true);
  });

  it('loads the archived list', () => {
    (dbGetSetting as jest.Mock).mockReturnValueOnce('["valtrex"]');
    state().initialize();
    expect(state().archived).toEqual(['valtrex']);
  });
});

describe('archiving', () => {
  it('stores the match key and persists it', () => {
    state().archiveMedication('  Valtrex ');
    expect(state().archived).toEqual(['valtrex']);
    expect(dbSetSetting).toHaveBeenCalledWith('medication_archived', '["valtrex"]');
  });

  it('archives a name once', () => {
    state().archiveMedication('Valtrex');
    state().archiveMedication('valtrex');
    expect(state().archived).toEqual(['valtrex']);
    expect(dbSetSetting).toHaveBeenCalledTimes(1);
  });

  it('restores a medication, and ignores one that was not archived', () => {
    state().archiveMedication('Valtrex');
    state().unarchiveMedication('VALTREX');
    expect(state().archived).toEqual([]);
    (dbSetSetting as jest.Mock).mockClear();
    state().unarchiveMedication('Ibuprofen');
    expect(dbSetSetting).not.toHaveBeenCalled();
  });

  it('deletes no doses', () => {
    state().addLog({ name: 'Valtrex' });
    state().archiveMedication('Valtrex');
    expect(state().logs).toHaveLength(1);
    expect(dbDeleteMedicationLog).not.toHaveBeenCalled();
  });

  it('brings a medication back when another dose of it is recorded', () => {
    state().archiveMedication('Valtrex');
    state().addLog({ name: 'valtrex', at: new Date(2026, 8, 1, 9) });
    expect(state().archived).toEqual([]);
  });

  it('leaves other archived medications alone when one is recorded', () => {
    state().archiveMedication('Valtrex');
    state().addLog({ name: 'Ibuprofen' });
    expect(state().archived).toEqual(['valtrex']);
  });

  it('brings a medication back when a dose is renamed onto it', () => {
    const log = state().addLog({ name: 'Valtrex dose' })!;
    state().archiveMedication('Valtrex');
    state().updateLog(log.id, { name: 'Valtrex' });
    expect(state().archived).toEqual([]);
  });
});

describe('addLog', () => {
  it('records a dose and holds it', () => {
    const log = state().addLog({ name: 'Ibuprofen', amount: 400, unit: 'mg' });
    expect(log).not.toBeNull();
    expect(dbInsertMedicationLog).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Ibuprofen', amount: 400, unit: 'mg' }),
    );
    expect(state().logs).toHaveLength(1);
  });

  it('refuses a dose with no name', () => {
    expect(state().addLog({ name: '   ' })).toBeNull();
    expect(dbInsertMedicationLog).not.toHaveBeenCalled();
    expect(state().logs).toHaveLength(0);
  });

  it('trims the name', () => {
    expect(state().addLog({ name: '  Sertraline ' })!.name).toBe('Sertraline');
  });

  it('drops an amount with no unit, and a unit with no amount', () => {
    // Half a dose is unreadable, so it is recorded as no dose rather than as a
    // figure a reader would have to guess at.
    expect(state().addLog({ name: 'A', amount: 2 })).toMatchObject({ amount: null, unit: null });
    expect(state().addLog({ name: 'B', unit: 'mg' })).toMatchObject({ amount: null, unit: null });
  });

  it('keeps a stated zero apart from an unstated amount', () => {
    expect(state().addLog({ name: 'A', amount: 0, unit: 'mg' })!.amount).toBe(0);
    expect(state().addLog({ name: 'B' })!.amount).toBeNull();
  });

  it('defaults to a scheduled dose with no task', () => {
    const log = state().addLog({ name: 'Sertraline' })!;
    expect(log.asNeeded).toBe(false);
    expect(log.taskId).toBeNull();
  });

  it('records an as-needed dose when told', () => {
    expect(state().addLog({ name: 'Ibuprofen', asNeeded: true })!.asNeeded).toBe(true);
  });

  it('stamps the day key from the logical day, not from the instant', () => {
    expect(state().addLog({ name: 'Sertraline' })!.dayKey).toBe('2026-09-11');
  });

  it('stamps a backdated dose against the day it happened on', () => {
    const log = state().addLog({ name: 'Ibuprofen', at: new Date(2026, 8, 4, 23, 30) })!;
    expect(log.dayKey).toBe('2026-09-04');
  });

  it('keeps the list newest first', () => {
    state().addLog({ name: 'First' });
    state().addLog({ name: 'Second' });
    expect(state().logs.map(l => l.name)).toEqual(['Second', 'First']);
  });

  it('keeps the task it came from as provenance', () => {
    expect(state().addLog({ name: 'Sertraline', taskId: 'task-1' })!.taskId).toBe('task-1');
  });

  it('drops a blank note to null rather than storing an empty string', () => {
    expect(state().addLog({ name: 'A', note: '   ' })!.note).toBeNull();
  });
});

describe('updateLog', () => {
  it('edits what was recorded', () => {
    const log = state().addLog({ name: 'Ibuprofen' })!;
    state().updateLog(log.id, { amount: 200, unit: 'mg' });
    expect(dbUpdateMedicationLog).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 200, unit: 'mg' }),
    );
  });

  it('refuses to blank the name', () => {
    const log = state().addLog({ name: 'Ibuprofen' })!;
    state().updateLog(log.id, { name: '  ' });
    expect(dbUpdateMedicationLog).not.toHaveBeenCalled();
    expect(state().logs[0].name).toBe('Ibuprofen');
  });

  it('re-pairs the amount and unit when only one is edited away', () => {
    const log = state().addLog({ name: 'Ibuprofen', amount: 400, unit: 'mg' })!;
    state().updateLog(log.id, { unit: null });
    expect(state().logs[0]).toMatchObject({ amount: null, unit: null });
  });

  it('does nothing for an id that is not there', () => {
    state().updateLog('missing', { name: 'X' });
    expect(dbUpdateMedicationLog).not.toHaveBeenCalled();
  });

  it('cannot move the day an entry counts toward', () => {
    // Not expressible through MedicationLogPatch by design — correcting what a
    // dose says must not rewrite which day every window counts it in.
    const log = state().addLog({ name: 'Ibuprofen' })!;
    const before = log.dayKey;
    state().updateLog(log.id, { name: 'Ibuprofen 400' });
    expect(state().logs[0].dayKey).toBe(before);
    expect(state().logs[0].takenAt).toBe(log.takenAt);
  });
});

describe('removeLog', () => {
  it('drops one dose', () => {
    const log = state().addLog({ name: 'Ibuprofen' })!;
    state().removeLog(log.id);
    expect(dbDeleteMedicationLog).toHaveBeenCalledWith(log.id);
    expect(state().logs).toHaveLength(0);
  });
});

describe('removeLogsForTask', () => {
  it('drops every dose a task recorded and leaves the rest', () => {
    state().addLog({ name: 'Sertraline', taskId: 'task-1' });
    state().addLog({ name: 'Sertraline', taskId: 'task-1' });
    state().addLog({ name: 'Ibuprofen', asNeeded: true });
    state().removeLogsForTask('task-1');
    expect(dbDeleteMedicationLogsForTask).toHaveBeenCalledWith('task-1');
    expect(state().logs.map(l => l.name)).toEqual(['Ibuprofen']);
  });

  it('does nothing for a task that recorded none', () => {
    state().addLog({ name: 'Ibuprofen', asNeeded: true });
    state().removeLogsForTask('task-9');
    expect(state().logs).toHaveLength(1);
  });
});

describe('removeLatestLogForTask', () => {
  it('takes back only the most recent dose', () => {
    // Undoing one unit of a daily target: the day's earlier doses were still
    // taken and must survive it.
    state().addLog({ name: 'Sertraline', taskId: 'task-1', at: new Date(2026, 8, 11, 8) });
    state().addLog({ name: 'Sertraline', taskId: 'task-1', at: new Date(2026, 8, 11, 13) });
    state().addLog({ name: 'Sertraline', taskId: 'task-1', at: new Date(2026, 8, 11, 20) });
    state().removeLatestLogForTask('task-1');
    expect(state().logs).toHaveLength(2);
    expect(state().logs.every(l => l.takenAt < new Date(2026, 8, 11, 20).toISOString())).toBe(true);
  });

  it('does nothing for a task that recorded none', () => {
    state().addLog({ name: 'Ibuprofen', asNeeded: true });
    state().removeLatestLogForTask('task-9');
    expect(state().logs).toHaveLength(1);
  });
});

describe('limits and supply', () => {
  beforeEach(() => {
    useMedicationStore.setState({ settings: {}, lastSummaryAt: null });
  });

  it('stores a limit under the match key with a since stamp', () => {
    state().setLimit(' Ibuprofen ', { minHours: 6, maxPer24h: 4, notify: true });
    const limit = state().settings.ibuprofen.limit!;
    expect(limit).toMatchObject({ minHours: 6, maxPer24h: 4, notify: true });
    expect(typeof limit.since).toBe('string');
    expect(dbSetSetting).toHaveBeenCalledWith('medication_settings', expect.any(String));
  });

  it('keeps since when only the notification changes, restamps when a cap does', () => {
    state().setLimit('Ibuprofen', { minHours: 6, maxPer24h: null, notify: false });
    const first = state().settings.ibuprofen.limit!.since;
    useMedicationStore.setState({
      settings: { ibuprofen: { limit: { ...state().settings.ibuprofen.limit!, since: '2026-01-01T00:00:00.000Z' }, supply: null } },
    });
    state().setLimit('Ibuprofen', { minHours: 6, maxPer24h: null, notify: true });
    expect(state().settings.ibuprofen.limit!.since).toBe('2026-01-01T00:00:00.000Z');
    state().setLimit('Ibuprofen', { minHours: 8, maxPer24h: null, notify: true });
    expect(state().settings.ibuprofen.limit!.since).not.toBe('2026-01-01T00:00:00.000Z');
    expect(first).toBeTruthy();
  });

  it('clearing both the limit and the supply drops the entry', () => {
    state().setLimit('Ibuprofen', { minHours: 6, maxPer24h: null, notify: false });
    state().setLimit('Ibuprofen', null);
    expect(state().settings).toEqual({});
  });

  it('a refill adds to what is left and clears a decline', () => {
    state().setSupply('Ibuprofen', { count: 10, unit: 'tablet', refillCount: 30, reorderAt: 3 });
    useMedicationStore.setState({
      settings: { ibuprofen: { limit: null, supply: { ...state().settings.ibuprofen.supply!, since: '2026-09-01T00:00:00.000Z' } } },
    });
    state().addLog({ name: 'Ibuprofen', amount: 2, unit: 'tablet', asNeeded: true, at: new Date(2026, 8, 5, 9) });
    state().declineRefill('Ibuprofen');
    expect(state().settings.ibuprofen.supply!.declinedAt).toBe(8);
    state().refillSupply('Ibuprofen', 30);
    expect(state().settings.ibuprofen.supply!).toMatchObject({ count: 38, declinedAt: null });
  });

  it('remembers when a summary was shared', () => {
    state().markSummaryShared(new Date('2026-09-10T12:00:00.000Z'));
    expect(state().lastSummaryAt).toBe('2026-09-10T12:00:00.000Z');
    expect(dbSetSetting).toHaveBeenCalledWith('medication_summary_last', '2026-09-10T12:00:00.000Z');
  });
});

describe('renameMedication', () => {
  const dose = (id: string, name: string, amount: number | null = null) => ({
    id, name, takenAt: '2026-09-01T09:00:00.000Z', dayKey: '2026-09-01',
    amount, unit: amount === null ? null : 'mg', asNeeded: true, taskId: null, note: null,
  });

  it('renames the doses, persists each, and fills a strength', () => {
    useMedicationStore.setState({ logs: [dose('a', 'Ibuprofen 200'), dose('b', 'Ibuprofen 200', 400)] });
    expect(state().renameMedication('ibuprofen 200', 'Ibuprofen', { amount: 200, unit: 'mg' })).toBe(2);
    expect(state().logs.map(l => [l.name, l.amount])).toEqual([['Ibuprofen', 200], ['Ibuprofen', 400]]);
    expect(dbUpdateMedicationLog).toHaveBeenCalledTimes(2);
  });

  it('refuses a blank name or an unknown medication', () => {
    useMedicationStore.setState({ logs: [dose('a', 'Ibuprofen')] });
    expect(state().renameMedication('Ibuprofen', '  ')).toBeNull();
    expect(state().renameMedication('Nothing', 'X')).toBeNull();
  });

  it('moves the archived key with the doses', () => {
    useMedicationStore.setState({ logs: [dose('a', 'Old')], archived: ['old'] });
    state().renameMedication('Old', 'New');
    expect(state().archived).toEqual(['new']);
  });

  it('un-archives a target that live doses are folded into', () => {
    useMedicationStore.setState({ logs: [dose('a', 'Old'), dose('b', 'New')], archived: ['new'] });
    state().renameMedication('Old', 'New');
    expect(state().archived).toEqual([]);
  });

  it('keeps the target archived when both were', () => {
    useMedicationStore.setState({ logs: [dose('a', 'Old'), dose('b', 'New')], archived: ['old', 'new'] });
    state().renameMedication('Old', 'New');
    expect(state().archived).toEqual(['new']);
  });

  it('moves the limit to the new key', () => {
    const limit = { minHours: 6, maxPer24h: null, notify: false, since: '2026-01-01T00:00:00.000Z' };
    useMedicationStore.setState({ logs: [dose('a', 'Old')], settings: { old: { limit, supply: null } } });
    state().renameMedication('Old', 'New');
    expect(state().settings).toEqual({ new: { limit, supply: null } });
  });

  it('tells the dose effects about each renamed dose', () => {
    const updated = jest.fn();
    setDoseEffects({ added: jest.fn(), updated, removed: jest.fn() });
    useMedicationStore.setState({ logs: [dose('a', 'Old')] });
    state().renameMedication('Old', 'New');
    setDoseEffects(null);
    expect(updated).toHaveBeenCalledTimes(1);
    expect(updated.mock.calls[0][0].name).toBe('Old');
    expect(updated.mock.calls[0][1].name).toBe('New');
  });
});
