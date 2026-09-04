import type { FollowUpTaskDraft } from '@/types';
import {
  MIN_FOLLOW_UP_TASK_EVERY_N,
  advanceFollowUpTaskTally,
  completionsUntilFollowUpTask,
  describeFollowUpTaskDraft,
  describeFollowUpTaskRule,
  canHoldFollowUpTask,
  emptyFollowUpTaskDraft,
  followUpTaskDraftIsEmpty,
  followUpTaskRule,
  followUpTaskSummary,
  followUpTaskSuppressedBy,
  parseFollowUpTaskDraft,
} from '@/utils/followUpTask';

describe('followUpTaskRule', () => {
  const rule = (followUpTaskEveryN: number | null, followUpTaskTitle: string | null) =>
    followUpTaskRule({ followUpTaskEveryN, followUpTaskTitle });

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
    expect(rule(MIN_FOLLOW_UP_TASK_EVERY_N, 'Rosin the bow')).not.toBeNull();
  });
});

describe('canHoldFollowUpTask', () => {
  // Exactly canHoldSupply's rule, for exactly its reason — the tally rides onto
  // the successor a completion spawns, so a task that spawns none has nowhere
  // to carry it and could never reach the second completion the floor of 2
  // requires.
  it('needs a repeat, because a one-off is completed once', () => {
    expect(canHoldFollowUpTask({ recurrenceType: 'none', parentId: null })).toBe(false);
    expect(canHoldFollowUpTask({ recurrenceType: 'daily', parentId: null })).toBe(true);
  });

  it('refuses a subtask, which has no run of its own', () => {
    expect(canHoldFollowUpTask({ recurrenceType: 'daily', parentId: 'parent-1' })).toBe(false);
  });
});

describe('advanceFollowUpTaskTally', () => {
  it('counts up and fires on the Nth, resetting to zero', () => {
    expect(advanceFollowUpTaskTally(0, 4)).toEqual({ tally: 1, spawns: false });
    expect(advanceFollowUpTaskTally(1, 4)).toEqual({ tally: 2, spawns: false });
    expect(advanceFollowUpTaskTally(2, 4)).toEqual({ tally: 3, spawns: false });
    expect(advanceFollowUpTaskTally(3, 4)).toEqual({ tally: 0, spawns: true });
  });

  it('runs the cycle again from zero', () => {
    let tally = 0;
    const fired: number[] = [];
    for (let completion = 1; completion <= 8; completion++) {
      const next = advanceFollowUpTaskTally(tally, 4);
      tally = next.tally;
      if (next.spawns) fired.push(completion);
    }
    expect(fired).toEqual([4, 8]);
  });

  it('fires at the floor on every completion of a 2', () => {
    expect(advanceFollowUpTaskTally(0, 2)).toEqual({ tally: 1, spawns: false });
    expect(advanceFollowUpTaskTally(1, 2)).toEqual({ tally: 0, spawns: true });
  });

  // Lowering N mid-run shouldn't make the user wait out a full extra cycle.
  it('fires immediately when the tally already sits past a lowered N', () => {
    expect(advanceFollowUpTaskTally(7, 3)).toEqual({ tally: 0, spawns: true });
  });

  it('treats a negative tally as zero', () => {
    expect(advanceFollowUpTaskTally(-3, 4)).toEqual({ tally: 1, spawns: false });
  });
});

describe('completionsUntilFollowUpTask', () => {
  it('counts down toward the next one', () => {
    expect(completionsUntilFollowUpTask(0, 4)).toBe(4);
    expect(completionsUntilFollowUpTask(3, 4)).toBe(1);
  });

  it('never reads as zero or fewer', () => {
    expect(completionsUntilFollowUpTask(4, 4)).toBe(1);
    expect(completionsUntilFollowUpTask(9, 4)).toBe(1);
  });
});

