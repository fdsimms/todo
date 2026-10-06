import type { JournalEntry } from '../types';
import {
  JOURNAL_PROMPTS,
  entriesOfKind,
  groupJournalByDay,
  journalPromptAt,
  journalStats,
  searchJournal,
} from '../utils/journal';

let n = 0;
function entry(over: Partial<JournalEntry> = {}): JournalEntry {
  n++;
  return {
    id: over.id ?? `e${n}`,
    kind: over.kind ?? 'journal',
    loggedAt: over.loggedAt ?? `2026-10-0${(n % 9) + 1}T09:00:00.000Z`,
    dayKey: over.dayKey ?? '2026-10-02',
    text: over.text ?? 'Something',
  };
}

describe('entriesOfKind', () => {
  it('keeps one kind and the order it was given', () => {
    const list = [entry({ id: 'a', kind: 'dream' }), entry({ id: 'b' }), entry({ id: 'c', kind: 'dream' })];
    expect(entriesOfKind(list, 'dream').map(e => e.id)).toEqual(['a', 'c']);
    expect(entriesOfKind(list, 'journal').map(e => e.id)).toEqual(['b']);
  });
});

describe('searchJournal', () => {
  it('needs every word, in any order, ignoring case, and an empty query keeps everything', () => {
    const list = [
      entry({ id: 'a', text: 'Missing a train in the rain' }),
      entry({ id: 'b', text: 'The train was late' }),
      entry({ id: 'c', text: 'A quiet beach' }),
    ];
    expect(searchJournal(list, 'TRAIN').map(e => e.id)).toEqual(['a', 'b']);
    expect(searchJournal(list, 'rain missing').map(e => e.id)).toEqual(['a']);
    expect(searchJournal(list, '  ')).toHaveLength(3);
  });
});

describe('groupJournalByDay', () => {
  it('puts the newest day first and each day in the order it was written', () => {
    const days = groupJournalByDay([
      entry({ id: 'late', dayKey: '2026-10-02', loggedAt: '2026-10-02T20:00:00.000Z' }),
      entry({ id: 'early', dayKey: '2026-10-02', loggedAt: '2026-10-02T08:00:00.000Z' }),
      entry({ id: 'old', dayKey: '2026-09-30', loggedAt: '2026-09-30T08:00:00.000Z' }),
    ]);
    expect(days.map(d => d.dayKey)).toEqual(['2026-10-02', '2026-09-30']);
    expect(days[0].entries.map(e => e.id)).toEqual(['early', 'late']);
  });

  it('draws no day for one with nothing written', () => {
    expect(groupJournalByDay([])).toEqual([]);
  });
});

describe('journalStats', () => {
  it('counts days, not entries, and a day with nothing is not counted', () => {
    const list = [
      entry({ dayKey: '2026-10-02' }),
      entry({ dayKey: '2026-10-02' }),
      entry({ dayKey: '2026-09-28' }),
    ];
    expect(journalStats(list, '2026-10')).toEqual({ dayCount: 2, dayCountInMonth: 1, lastDayKey: '2026-10-02' });
  });

  it('has no last day when nothing was written', () => {
    expect(journalStats([], '2026-10')).toEqual({ dayCount: 0, dayCountInMonth: 0, lastDayKey: null });
  });
});

describe('writing prompts', () => {
  it('wraps in both directions so a counter can step through them', () => {
    expect(journalPromptAt(JOURNAL_PROMPTS.length)).toBe(JOURNAL_PROMPTS[0]);
    expect(journalPromptAt(-1)).toBe(JOURNAL_PROMPTS[JOURNAL_PROMPTS.length - 1]);
  });

  it('are all questions, with no em dashes and no feeling named back', () => {
    for (const p of JOURNAL_PROMPTS) {
      expect(p.endsWith('?')).toBe(true);
      expect(p).not.toMatch(/—|depress|anxi|sad|unwell/i);
    }
  });
});
