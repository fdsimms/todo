/**
 * The journal tools against a real replica, since every write goes through
 * `useJournalStore`'s own actions and a stub would test the stub.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { deleteJournalEntry, listJournalEntries, logJournalEntry, updateJournalEntry } from '../journalTools';

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

  it('files a backdated entry on the day named', () => {
    const { entry } = logJournalEntry(replica, { kind: 'dream', text: 'A corridor', at: '2026-09-01' });
    expect(entry.day).toBe('2026-09-01');
  });

  it('refuses blank text, and an unknown id', () => {
    expect(() => logJournalEntry(replica, { kind: 'journal', text: '  ' })).toThrow(/needs some text/);
    expect(() => updateJournalEntry(replica, 'nope', 'x')).toThrow(/No journal or dream entry/);
    expect(() => deleteJournalEntry(replica, 'nope')).toThrow(/No journal or dream entry/);
  });

  it('changes the words and deletes', () => {
    const { entry } = logJournalEntry(replica, { kind: 'journal', text: 'First' });
    expect(updateJournalEntry(replica, entry.id, 'Second').entry.text).toBe('Second');
    expect(() => updateJournalEntry(replica, entry.id, '  ')).toThrow(/delete it instead/);
    expect(deleteJournalEntry(replica, entry.id).deleted.id).toBe(entry.id);
    expect(listJournalEntries(replica).entries).toEqual([]);
  });
});
