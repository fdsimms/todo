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
  countWords,
  wordsOnDay,
  formatWordCount,
  parseJournalWordGoal,
  daysReachingWordGoal,
  JOURNAL_WORD_GOAL_RANGE,
  JOURNAL_TAGS_PER_ENTRY,
  JOURNAL_TAG_MAX_LENGTH,
  JOURNAL_CUSTOM_PROMPTS_MAX,
  onThisDay,
  daysWrittenInMonth,
  randomJournalDay,
  normalizeJournalTag,
  cleanJournalTags,
  journalTagsIn,
  entriesWithTag,
  entriesAboutPerson,
  cleanPersonIds,
  sealShortcuts,
  journalSnippet,
  parseJournalCustomPrompts,
  cleanJournalPrompts,
  journalPromptList,
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
    ...(over.tags ? { tags: over.tags } : {}),
    ...(over.personIds ? { personIds: over.personIds } : {}),
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

describe('word counts', () => {
  it('counts words split on any whitespace', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n ')).toBe(0);
    expect(countWords('One two  three\nfour')).toBe(4);
  });

  it('does not count formatting markers as words', () => {
    expect(countWords('# Slow Saturday\nSlept in, then a **long** walk.\n- Call Mom\n1. Read\n> quote here')).toBe(13);
    expect(countWords('- ')).toBe(0);
  });

  it('adds every snippet of one kind on one day, and nothing else', () => {
    const list = [
      entry({ dayKey: '2026-10-02', text: 'one two three' }),
      entry({ dayKey: '2026-10-02', text: 'four five' }),
      entry({ dayKey: '2026-10-03', text: 'six' }),
      entry({ dayKey: '2026-10-02', kind: 'dream', text: 'a dream of many words' }),
    ];
    expect(wordsOnDay(list, 'journal', '2026-10-02')).toBe(5);
    expect(wordsOnDay(list, 'journal', '2026-10-09')).toBe(0);
  });

  it('formats a count with a singular and a thousands separator', () => {
    expect(formatWordCount(1)).toBe('1 word');
    expect(formatWordCount(0)).toBe('0 words');
    expect(formatWordCount(1250)).toBe('1,250 words');
  });

  it('reads a stored goal back, and treats anything unusable as no goal', () => {
    expect(parseJournalWordGoal('500')).toBe(500);
    expect(parseJournalWordGoal('')).toBeNull();
    expect(parseJournalWordGoal(null)).toBeNull();
    expect(parseJournalWordGoal('12.5')).toBeNull();
    expect(parseJournalWordGoal('abc')).toBeNull();
    expect(parseJournalWordGoal(String(JOURNAL_WORD_GOAL_RANGE.min - 1))).toBeNull();
    expect(parseJournalWordGoal(String(JOURNAL_WORD_GOAL_RANGE.max + 1))).toBeNull();
  });

  it('counts days that reach the goal across snippets, optionally within a month', () => {
    const list = [
      entry({ dayKey: '2026-10-02', text: 'a b c' }),
      entry({ dayKey: '2026-10-02', text: 'd e' }),
      entry({ dayKey: '2026-10-03', text: 'a b c d' }),
      entry({ dayKey: '2026-09-28', text: 'a b c d e f' }),
    ];
    expect(daysReachingWordGoal(list, 5)).toBe(2);
    expect(daysReachingWordGoal(list, 5, '2026-10')).toBe(1);
    expect(daysReachingWordGoal(list, 7)).toBe(0);
  });
});

describe('onThisDay', () => {
  const today = '2026-10-11';

  it('finds the same month and day in earlier years, newest year first, with how many years back', () => {
    const list = [
      entry({ id: 'a', dayKey: '2025-10-11', loggedAt: '2025-10-11T20:00:00.000Z' }),
      entry({ id: 'b', dayKey: '2024-10-11', loggedAt: '2024-10-11T20:00:00.000Z' }),
      entry({ id: 'c', dayKey: '2025-10-12' }),
      entry({ id: 'd', dayKey: '2026-10-11' }),
    ];
    const found = onThisDay(list, 'journal', today);
    expect(found.map(d => [d.dayKey, d.yearsAgo])).toEqual([['2025-10-11', 1], ['2024-10-11', 2]]);
  });

  it('leaves out the other kind, today itself, and a sealed note', () => {
    const list = [
      entry({ id: 'a', kind: 'dream', dayKey: '2025-10-11' }),
      entry({ id: 'b', dayKey: '2025-10-11', openOn: '2999-01-01' }),
      entry({ id: 'c', dayKey: '2026-10-11' }),
    ];
    expect(onThisDay(list, 'journal', today)).toEqual([]);
    expect(onThisDay(list, 'dream', today).map(d => d.dayKey)).toEqual(['2025-10-11']);
  });

  it('shows a Feb 29 page only on a Feb 29', () => {
    const list = [entry({ dayKey: '2024-02-29' })];
    expect(onThisDay(list, 'journal', '2026-02-28')).toEqual([]);
    expect(onThisDay(list, 'journal', '2028-02-29').map(d => d.yearsAgo)).toEqual([4]);
  });
});

describe('daysWrittenInMonth', () => {
  it('collects the open days of one kind in the month', () => {
    const list = [
      entry({ dayKey: '2026-10-02' }),
      entry({ dayKey: '2026-10-02' }),
      entry({ dayKey: '2026-10-09', kind: 'dream' }),
      entry({ dayKey: '2026-09-30' }),
      entry({ dayKey: '2026-10-20', openOn: '2999-01-01' }),
    ];
    expect([...daysWrittenInMonth(list, 'journal', '2026-10', '2026-10-11')]).toEqual(['2026-10-02']);
  });
});

