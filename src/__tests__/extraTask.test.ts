import type { ExtraTaskDraft } from '@/types';
import {
  MIN_EXTRA_TASK_EVERY_N,
  advanceExtraTaskTally,
  completionsUntilExtraTask,
  describeExtraTaskDraft,
  describeExtraTaskRule,
  emptyExtraTaskDraft,
  extraTaskDraftIsEmpty,
  extraTaskRule,
  extraTaskSummary,
  parseExtraTaskDraft,
} from '@/utils/extraTask';

describe('extraTaskRule', () => {
  const rule = (extraTaskEveryN: number | null, extraTaskTitle: string | null) =>
    extraTaskRule({ extraTaskEveryN, extraTaskTitle });

  it('needs both a count and a title', () => {
    expect(rule(4, 'Rosin the bow')).toEqual({ everyN: 4, title: 'Rosin the bow', draft: null });
    expect(rule(null, 'Rosin the bow')).toBeNull();
    expect(rule(4, null)).toBeNull();
  });

  it('treats a blank or whitespace title as no rule, and trims the one it keeps', () => {
    expect(rule(4, '')).toBeNull();
    expect(rule(4, '   ')).toBeNull();
    expect(rule(4, '  Rosin the bow  ')).toEqual({ everyN: 4, title: 'Rosin the bow', draft: null });
  });

  it('rejects a count below the floor — every 1st is every time', () => {
    expect(rule(1, 'Rosin the bow')).toBeNull();
    expect(rule(0, 'Rosin the bow')).toBeNull();
    expect(rule(MIN_EXTRA_TASK_EVERY_N, 'Rosin the bow')).not.toBeNull();
  });
});

describe('advanceExtraTaskTally', () => {
  it('counts up and fires on the Nth, resetting to zero', () => {
    expect(advanceExtraTaskTally(0, 4)).toEqual({ tally: 1, spawns: false });
    expect(advanceExtraTaskTally(1, 4)).toEqual({ tally: 2, spawns: false });
    expect(advanceExtraTaskTally(2, 4)).toEqual({ tally: 3, spawns: false });
    expect(advanceExtraTaskTally(3, 4)).toEqual({ tally: 0, spawns: true });
  });

  it('runs the cycle again from zero', () => {
    let tally = 0;
    const fired: number[] = [];
    for (let completion = 1; completion <= 8; completion++) {
      const next = advanceExtraTaskTally(tally, 4);
      tally = next.tally;
      if (next.spawns) fired.push(completion);
    }
    expect(fired).toEqual([4, 8]);
  });

  it('fires at the floor on every completion of a 2', () => {
    expect(advanceExtraTaskTally(0, 2)).toEqual({ tally: 1, spawns: false });
    expect(advanceExtraTaskTally(1, 2)).toEqual({ tally: 0, spawns: true });
  });

  // Lowering N mid-run shouldn't make the user wait out a full extra cycle.
  it('fires immediately when the tally already sits past a lowered N', () => {
    expect(advanceExtraTaskTally(7, 3)).toEqual({ tally: 0, spawns: true });
  });

  it('treats a negative tally as zero', () => {
    expect(advanceExtraTaskTally(-3, 4)).toEqual({ tally: 1, spawns: false });
  });
});

describe('completionsUntilExtraTask', () => {
  it('counts down toward the next one', () => {
    expect(completionsUntilExtraTask(0, 4)).toBe(4);
    expect(completionsUntilExtraTask(3, 4)).toBe(1);
  });

  it('never reads as zero or fewer', () => {
    expect(completionsUntilExtraTask(4, 4)).toBe(1);
    expect(completionsUntilExtraTask(9, 4)).toBe(1);
  });
});

describe('extraTaskSummary', () => {
  it('is the count on its own', () => {
    expect(extraTaskSummary(4)).toBe('Every 4th');
    expect(extraTaskSummary(2)).toBe('Every 2nd');
  });

  it('is undefined when there is no rule, so the row shows its hint', () => {
    expect(extraTaskSummary(null)).toBeUndefined();
    expect(extraTaskSummary(1)).toBeUndefined();
  });
});