describe('followUpTaskSummary', () => {
  it('is the count on its own', () => {
    expect(followUpTaskSummary(4)).toBe('Every 4th');
    expect(followUpTaskSummary(2)).toBe('Every 2nd');
  });

  it('is undefined when there is no rule, so the row shows its hint', () => {
    expect(followUpTaskSummary(null)).toBeUndefined();
    expect(followUpTaskSummary(1)).toBeUndefined();
  });
});

describe('describeFollowUpTaskRule', () => {
  it('says where the task lands, and only that', () => {
    expect(describeFollowUpTaskRule(4, 'Rosin the bow')).toBe('Due with the next occurrence');
  });

  // The count and the title are both on screen — the stepper says one and the
  // field beside it holds the other — so a caption repeating either is the
  // user's own input read back at them.
  it('quotes neither the title nor the count', () => {
    const caption = describeFollowUpTaskRule(4, 'Rosin the bow');
    expect(caption).not.toContain('Rosin the bow');
    expect(caption).not.toContain('4th');
  });

  it('asks for the missing half rather than describing a rule that will not fire', () => {
    expect(describeFollowUpTaskRule(4, '')).toBe('Name the task to add');
    expect(describeFollowUpTaskRule(4, '   ')).toBe('Name the task to add');
  });

  it('says so when there is no rule at all', () => {
    expect(describeFollowUpTaskRule(null, 'Rosin the bow')).toBe('No follow-up task');
  });
});

describe('followUpTaskRule — the draft it carries', () => {
  const draft: FollowUpTaskDraft = { ...emptyFollowUpTaskDraft(), notes: 'In the case pocket' };

  it('hands the draft through when there is one', () => {
    expect(followUpTaskRule({ followUpTaskEveryN: 4, followUpTaskTitle: 'Rosin', followUpTaskDraft: draft }))
      .toEqual({ everyN: 4, title: 'Rosin', draft });
  });

  it('is null for a rule that was never given one — every rule written before drafts existed', () => {
    expect(followUpTaskRule({ followUpTaskEveryN: 4, followUpTaskTitle: 'Rosin' })?.draft).toBeNull();
    expect(followUpTaskRule({ followUpTaskEveryN: 4, followUpTaskTitle: 'Rosin', followUpTaskDraft: null })?.draft).toBeNull();
  });

  it('does not make a rule live on its own — a draft with no count and name is nothing', () => {
    expect(followUpTaskRule({ followUpTaskEveryN: null, followUpTaskTitle: 'Rosin', followUpTaskDraft: draft })).toBeNull();
    expect(followUpTaskRule({ followUpTaskEveryN: 4, followUpTaskTitle: null, followUpTaskDraft: draft })).toBeNull();
  });
});

describe('parseFollowUpTaskDraft', () => {
  it('reads a draft back off its column', () => {
    const draft: FollowUpTaskDraft = {
      notes: 'In the case pocket',
      category: 'Home',
      projectId: 'proj1',
      tags: ['violin'],
      priority: 2,
      effort: 1,
      estimatedMinutes: 5,
      timeSegments: ['evening'],
      vacationPause: false,
      subtasks: [{ id: 's1', title: 'Wipe the strings' }],
    };
    expect(parseFollowUpTaskDraft(JSON.stringify(draft))).toEqual(draft);
  });

  it('reads nothing at all as no draft — which is what "just the title" means', () => {
    expect(parseFollowUpTaskDraft(null)).toBeNull();
    expect(parseFollowUpTaskDraft(undefined)).toBeNull();
    expect(parseFollowUpTaskDraft('')).toBeNull();
  });

  it('shrugs off a blob that is not an object, rather than throwing at read time', () => {
    expect(parseFollowUpTaskDraft('not json')).toBeNull();
    expect(parseFollowUpTaskDraft('[1,2,3]')).toBeNull();
    expect(parseFollowUpTaskDraft('"a string"')).toBeNull();
    expect(parseFollowUpTaskDraft('null')).toBeNull();
  });

  it('defaults every field it is not given, so a draft from an older build comes back complete', () => {
    expect(parseFollowUpTaskDraft('{"notes":"hi"}')).toEqual({ ...emptyFollowUpTaskDraft(), notes: 'hi' });
  });

  it('drops values of the wrong shape rather than carrying them onto a Task', () => {
    const parsed = parseFollowUpTaskDraft(JSON.stringify({
      notes: 42,
      category: 7,
      tags: ['ok', 3, null],
      priority: 9,
      effort: -1,
      estimatedMinutes: 'soon',
      timeSegments: ['evening', 'teatime'],
      vacationPause: false,
      subtasks: [{ id: 's1', title: 'Real' }, { id: 5 }, null, 'nope'],
    }));
    expect(parsed).toEqual({
      ...emptyFollowUpTaskDraft(),
      tags: ['ok'],
      timeSegments: ['evening'],
      vacationPause: false,
      subtasks: [{ id: 's1', title: 'Real' }],
    });
  });
});

