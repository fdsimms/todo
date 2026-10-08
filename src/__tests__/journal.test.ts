import type { JournalEntry } from '../types';
import {
  JOURNAL_PROMPTS,
  entriesOfKind,
  entriesOnDay,
  groupJournalByDay,
  journalPromptAt,
  journalStats,
  searchJournal,
  isSealed,
  openEntries,
  sealedEntries,
  justOpened,
  journalEntryLink,
  sealedNoteTaskDraft,
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
    openOn: over.openOn ?? null,
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

describe('entriesOnDay', () => {
  it('is one kind on one day, oldest first', () => {
    const late = entry({ id: 'late', dayKey: '2026-10-07', loggedAt: '2026-10-07T20:00:00' });
    const early = entry({ id: 'early', dayKey: '2026-10-07', loggedAt: '2026-10-07T09:00:00' });
    const otherDay = entry({ id: 'other', dayKey: '2026-10-06' });
    const dream = entry({ id: 'dream', kind: 'dream', dayKey: '2026-10-07' });
    expect(entriesOnDay([late, otherDay, dream, early], 'journal', '2026-10-07').map(e => e.id))
      .toEqual(['early', 'late']);
    expect(entriesOnDay([late, early], 'journal', '2026-10-08')).toEqual([]);
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

describe('notes to your future self', () => {
  const today = '2026-10-08';

  it('are sealed until their day, and open on it', () => {
    expect(isSealed(entry({ openOn: '2026-10-09' }), today)).toBe(true);
    expect(isSealed(entry({ openOn: today }), today)).toBe(false);
    expect(isSealed(entry({ openOn: null }), today)).toBe(false);
  });

  it('are left out of everything read before then, soonest listed first', () => {
    const list = [
      entry({ id: 'open' }),
      entry({ id: 'later', openOn: '2027-01-01' }),
      entry({ id: 'sooner', openOn: '2026-12-25' }),
      entry({ id: 'today', openOn: today }),
    ];
    expect(openEntries(list, today).map(e => e.id)).toEqual(['open', 'today']);
    expect(sealedEntries(list, today).map(e => e.id)).toEqual(['sooner', 'later']);
  });

  it('show under Just opened for a week from their day', () => {
    const list = [
      entry({ id: 'week-old', openOn: '2026-10-02' }),
      entry({ id: 'too-old', openOn: '2026-10-01' }),
      entry({ id: 'today', openOn: today }),
      entry({ id: 'plain' }),
    ];
    expect(justOpened(list, today).map(e => e.id)).toEqual(['today', 'week-old']);
  });

  it('leave a reminder due on their day that opens them', () => {
    const draft = sealedNoteTaskDraft({ id: 'n 1', dayKey: '2026-10-08', openOn: '2027-10-08' })!;
    expect(draft.title).toBe('Read the note you wrote on Oct 8, 2026');
    expect(new Date(draft.dueDate!)).toEqual(new Date(2027, 9, 8, 12));
    expect(draft.linkUrl).toBe(journalEntryLink('n 1'));
    expect(journalEntryLink('n 1')).toBe('dundundun://journal?entry=n%201');
    expect(sealedNoteTaskDraft({ id: 'x', dayKey: today, openOn: null })).toBeNull();
  });
});
