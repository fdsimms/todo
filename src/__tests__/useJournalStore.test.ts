import { useJournalStore } from '../store/useJournalStore';
import {
  dbInsertJournalEntry,
  dbUpdateJournalEntry,
  dbDeleteJournalEntry,
} from '../db/database';

jest.mock('../db/database', () => ({
  dbGetAllJournalEntries: jest.fn(() => []),
  dbInsertJournalEntry: jest.fn(),
  dbUpdateJournalEntry: jest.fn(),
  dbDeleteJournalEntry: jest.fn(),
}));

jest.mock('../utils/dateUtils', () => ({
  dayKeyOf: jest.fn((d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }),
  getCurrentDayStart: jest.fn(() => new Date(2026, 7, 17)),
  getDayStart: jest.fn((d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())),
}));

const state = () => useJournalStore.getState();

beforeEach(() => {
  jest.clearAllMocks();
  useJournalStore.setState({ entries: [], initialized: false });
});

describe('addEntry', () => {
  it('trims the text, stamps today under the day reset, and writes it', () => {
    const entry = state().addEntry('journal', '  A good day  ')!;
    expect(entry).toMatchObject({ kind: 'journal', text: 'A good day', dayKey: '2026-08-17' });
    expect(dbInsertJournalEntry).toHaveBeenCalledWith(entry);
    expect(state().entries).toEqual([entry]);
  });

  it('refuses blank text', () => {
    expect(state().addEntry('dream', '   ')).toBeNull();
    expect(dbInsertJournalEntry).not.toHaveBeenCalled();
  });

  it('files a backdated entry under its own day and keeps newest first', () => {
    const now = state().addEntry('journal', 'Today')!;
    const old = state().addEntry('dream', 'Earlier', new Date(2026, 7, 12, 12))!;
    expect(old.dayKey).toBe('2026-08-12');
    expect(state().entries.map(e => e.id)).toEqual([now.id, old.id]);
  });
});

describe('a note to your future self', () => {
  it('is sealed until a later day, and a day already here seals nothing', () => {
    expect(state().addEntry('journal', 'Hello, me', undefined, '2027-08-17')!.openOn).toBe('2027-08-17');
    expect(state().addEntry('journal', 'Now', undefined, '2026-08-17')!.openOn).toBeNull();
    expect(state().addEntry('journal', 'Then', undefined, '2026-01-01')!.openOn).toBeNull();
  });

  it('opens early when asked, and only a sealed one changes', () => {
    const note = state().addEntry('journal', 'Hello, me', undefined, '2027-08-17')!;
    state().openNow(note.id);
    expect(state().entries.find(e => e.id === note.id)!.openOn).toBeNull();
    expect(dbUpdateJournalEntry).toHaveBeenCalledWith(expect.objectContaining({ id: note.id, openOn: null }));
    (dbUpdateJournalEntry as jest.Mock).mockClear();
    state().openNow(note.id);
    expect(dbUpdateJournalEntry).not.toHaveBeenCalled();
  });
});

describe('updateEntry', () => {
  it('changes the words and never the day', () => {
    const entry = state().addEntry('journal', 'First', new Date(2026, 7, 12, 12))!;
    state().updateEntry(entry.id, '  Second  ');
    expect(state().entries[0]).toMatchObject({ text: 'Second', dayKey: '2026-08-12' });
    expect(dbUpdateJournalEntry).toHaveBeenCalled();
  });

  it('ignores blank text, which is a delete rather than an edit', () => {
    const entry = state().addEntry('journal', 'First')!;
    state().updateEntry(entry.id, '  ');
    expect(state().entries[0].text).toBe('First');
    expect(dbUpdateJournalEntry).not.toHaveBeenCalled();
  });
});

describe('removeEntry', () => {
  it('deletes it', () => {
    const entry = state().addEntry('journal', 'Gone soon')!;
    state().removeEntry(entry.id);
    expect(state().entries).toEqual([]);
    expect(dbDeleteJournalEntry).toHaveBeenCalledWith(entry.id);
  });
});
