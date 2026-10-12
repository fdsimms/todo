/**
 * The journal tools against a real replica, since every write goes through
 * `useJournalStore`'s own actions and a stub would test the stub.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { deleteJournalEntry, listJournalEntries, logJournalEntry, searchJournalEntries, updateJournalEntry } from '../journalTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

describe('the journal tools', () => {
  let replica: ReturnType<typeof openReplica>;

  beforeAll(() => {
    replica = openReplica(':memory:');
  });

  beforeEach(() => {
    mockRaw.runSync('DELETE FROM journal_entries');
    replica.refresh();
  });

  it('writes an entry and a dream, and lists one kind or both', () => {
    const { entry } = logJournalEntry(replica, { kind: 'journal', text: '  A slow morning  ' });
    expect(entry).toMatchObject({ kind: 'journal', text: 'A slow morning', day: replica.todayKey() });
    logJournalEntry(replica, { kind: 'dream', text: 'Flying' });

    expect(listJournalEntries(replica).entries).toHaveLength(2);
    expect(listJournalEntries(replica, { kind: 'dream' }).entries.map(e => e.text)).toEqual(['Flying']);
  });

  it('gives each entry its word count, without formatting markers', () => {
    const { entry } = logJournalEntry(replica, { kind: 'journal', text: '# Title\n- one two\nthree' });
    expect(entry.words).toBe(4);
    expect(listJournalEntries(replica).entries[0].words).toBe(4);
  });

  it('reports the word goal for the journal and never for dreams', () => {
    const { useSettingsStore } = require('../../../src/store/useSettingsStore') as typeof import('../../../src/store/useSettingsStore');
    useSettingsStore.getState().setJournalWordGoal(300);
    try {
      expect(listJournalEntries(replica).wordGoal).toBe(300);
      expect(listJournalEntries(replica, { kind: 'dream' }).wordGoal).toBeUndefined();
    } finally {
      useSettingsStore.getState().setJournalWordGoal(null);
    }
    expect(listJournalEntries(replica).wordGoal).toBeUndefined();
  });

  it('files a backdated entry on the day named', () => {
    const { entry } = logJournalEntry(replica, { kind: 'dream', text: 'A corridor', at: '2026-09-01' });
    expect(entry.day).toBe('2026-09-01');
  });

  it('refuses blank text, and an unknown id', () => {
    expect(() => logJournalEntry(replica, { kind: 'journal', text: '  ' })).toThrow(/needs some text/);
    expect(() => updateJournalEntry(replica, 'nope', { text: 'x' })).toThrow(/No journal or dream entry/);
    expect(() => deleteJournalEntry(replica, 'nope')).toThrow(/No journal or dream entry/);
  });

  it('changes the words and deletes', () => {
    const { entry } = logJournalEntry(replica, { kind: 'journal', text: 'First' });
    expect(updateJournalEntry(replica, entry.id, { text: 'Second' }).entry.text).toBe('Second');
    expect(() => updateJournalEntry(replica, entry.id, { text: '  ' })).toThrow(/delete it instead/);
    expect(deleteJournalEntry(replica, entry.id).deleted.id).toBe(entry.id);
    expect(listJournalEntries(replica).entries).toEqual([]);
  });

  it('keeps a note for later sealed: counted, never listed, and refused by id', () => {
    const { entry } = logJournalEntry(replica, { kind: 'journal', text: 'Open' });
    mockRaw.runSync(
      "INSERT INTO journal_entries (id, kind, logged_at, day_key, text, open_on) VALUES ('sealed', 'journal', ?, ?, 'Dear future me', '2999-01-01')",
      [new Date().toISOString(), replica.todayKey()],
    );
    replica.refresh();
    expect(listJournalEntries(replica)).toMatchObject({ entries: [{ id: entry.id }], sealedNotes: 1 });
    expect(() => updateJournalEntry(replica, 'sealed', { text: 'x' })).toThrow(/sealed until 2999-01-01/);
    expect(() => deleteJournalEntry(replica, 'sealed')).toThrow(/sealed until/);
  });

  it('writes tags and people, lists them, and filters by either', () => {
    const a = logJournalEntry(replica, { kind: 'journal', text: 'Dinner with Sam', tags: [' work ', 'Work', 'family'], personIds: ['p1', 'p1'] }).entry;
    logJournalEntry(replica, { kind: 'journal', text: 'Alone' });
    expect(a.tags).toEqual(['work', 'family']);
    expect(a.personIds).toEqual(['p1']);
    expect(listJournalEntries(replica, { tag: 'WORK' }).entries.map(e => e.id)).toEqual([a.id]);
    expect(listJournalEntries(replica, { personId: 'p1' }).entries.map(e => e.id)).toEqual([a.id]);
    expect(listJournalEntries(replica).entries.find(e => e.id !== a.id)).not.toHaveProperty('tags');
  });

  it('changes tags alone without touching the words, and refuses an empty change', () => {
    const { entry } = logJournalEntry(replica, { kind: 'journal', text: 'Keep me', tags: ['a'] });
    const changed = updateJournalEntry(replica, entry.id, { tags: ['b'] }).entry;
    expect(changed).toMatchObject({ text: 'Keep me', tags: ['b'] });
    expect(updateJournalEntry(replica, entry.id, { tags: [] }).entry.tags).toBeUndefined();
    expect(() => updateJournalEntry(replica, entry.id, {})).toThrow(/Nothing to change/);
  });

  it('searches every word, newest first, never a sealed note, and says when it truncated', () => {
    logJournalEntry(replica, { kind: 'journal', text: 'Blue bicycle ride', at: '2026-01-02' });
    logJournalEntry(replica, { kind: 'dream', text: 'A blue door', at: '2026-02-03' });
    logJournalEntry(replica, { kind: 'journal', text: 'Red bicycle', at: '2026-03-04' });
    mockRaw.runSync(
      "INSERT INTO journal_entries (id, kind, logged_at, day_key, text, open_on) VALUES ('sealed', 'journal', ?, ?, 'blue secret', '2999-01-01')",
      [new Date().toISOString(), replica.todayKey()],
    );
    replica.refresh();
    expect(searchJournalEntries(replica, { query: 'blue' }).entries.map(e => e.text)).toEqual(['A blue door', 'Blue bicycle ride']);
    expect(searchJournalEntries(replica, { query: 'bicycle blue' }).entries.map(e => e.text)).toEqual(['Blue bicycle ride']);
    expect(searchJournalEntries(replica, { query: 'blue', kind: 'dream' }).total).toBe(1);
    expect(searchJournalEntries(replica, { query: 'blue', from: '2026-02-01', to: '2026-12-31' }).entries).toHaveLength(1);
    expect(searchJournalEntries(replica, { query: 'bicycle', limit: 1 })).toMatchObject({ total: 2, truncated: true });
  });
});