describe('followUpTaskDraftIsEmpty', () => {
  it('is true for no draft and for one that says nothing', () => {
    expect(followUpTaskDraftIsEmpty(null)).toBe(true);
    expect(followUpTaskDraftIsEmpty(emptyFollowUpTaskDraft())).toBe(true);
    // Whitespace-only notes are nothing, the same call followUpTaskRule makes
    // about a whitespace title.
    expect(followUpTaskDraftIsEmpty({ ...emptyFollowUpTaskDraft(), notes: '   ' })).toBe(true);
  });

  it('is false as soon as one field is answered', () => {
    const empty = emptyFollowUpTaskDraft();
    expect(followUpTaskDraftIsEmpty({ ...empty, notes: 'x' })).toBe(false);
    expect(followUpTaskDraftIsEmpty({ ...empty, category: 'Home' })).toBe(false);
    expect(followUpTaskDraftIsEmpty({ ...empty, projectId: 'p1' })).toBe(false);
    expect(followUpTaskDraftIsEmpty({ ...empty, tags: ['a'] })).toBe(false);
    expect(followUpTaskDraftIsEmpty({ ...empty, priority: 1 })).toBe(false);
    expect(followUpTaskDraftIsEmpty({ ...empty, effort: 1 })).toBe(false);
    expect(followUpTaskDraftIsEmpty({ ...empty, estimatedMinutes: 5 })).toBe(false);
    expect(followUpTaskDraftIsEmpty({ ...empty, timeSegments: ['evening'] })).toBe(false);
    expect(followUpTaskDraftIsEmpty({ ...empty, subtasks: [{ id: 's', title: 't' }] })).toBe(false);
  });
});

describe('describeFollowUpTaskDraft', () => {
  const empty = emptyFollowUpTaskDraft();

  it('says nothing when there is nothing set, so the row reads as "just the title"', () => {
    expect(describeFollowUpTaskDraft(null, null, null)).toBeUndefined();
    expect(describeFollowUpTaskDraft(empty, null, null)).toBeUndefined();
  });

  it('names one or two things', () => {
    expect(describeFollowUpTaskDraft({ ...empty, category: 'Home' }, '🏠 Home', null)).toBe('🏠 Home');
    expect(describeFollowUpTaskDraft({ ...empty, category: 'Home', priority: 3 }, '🏠 Home', null))
      .toBe('🏠 Home · High');
  });

  it('falls back to a count past two — a third name truncates mid-word on one line', () => {
    expect(describeFollowUpTaskDraft(
      { ...empty, category: 'Home', priority: 3, notes: 'hi' }, 'Home', null
    )).toBe('3 details');
  });

  it('prefers a custom estimate over the effort band it overrides', () => {
    expect(describeFollowUpTaskDraft({ ...empty, effort: 2, estimatedMinutes: 5 }, null, null)).toBe('5 min');
    expect(describeFollowUpTaskDraft({ ...empty, effort: 2 }, null, null)).toBe('XS');
  });

  it('counts tags and subtasks rather than listing them', () => {
    expect(describeFollowUpTaskDraft({ ...empty, tags: ['a'] }, null, null)).toBe('1 tag');
    expect(describeFollowUpTaskDraft({ ...empty, tags: ['a', 'b'] }, null, null)).toBe('2 tags');
    expect(describeFollowUpTaskDraft({ ...empty, subtasks: [{ id: 's', title: 't' }] }, null, null))
      .toBe('1 subtask');
  });

  it('skips a category or project whose name could not be resolved, rather than naming an id', () => {
    // A deleted project the draft still points at — resolve-or-shrug, the
    // house rule for every cross-row pointer here.
    expect(describeFollowUpTaskDraft({ ...empty, projectId: 'gone', priority: 1 }, null, null)).toBe('Low');
  });
});

