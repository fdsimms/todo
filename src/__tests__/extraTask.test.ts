import {
  MIN_EXTRA_TASK_EVERY_N,
  advanceExtraTaskTally,
  completionsUntilExtraTask,
  describeExtraTaskRule,
  extraTaskRule,
  extraTaskSummary,
} from '@/utils/extraTask';

describe('extraTaskRule', () => {
  const rule = (extraTaskEveryN: number | null, extraTaskTitle: string | null) =>
    extraTaskRule({ extraTaskEveryN, extraTaskTitle });

  it('needs both a count and a title', () => {
    expect(rule(4, 'Rosin the bow')).toEqual({ everyN: 4, title: 'Rosin the bow' });
    expect(rule(null, 'Rosin the bow')).toBeNull();
    expect(rule(4, null)).toBeNull();
  });

  it('treats a blank or whitespace title as no rule, and trims the one it keeps', () => {
    expect(rule(4, '')).toBeNull();
    expect(rule(4, '   ')).toBeNull();
    expect(rule(4, '  Rosin the bow  ')).toEqual({ everyN: 4, title: 'Rosin the bow' });
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
