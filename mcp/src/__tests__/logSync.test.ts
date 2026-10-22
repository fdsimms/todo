import { logSyncNote, summarizeLogSync, withLogSyncNote } from '../logSync';
import type { Replica } from '../replica';

describe('summarizeLogSync', () => {
  it('is unknown with no report, from a phone too old to send one', () => {
    expect(summarizeLogSync([])).toEqual({ healthLogs: 'unknown', journal: 'unknown' });
  });

  it('reads each switch on its own', () => {
    expect(summarizeLogSync([{ healthLogs: true, journal: false }])).toEqual({ healthLogs: 'on', journal: 'off' });
  });

  it('is mixed when one device sends and another does not', () => {
    expect(summarizeLogSync([
      { healthLogs: true, journal: true },
      { healthLogs: true, journal: false },
    ])).toEqual({ healthLogs: 'on', journal: 'mixed' });
  });
});

describe('logSyncNote', () => {
  it('says nothing while the switch is on, or when nobody has said', () => {
    expect(logSyncNote('on', 'journal')).toBeUndefined();
    expect(logSyncNote('unknown', 'journal')).toBeUndefined();
  });

  it('names the switch and says what is here is partial', () => {
    expect(logSyncNote('off', 'journal')).toMatch(/Include journal and dreams is off.*only what was sent before/);
    expect(logSyncNote('mixed', 'healthLogs')).toMatch(/Include health logs is off on at least one/);
  });
});

describe('withLogSyncNote', () => {
  const replica = (journal: boolean) =>
    ({ serverSharingReports: () => [{ healthLogs: true, journal }] }) as unknown as Replica;

  it('adds the note to a result from a log whose switch is off', () => {
    expect(withLogSyncNote(replica(false), 'journal', { entries: [] })).toEqual({
      entries: [],
      syncNote: expect.stringMatching(/Include journal and dreams/),
    });
  });

  it('hands the result back untouched while the switch is on', () => {
    const result = { entries: [] };
    expect(withLogSyncNote(replica(true), 'journal', result)).toBe(result);
  });
});