describe('randomJournalDay', () => {
  const list = [entry({ dayKey: '2026-10-11' }), entry({ dayKey: '2026-10-01' }), entry({ dayKey: '2026-09-01' })];

  it('picks from the days written, leaving today out while anything older exists', () => {
    expect(randomJournalDay(list, 'journal', '2026-10-11', () => 0)).toBe('2026-09-01');
    expect(randomJournalDay(list, 'journal', '2026-10-11', () => 0.999)).toBe('2026-10-01');
  });

  it('falls back to today when it is the only page, and to null when there are none', () => {
    expect(randomJournalDay([list[0]], 'journal', '2026-10-11')).toBe('2026-10-11');
    expect(randomJournalDay([], 'journal', '2026-10-11')).toBeNull();
    expect(randomJournalDay([entry({ openOn: '2999-01-01' })], 'journal', '2026-10-11')).toBeNull();
  });
});

describe('tags', () => {
  it('normalizes a typed tag: strips #, collapses space, cuts to length, refuses blank', () => {
    expect(normalizeJournalTag('  #  slow   morning ')).toBe('slow morning');
    expect(normalizeJournalTag('   ')).toBeNull();
    expect(normalizeJournalTag('#')).toBeNull();
    expect(normalizeJournalTag('x'.repeat(100))!.length).toBe(JOURNAL_TAG_MAX_LENGTH);
  });

  it('cleans a list: no repeats by case, in order, capped', () => {
    expect(cleanJournalTags(['Work', 'work', ' family ', ''])).toEqual(['Work', 'family']);
    const many = Array.from({ length: 20 }, (_, i) => `t${i}`);
    expect(cleanJournalTags(many)).toHaveLength(JOURNAL_TAGS_PER_ENTRY);
  });

  it('lists the tags in use for one kind A to Z, not by how often', () => {
    const list = [
      entry({ tags: ['zebra', 'apple'] }),
      entry({ tags: ['Apple'] }),
      entry({ tags: ['zebra'] }),
      entry({ kind: 'dream', tags: ['lucid'] }),
    ];
    expect(journalTagsIn(list, 'journal')).toEqual(['apple', 'zebra']);
    expect(journalTagsIn(list, 'dream')).toEqual(['lucid']);
  });

  it('finds entries by tag ignoring case', () => {
    const list = [entry({ id: 'a', tags: ['Work'] }), entry({ id: 'b' }), entry({ id: 'c', tags: ['home'] })];
    expect(entriesWithTag(list, 'WORK').map(e => e.id)).toEqual(['a']);
  });
});

describe('people', () => {
  it('lists open entries naming a person, newest first, and nothing sealed', () => {
    const list = [
      entry({ id: 'a', personIds: ['p1'], loggedAt: '2026-10-01T09:00:00.000Z' }),
      entry({ id: 'b', personIds: ['p1', 'p2'], loggedAt: '2026-10-05T09:00:00.000Z' }),
      entry({ id: 'c', personIds: ['p2'] }),
      entry({ id: 'd', personIds: ['p1'], openOn: '2999-01-01' }),
      entry({ id: 'e' }),
    ];
    expect(entriesAboutPerson(list, 'p1', '2026-10-11').map(e => e.id)).toEqual(['b', 'a']);
  });

  it('cleans person ids: no blanks, no repeats', () => {
    expect(cleanPersonIds(['a', '', 'a', 'b'])).toEqual(['a', 'b']);
  });
});

describe('sealShortcuts', () => {
  it('works each from the given day and all land later than it', () => {
    const found = sealShortcuts('2026-10-11');
    expect(found.map(s => s.dayKey)).toEqual(['2026-11-11', '2027-04-11', '2027-10-11', '2027-01-01']);
    for (const s of found) expect(s.dayKey > '2026-10-11').toBe(true);
  });

  it('clamps a month that is shorter', () => {
    expect(sealShortcuts('2026-08-31')[0].dayKey).toBe('2026-09-30');
  });
});

describe('journalSnippet', () => {
  it('strips formatting and cuts at a word', () => {
    expect(journalSnippet('# Title\nSome **bold** words')).toBe('Title Some bold words');
    const cut = journalSnippet('alpha beta gamma delta epsilon', 14);
    expect(cut).toBe('alpha beta…');
  });
});

describe('custom prompts', () => {
  it('reads the stored setting defensively', () => {
    expect(parseJournalCustomPrompts(null)).toEqual([]);
    expect(parseJournalCustomPrompts('not json')).toEqual([]);
    expect(parseJournalCustomPrompts('{"a":1}')).toEqual([]);
    expect(parseJournalCustomPrompts('["One", 5, "  two  ", "one"]')).toEqual(['One', 'two']);
  });

  it('caps the list and each prompt', () => {
    expect(cleanJournalPrompts(Array.from({ length: 40 }, (_, i) => `p${i}`))).toHaveLength(JOURNAL_CUSTOM_PROMPTS_MAX);
    expect(cleanJournalPrompts(['x'.repeat(500)])[0].length).toBeLessThanOrEqual(120);
  });

  it('puts the person\'s prompts before the built-in ones and steps through all of them', () => {
    const list = journalPromptList(['Mine']);
    expect(list[0]).toBe('Mine');
    expect(list).toHaveLength(JOURNAL_PROMPTS.length + 1);
    expect(journalPromptAt(0, list)).toBe('Mine');
    expect(journalPromptAt(list.length, list)).toBe('Mine');
    expect(journalPromptList([])).toBe(JOURNAL_PROMPTS);
  });
});