describe('followUpTaskSuppressedBy', () => {
  const rule = (over: Partial<FollowUpTaskDraft> | null = null) => ({
    everyN: 4,
    title: 'Rosin the bow',
    draft: over === null ? null : { ...emptyFollowUpTaskDraft(), ...over },
  });

  it('lets a spawn through when nothing is standing in its way', () => {
    expect(followUpTaskSuppressedBy(rule(), false, false, false)).toBeNull();
  });

  it('suppresses on vacation only when the added task is one vacation hides', () => {
    expect(followUpTaskSuppressedBy(rule({ vacationPause: true }), false, true, false)).toBe('vacation');
    // The flag is how each rule answers for itself, so a rule that never set
    // it keeps firing — vacation mode alone is not the gate.
    expect(followUpTaskSuppressedBy(rule({ vacationPause: false }), false, true, false)).toBeNull();
    // And a rule written before drafts existed carries no draft at all.
    expect(followUpTaskSuppressedBy(rule(null), false, true, false)).toBeNull();
  });

  it('does not suppress off vacation, however the flag is set', () => {
    expect(followUpTaskSuppressedBy(rule({ vacationPause: true }), false, false, false)).toBeNull();
  });

  it('suppresses a one-at-a-time rule while one of its own is outstanding', () => {
    expect(followUpTaskSuppressedBy(rule(), true, false, true)).toBe('pending');
    expect(followUpTaskSuppressedBy(rule(), true, false, false)).toBeNull();
    // Off by default: a rule that never asked for this piles up as it always did.
    expect(followUpTaskSuppressedBy(rule(), false, false, true)).toBeNull();
  });

  it('names vacation first when both reasons apply', () => {
    expect(followUpTaskSuppressedBy(rule({ vacationPause: true }), true, true, true)).toBe('vacation');
  });
});

describe('a suppressed spawn does not consume the tally', () => {
  // The pairing the store relies on: the advance still reports `spawns`, and
  // holding the tally at what it was means the *next* completion fires,
  // rather than another full N-completion wait. See followUpTaskSuppressedBy.
  it('fires on the first completion after the reason passes', () => {
    const everyN = 4;
    // What the store does on each completion: advance, then keep the old
    // tally instead of the advance's when the spawn was suppressed.
    const complete = (tally: number, suppressed: boolean) => {
      const advance = advanceFollowUpTaskTally(tally, everyN);
      return {
        tally: suppressed ? tally : advance.tally,
        spawned: advance.spawns && !suppressed,
      };
    };

    // Three showers get it to the brink.
    let state = complete(0, false);
    state = complete(state.tally, false);
    state = complete(state.tally, false);
    expect(state).toEqual({ tally: 3, spawned: false });

    // A week away. Every completion earns it and every one is held, so the
    // tally neither resets nor climbs.
    for (let i = 0; i < 7; i++) {
      state = complete(state.tally, true);
      expect(state).toEqual({ tally: 3, spawned: false });
    }

    // Home again: the very next completion spawns, once.
    state = complete(state.tally, false);
    expect(state).toEqual({ tally: 0, spawned: true });
  });

  it('reads as "1 completion until the next one" throughout the suppression', () => {
    expect(completionsUntilFollowUpTask(3, 4)).toBe(1);
  });
});
