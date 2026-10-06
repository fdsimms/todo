import type { JournalEntry } from '../types';
import {
  JOURNAL_EXPORT_COLUMNS,
  journalExportCsv,
  journalExportFileName,
  journalExportSummary,
} from '../utils/journalExport';

const entry = (over: Partial<JournalEntry>): JournalEntry => ({
  id: over.id ?? 'e',
  kind: over.kind ?? 'journal',
  loggedAt: over.loggedAt ?? '2026-10-02T09:00:00.000Z',
  dayKey: over.dayKey ?? '2026-10-02',
  text: over.text ?? 'Something',
});

const rows = (csv: string) => csv.trimEnd().split('\n');

describe('journalExportCsv', () => {
  it('writes one kind, oldest first, with the day and the instant', () => {
    const csv = journalExportCsv([
      entry({ id: 'b', loggedAt: '2026-10-03T09:00:00.000Z', dayKey: '2026-10-03', text: 'Second' }),
      entry({ id: 'a', text: 'First' }),
      entry({ id: 'd', kind: 'dream', text: 'Not this one' }),
    ], 'journal');
    expect(rows(csv)).toEqual([
      JOURNAL_EXPORT_COLUMNS.join(','),
      '2026-10-02,2026-10-02T09:00:00.000Z,First',
      '2026-10-03,2026-10-03T09:00:00.000Z,Second',
    ]);
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('quotes text holding a comma or a line break', () => {
    const csv = journalExportCsv([entry({ text: 'Rain, then sun\nand wind' })], 'journal');
    expect(csv).toContain('"Rain, then sun\nand wind"');
  });
});

describe('journalExportFileName', () => {
  it('names the kind and the day', () => {
    const at = new Date(2026, 9, 6, 12);
    expect(journalExportFileName('journal', at)).toBe('journal-2026-10-06.csv');
    expect(journalExportFileName('dream', at)).toBe('dreams-2026-10-06.csv');
  });
});

describe('journalExportSummary', () => {
  it('counts one kind and gives the span', () => {
    expect(journalExportSummary([
      entry({ kind: 'dream', dayKey: '2026-08-12' }),
      entry({ kind: 'dream', dayKey: '2026-10-06' }),
      entry({ kind: 'journal' }),
    ], 'dream')).toBe('2 dreams from Aug 12, 2026 to Oct 6, 2026.');
    expect(journalExportSummary([entry({})], 'journal')).toBe('1 journal entry from Oct 2, 2026.');
    expect(journalExportSummary([], 'dream')).toBe('Nothing written yet.');
  });
});