describe('describeExtraTaskRule', () => {
  it('says what will happen, and where the task lands', () => {
    expect(describeExtraTaskRule(4, 'Rosin the bow', true))
      .toBe('Adds “Rosin the bow” every 4th completion, due with the next one');
  });

  it('lands it on the day when the task does not repeat', () => {
    expect(describeExtraTaskRule(4, 'Rosin the bow', false))
      .toBe('Adds “Rosin the bow” every 4th completion, due that day');
  });

  it('asks for the missing half rather than describing a rule that will not fire', () => {
    expect(describeExtraTaskRule(4, '', true)).toBe('Name the task to add every 4th completion');
    expect(describeExtraTaskRule(4, '   ', true)).toBe('Name the task to add every 4th completion');
  });

  it('says so when there is no rule at all', () => {
    expect(describeExtraTaskRule(null, 'Rosin the bow', true)).toBe('No extra task');
  });
});

describe('extraTaskRule — the draft it carries', () => {
  const draft: ExtraTaskDraft = { ...emptyExtraTaskDraft(), notes: 'In the case pocket' };

  it('hands the draft through when there is one', () => {
    expect(extraTaskRule({ extraTaskEveryN: 4, extraTaskTitle: 'Rosin', extraTaskDraft: draft }))
      .toEqual({ everyN: 4, title: 'Rosin', draft });
  });

  it('is null for a rule that was never given one — every rule written before drafts existed', () => {
    expect(extraTaskRule({ extraTaskEveryN: 4, extraTaskTitle: 'Rosin' })?.draft).toBeNull();
    expect(extraTaskRule({ extraTaskEveryN: 4, extraTaskTitle: 'Rosin', extraTaskDraft: null })?.draft).toBeNull();
  });

  it('does not make a rule live on its own — a draft with no count and name is nothing', () => {
    expect(extraTaskRule({ extraTaskEveryN: null, extraTaskTitle: 'Rosin', extraTaskDraft: draft })).toBeNull();
    expect(extraTaskRule({ extraTaskEveryN: 4, extraTaskTitle: null, extraTaskDraft: draft })).toBeNull();
  });
});

