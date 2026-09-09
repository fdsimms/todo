import {
  MOOD_EXPORT_COLUMNS,
  csvCell,
  moodExportCsv,
  moodExportFileName,
  moodExportSummary,
} from '../utils/moodExport';
import type { MoodLog } from '../types';

let n = 0;
function log(over: Partial<MoodLog> = {}): MoodLog {
  n++;
  return {
    id: over.id ?? `l${n}`,
    loggedAt: over.loggedAt ?? '2026-08-17T09:00:00.000Z',
    dayKey: over.dayKey ?? '2026-08-17',
    mood: over.mood === undefined ? 3 : over.mood,
    symptoms: over.symptoms ?? [],
    contextTags: over.contextTags ?? [],
    note: over.note ?? null,
  };
}

const rows = (csv: string) => csv.trimEnd().split('\n');

describe('csvCell', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvCell('Headache')).toBe('Headache');
  });

  it('quotes a value holding a comma', () => {
    expect(csvCell('Long day, skipped lunch')).toBe('"Long day, skipped lunch"');
  });

  it('doubles quotes inside a quoted value', () => {
    expect(csvCell('said "fine"')).toBe('"said ""fine"""');
  });

  it('quotes a value holding a newline', () => {
    expect(csvCell('one\ntwo')).toBe('"one\ntwo"');
  });
});

describe('the file', () => {
  it('leads with the header row', () => {
    expect(rows(moodExportCsv([]))[0]).toBe(MOOD_EXPORT_COLUMNS.join(','));
  });

  it('ends with a newline, so a last row cannot go missing on import', () => {
    expect(moodExportCsv([log()]).endsWith('\n')).toBe(true);
  });

  it('is oldest first — a record is read forwards', () => {
    const csv = moodExportCsv([
      log({ loggedAt: '2026-08-18T09:00:00.000Z', dayKey: '2026-08-18' }),
      log({ loggedAt: '2026-08-17T09:00:00.000Z', dayKey: '2026-08-17' }),
    ]);
    expect(rows(csv)[1].startsWith('2026-08-17')).toBe(true);
  });

  it('writes one row per entry and never collapses a day', () => {
    const csv = moodExportCsv([
      log({ loggedAt: '2026-08-17T08:00:00.000Z', mood: 5 }),
      log({ loggedAt: '2026-08-17T20:00:00.000Z', mood: 1 }),
    ]);
    // Two rows, and neither of them is the 3 an average would have invented.
    expect(rows(csv)).toHaveLength(3);
    expect(csv).toContain('5,Very good');
    expect(csv).toContain('1,Very low');
  });

  it('spells the scale out beside the number', () => {
    expect(moodExportCsv([log({ mood: 2 })])).toContain('2,Low');
  });

  it('writes severity as its word', () => {
    const csv = moodExportCsv([log({
      symptoms: [{ name: 'Headache', severity: 3 }, { name: 'Poor sleep', severity: 1 }],
    })]);
    expect(csv).toContain('Headache (severe); Poor sleep (mild)');
  });

  it('leaves the mood columns empty for a symptoms-only entry', () => {
    const csv = moodExportCsv([log({ mood: null, symptoms: [{ name: 'Nausea', severity: 1 }] })]);
    expect(rows(csv)[1]).toContain(',,,Nausea (mild)');
  });

  it('carries both the logical day and the instant, which can differ', () => {
    // A 1am entry under an 02:00 reset belongs to the previous logical day.
    const csv = moodExportCsv([log({ dayKey: '2026-08-16', loggedAt: '2026-08-17T01:00:00.000Z' })]);
    expect(rows(csv)[1].startsWith('2026-08-16,2026-08-17T01:00:00.000Z')).toBe(true);
  });

  it('quotes a note holding a comma rather than splitting it across columns', () => {
    const csv = moodExportCsv([log({ note: 'Long day, skipped lunch' })]);
    expect(rows(csv)[1].endsWith('"Long day, skipped lunch"')).toBe(true);
  });
});

describe('the file name', () => {
  it('is dated', () => {
    expect(moodExportFileName(new Date('2026-09-09T12:00:00.000Z'))).toBe('mood-log-2026-09-09.csv');
  });
});

describe('the summary', () => {
  it('says what is actually in the range rather than what was asked for', () => {
    const summary = moodExportSummary([
      log({ dayKey: '2026-08-17' }), log({ dayKey: '2026-09-01' }),
    ]);
    expect(summary).toBe('2 entries from Aug 17, 2026 to Sep 1, 2026.');
  });

  it('collapses a single day', () => {
    expect(moodExportSummary([log({ dayKey: '2026-08-17' })]))
      .toBe('1 entry from Aug 17, 2026.');
  });

  it('says so when there is nothing', () => {
    expect(moodExportSummary([])).toBe('No entries in this range.');
  });
});
