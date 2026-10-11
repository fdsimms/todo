import type { JournalEntry } from '../types';
import {
  JOURNAL_EXPORT_COLUMNS,
  journalExportCsv,
  journalExportFileName,
  journalExportMarkdown,
  journalExportSummary,
} from '../utils/journalExport';

const entry = (over: Partial<JournalEntry>): JournalEntry => ({
  id: over.id ?? 'e',
  kind: over.kind ?? 'journal',
  loggedAt: over.loggedAt ?? '2026-10-02T09:00:00.000Z',
  dayKey: over.dayKey ?? '2026-10-02',
  text: over.text ?? 'Something',
  ...(over.tags ? { tags: over.tags } : {}),
  ...(over.personIds ? { personIds: over.personIds } : {}),
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
      '2026-10-02,2026-10-02T09:00:00.000Z,First,,',
      '2026-10-03,2026-10-03T09:00:00.000Z,Second,,',
    ]);
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('quotes text holding a comma or a line break', () => {
    const csv = journalExportCsv([entry({ text: 'Rain, then sun\nand wind' })], 'journal');
    expect(csv).toContain('"Rain, then sun\nand wind"');
  });
});

describe('journalExportCsv tags and people', () => {
  it('writes the tags and the names of the people, skipping a person who no longer exists', () => {
    const csv = journalExportCsv(
      [entry({ text: 'Dinner', tags: ['family', 'food'], personIds: ['p1', 'gone'] })],
      'journal',
      id => (id === 'p1' ? 'Sam' : null),
    );
    expect(rows(csv)[1]).toBe('2026-10-02,2026-10-02T09:00:00.000Z,Dinner,family; food,Sam');
  });
});

describe('journalExportMarkdown', () => {
  it('writes a heading per day with each entry under it, oldest first, one kind only', () => {
    const md = journalExportMarkdown([
      entry({ id: 'b', loggedAt: '2026-10-03T09:00:00.000Z', dayKey: '2026-10-03', text: 'Second day' }),
      entry({ id: 'a', loggedAt: '2026-10-02T09:00:00.000Z', text: 'First day' }),
      entry({ id: 'a2', loggedAt: '2026-10-02T10:00:00.000Z', text: 'Same day again' }),
      entry({ id: 'd', kind: 'dream', text: 'Not this one' }),
    ], 'journal');
    const lines = md.split('\n');
    expect(lines[0]).toBe('# Journal');
    expect(lines.filter(l => l.startsWith('## ')).length).toBe(2);
    expect(md.indexOf('First day')).toBeLessThan(md.indexOf('Same day again'));
    expect(md.indexOf('Same day again')).toBeLessThan(md.indexOf('Second day'));
    expect(md).not.toContain('Not this one');
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });

  it('pushes an entry heading below the day heading, and names tags and people', () => {
    const md = journalExportMarkdown(
      [entry({ text: '# Title\nBody', tags: ['work'], personIds: ['p1'] })],
      'journal',
      () => 'Sam',
    );
    expect(md).toContain('### Title');
    expect(md).not.toMatch(/^# Title/m);
    expect(md).toContain('*About Sam · Tags: work*');
  });

  it('titles the dream log Dreams', () => {
    expect(journalExportMarkdown([entry({ kind: 'dream' })], 'dream').startsWith('# Dreams')).toBe(true);
  });
});

describe('journalExportFileName', () => {
  it('names the kind and the day', () => {
    const at = new Date(2026, 9, 6, 12);
    expect(journalExportFileName('journal', at)).toBe('journal-2026-10-06.csv');
    expect(journalExportFileName('dream', at)).toBe('dreams-2026-10-06.csv');
    expect(journalExportFileName('journal', at, 'markdown')).toBe('journal-2026-10-06.md');
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