describe('parseExtraTaskDraft', () => {
  it('reads a draft back off its column', () => {
    const draft: ExtraTaskDraft = {
      notes: 'In the case pocket',
      category: 'Home',
      projectId: 'proj1',
      tags: ['violin'],
      priority: 2,
      effort: 1,
      estimatedMinutes: 5,
      timeSegments: ['evening'],
      subtasks: [{ id: 's1', title: 'Wipe the strings' }],
    };
    expect(parseExtraTaskDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it('reads nothing at all as no draft — which is what "just the title" means', () => {
    expect(parseExtraTaskDraft(null)).toBeNull();
    expect(parseExtraTaskDraft(undefined)).toBeNull();
    expect(parseExtraTaskDraft('')).toBeNull();
  });

  it('shrugs off a blob that is not an object, rather than throwing at read time', () => {
    expect(parseExtraTaskDraft('not json')).toBeNull();
    expect(parseExtraTaskDraft('[1,2,3]')).toBeNull();
    expect(parseExtraTaskDraft('"a string"')).toBeNull();
    expect(parseExtraTaskDraft('null')).toBeNull();
  });

  it('defaults every field it is not given, so a draft from an older build comes back complete', () => {
    expect(parseExtraTaskDraft('{"notes":"hi"}')).toEqual({ ...emptyExtraTaskDraft(), notes: 'hi' });
  });

  it('drops values of the wrong shape rather than carrying them onto a Task', () => {
    const parsed = parseExtraTaskDraft(JSON.stringify({
      notes: 42,
      category: 7,
      tags: ['ok', 3, null],
      priority: 9,
      effort: -1,
      estimatedMinutes: 'soon',
      timeSegments: ['evening', 'teatime'],
      subtasks: [{ id: 's1', title: 'Real' }, { id: 5 }, null, 'nope'],
    }));
    expect(parsed).toEqual({
      ...emptyExtraTaskDraft(),
      tags: ['ok'],
      timeSegments: ['evening'],
      subtasks: [{ id: 's1', title: 'Real' }],
    });
  });
});

describe('extraTaskDraftIsEmpty', () => {
  it('is true for no draft and for one that says nothing', () => {
    expect(extraTaskDraftIsEmpty(null)).toBe(true);
    expect(extraTaskDraftIsEmpty(emptyExtraTaskDraft())).toBe(true);
    // Whitespace-only notes are nothing, the same call extraTaskRule makes
    // about a whitespace title.
    expect(extraTaskDraftIsEmpty({ ...emptyExtraTaskDraft(), notes: '   ' })).toBe(true);
  });

  it('is false as soon as one field is answered', () => {
    const empty = emptyExtraTaskDraft();
    expect(extraTaskDraftIsEmpty({ ...empty, notes: 'x' })).toBe(false);
    expect(extraTaskDraftIsEmpty({ ...empty, category: 'Home' })).toBe(false);
    expect(extraTaskDraftIsEmpty({ ...empty, projectId: 'p1' })).toBe(false);
    expect(extraTaskDraftIsEmpty({ ...empty, tags: ['a'] })).toBe(false);
    expect(extraTaskDraftIsEmpty({ ...empty, priority: 1 })).toBe(false);
    expect(extraTaskDraftIsEmpty({ ...empty, effort: 1 })).toBe(false);
    expect(extraTaskDraftIsEmpty({ ...empty, estimatedMinutes: 5 })).toBe(false);
    expect(extraTaskDraftIsEmpty({ ...empty, timeSegments: ['evening'] })).toBe(false);
    expect(extraTaskDraftIsEmpty({ ...empty, subtasks: [{ id: 's', title: 't' }] })).toBe(false);
  });
});

describe('describeExtraTaskDraft', () => {
  const empty = emptyExtraTaskDraft();

  it('says nothing when there is nothing set, so the row reads as "just the title"', () => {
    expect(describeExtraTaskDraft(null, null, null)).toBeUndefined();
    expect(describeExtraTaskDraft(empty, null, null)).toBeUndefined();
  });

  it('names one or two things', () => {
    expect(describeExtraTaskDraft({ ...empty, category: 'Home' }, '🏠 Home', null)).toBe('🏠 Home');
    expect(describeExtraTaskDraft({ ...empty, category: 'Home', priority: 3 }, '🏠 Home', null))
      .toBe('🏠 Home · High');
  });

  it('falls back to a count past two — a third name truncates mid-word on one line', () => {
    expect(describeExtraTaskDraft(
      { ...empty, category: 'Home', priority: 3, notes: 'hi' }, 'Home', null
    )).toBe('3 details');
  });

  it('prefers a custom estimate over the effort band it overrides', () => {
    expect(describeExtraTaskDraft({ ...empty, effort: 2, estimatedMinutes: 5 }, null, null)).toBe('5 min');
    expect(describeExtraTaskDraft({ ...empty, effort: 2 }, null, null)).toBe('XS');
  });

  it('counts tags and subtasks rather than listing them', () => {
    expect(describeExtraTaskDraft({ ...empty, tags: ['a'] }, null, null)).toBe('1 tag');
    expect(describeExtraTaskDraft({ ...empty, tags: ['a', 'b'] }, null, null)).toBe('2 tags');
    expect(describeExtraTaskDraft({ ...empty, subtasks: [{ id: 's', title: 't' }] }, null, null))
      .toBe('1 subtask');
  });

  it('skips a category or project whose name could not be resolved, rather than naming an id', () => {
    // A deleted project the draft still points at — resolve-or-shrug, the
    // house rule for every cross-row pointer here.
    expect(describeExtraTaskDraft({ ...empty, projectId: 'gone', priority: 1 }, null, null)).toBe('Low');
  });
});
