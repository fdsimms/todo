import { describeDeadlineRule, describeHealthTarget, describeReminderRule, describeRepeat, describeRotation, describeSupplyFields, hasRelativeDeadline, LIMITS, taskFieldsPatch, type TaskFieldsInput } from '../taskFields';
import { HEALTH_TARGET_RANGES } from '../../../src/utils/healthTarget';
import type { FollowUpTaskDraft, Task } from '../../../src/types';

let n = 0;
const deps = {
  newId: () => `id${++n}`,
  emptyFollowUpDraft: (): FollowUpTaskDraft => ({
    notes: '', category: null, projectId: null, tags: [], priority: 0, effort: 0, difficulty: null,
    estimatedMinutes: null, timeSegments: [], vacationPause: false, subtasks: [],
  }),
};

const patchOf = (input: TaskFieldsInput, current: Task | null = null) => taskFieldsPatch(input, current, deps);
const ok = (input: TaskFieldsInput, current: Task | null = null) => {
  const r = patchOf(input, current);
  expect(r.errors).toEqual([]);
  return r.patch;
};
const errorsOf = (input: TaskFieldsInput, current: Task | null = null) => patchOf(input, current).errors.join(' ');

const existing = (over: Partial<Task> = {}): Task => ({
  id: 't1', title: 'x', parentId: null, recurrenceType: 'none', chainEnabled: false, chainItems: [], chainIndex: 0,
  targetCount: null, ...over,
}) as Task;

describe('pinning', () => {
  it('passes pin and pin-each-occurrence straight through', () => {
    expect(ok({ pinned: true, pinEachOccurrence: true })).toMatchObject({ pinned: true, pinEachOccurrence: true });
  });
});

describe('a deadline worked out from the date', () => {
  it('is dropped when a fixed deadline is written, or the deadline cleared, as the editor\'s "Fixed date" does', () => {
    const relative = existing({ deadlineOffsetDays: 3, deadlineMonthDay: null });
    expect(ok({ deadline: '2026-10-10' }, relative)).toMatchObject({ deadlineOffsetDays: null, deadlineMonthDay: null });
    expect(ok({ deadline: null }, existing({ deadlineOffsetDays: null, deadlineMonthDay: -1 }))).toMatchObject({ deadline: null, deadlineOffsetDays: null, deadlineMonthDay: null });
    // Nothing to drop on a fixed deadline, and nothing touched by an edit that
    // leaves the deadline alone.
    expect(ok({ deadline: '2026-10-10' }, existing({ deadlineOffsetDays: null, deadlineMonthDay: null }))).not.toHaveProperty('deadlineOffsetDays');
    expect(ok({ notes: 'x' }, relative)).not.toHaveProperty('deadlineOffsetDays');
  });

  it('is described in the two directions, and the month day with its last-day case', () => {
    expect(describeDeadlineRule({ deadlineOffsetDays: 3, deadlineMonthDay: null })).toEqual({ daysBeforeDate: 3 });
    expect(describeDeadlineRule({ deadlineOffsetDays: -9, deadlineMonthDay: null })).toEqual({ daysAfterDate: 9 });
    expect(describeDeadlineRule({ deadlineOffsetDays: null, deadlineMonthDay: 15 })).toEqual({ dayOfMonth: 15 });
    expect(describeDeadlineRule({ deadlineOffsetDays: null, deadlineMonthDay: -1 })).toEqual({ dayOfMonth: 'last' });
    expect(describeDeadlineRule({ deadlineOffsetDays: null, deadlineMonthDay: null })).toBeNull();
    expect(hasRelativeDeadline(null)).toBe(false);
  });
});

describe('a reminder placed by rule', () => {
  it('is described as days before the date, or as the moment the task surfaces', () => {
    expect(describeReminderRule({ reminderOffsetDays: 2, reminderTracksVisibility: false })).toEqual({ daysBeforeDate: 2 });
    expect(describeReminderRule({ reminderOffsetDays: null, reminderTracksVisibility: true })).toEqual({ whenItSurfaces: true });
    expect(describeReminderRule({ reminderOffsetDays: null, reminderTracksVisibility: false })).toBeNull();
  });
});

describe('a target that follows the water goal', () => {
  const water = existing({ followWaterTarget: true, targetCount: 8, quotaPeriod: 'day', logHealthMetric: 'waterMl', logHealthAmount: 250 });

  it('refuses a count, since the app writes that each day', () => {
    expect(errorsOf({ target: { count: 10, per: 'day' } }, water)).toMatch(/follows the food log's water goal/);
    expect(patchOf({ target: { count: 10, per: 'day' } }, water).patch).not.toHaveProperty('targetCount');
  });

  it('lets the target go, and takes the flag with it', () => {
    expect(ok({ target: null }, water)).toMatchObject({ targetCount: null, followWaterTarget: false });
  });

  it('leaves an ordinary target alone', () => {
    expect(ok({ target: { count: 10, per: 'day' } }, existing({ followWaterTarget: false }))).toMatchObject({ targetCount: 10 });
    expect(ok({ target: { count: 10, per: 'day' } })).not.toHaveProperty('followWaterTarget');
  });
});

describe('repeat', () => {
  it('writes "the 15th of every month" the way the editor does', () => {
    expect(ok({ repeat: { every: 'month', monthDay: 15 } })).toMatchObject({
      recurrenceType: 'monthly', recurrenceInterval: 1, recurrenceMonthDay: 15, recurrenceWeekOrdinal: null, recurrenceDays: [],
    });
  });

  it('writes "the 2nd Tuesday" and "the last Friday"', () => {
    expect(ok({ repeat: { every: 'month', nthWeekday: { ordinal: 2, weekday: 2 } } })).toMatchObject({
      recurrenceWeekOrdinal: 2, recurrenceDays: [2], recurrenceMonthDay: null,
    });
    expect(ok({ repeat: { every: 'month', nthWeekday: { ordinal: -1, weekday: 5 } } })).toMatchObject({
      recurrenceWeekOrdinal: -1, recurrenceDays: [5],
    });
  });

  it('writes a yearly date and a weekly pattern', () => {
    expect(ok({ repeat: { every: 'year', month: 3, monthDay: 3 } })).toMatchObject({ recurrenceType: 'yearly', recurrenceMonth: 3, recurrenceMonthDay: 3 });
    expect(ok({ repeat: { every: 'week', weekdays: [3, 1, 1] } })).toMatchObject({ recurrenceType: 'weekly', recurrenceDays: [1, 3] });
  });

  it('takes a holiday rule, reads it back, and refuses one on an hourly repeat', () => {
    const written = ok({ repeat: { every: 'week', weekdays: [2], holidays: 'move' } });
    expect(written).toMatchObject({ recurrenceType: 'weekly', recurrenceHolidays: 'move' });
    expect(describeRepeat({ ...written, recurrenceInterval: 1, recurrenceDays: [2] } as Task)).toMatchObject({ every: 'week', holidays: 'move' });
    expect(ok({ repeat: { every: 'week', weekdays: [2] } })).toMatchObject({ recurrenceHolidays: null });
    expect(errorsOf({ repeat: { every: 'hours', interval: 4, holidays: 'skip' } })).toMatch(/no days to skip/);
  });

  it('takes a rain threshold, reads it back, and refuses one on an hourly repeat', () => {
    const written = ok({ repeat: { every: 'day', interval: 2, skipAfterRainMm: 5 } });
    expect(written).toMatchObject({ recurrenceType: 'daily', rainSkipMm: 5 });
    expect(describeRepeat({ ...written, recurrenceDays: [] } as unknown as Task)).toMatchObject({ skipAfterRainMm: 5 });
    expect(ok({ repeat: { every: 'day' } })).toMatchObject({ rainSkipMm: null });
    expect(errorsOf({ repeat: { every: 'hours', interval: 4, skipAfterRainMm: 5 } })).toMatch(/no days to skip/);
    expect(errorsOf({ repeat: { every: 'day', skipAfterRainMm: 0 } })).toMatch(/skipAfterRainMm/);
  });

  it('counts hourly and daily repeats from completion, as the picker does, unless told otherwise', () => {
    expect(ok({ repeat: { every: 'hours', interval: 3 } })).toMatchObject({ recurrenceType: 'hours', recurrenceInterval: 3, recurrenceFromCompletion: true });
    expect(ok({ repeat: { every: 'day' } }).recurrenceFromCompletion).toBe(true);
    expect(ok({ repeat: { every: 'day', fromCompletion: false } }).recurrenceFromCompletion).toBe(false);
    expect(ok({ repeat: { every: 'week' } }).recurrenceFromCompletion).toBe(false);
    expect(errorsOf({ repeat: { every: 'hours', fromCompletion: false } })).toMatch(/hourly/);
  });

  it('refuses combinations the editor never offers', () => {
    expect(errorsOf({ repeat: { every: 'week', monthDay: 3 } })).toMatch(/monthDay/);
    expect(errorsOf({ repeat: { every: 'day', weekdays: [1] } })).toMatch(/weekdays/);
    expect(errorsOf({ repeat: { every: 'month', monthDay: 3, nthWeekday: { ordinal: 1, weekday: 1 } } })).toMatch(/give one/);
    expect(errorsOf({ repeat: { every: 'month', nthWeekday: { ordinal: 5, weekday: 1 } } })).toMatch(/ordinal/);
    expect(errorsOf({ repeat: { every: 'year', month: 13 } })).toMatch(/1 to 12/);
    expect(errorsOf({ repeat: { every: 'day', endDate: '2027-01-01', count: 3 } })).toMatch(/give one/);
    expect(errorsOf({ repeat: { every: 'day', interval: 0 } })).toMatch(/interval/);
  });

  it('collects every problem rather than stopping at the first', () => {
    expect(patchOf({ repeat: { every: 'week', monthDay: 3, month: 2 } }).errors).toHaveLength(2);
  });

  it('"never" clears the whole rule', () => {
    expect(ok({ repeat: { every: 'never' } })).toMatchObject({
      recurrenceType: 'none', recurrenceDays: [], recurrenceMonthDay: null, recurrenceWeekOrdinal: null, recurrenceCount: null,
    });
  });

  it('reads back in the shape it was written', () => {
    const written = ok({ repeat: { every: 'month', nthWeekday: { ordinal: 2, weekday: 2 }, count: 5 } });
    expect(describeRepeat({ ...existing(), ...written } as Task)).toEqual({
      every: 'month', nthWeekday: { ordinal: 2, weekday: 2 }, count: 5,
    });
    expect(describeRepeat(existing())).toBeNull();
  });
});

describe('chain', () => {
  it('builds steps and starts at the first', () => {
    const p = ok({ chain: { steps: [{ title: 'Book haircut', asks: 'date', answerSchedulesNextStep: true }, { title: 'Get haircut', estimatedMinutes: 45 }] } });
    expect(p).toMatchObject({ chainEnabled: true, chainIndex: 0, chainStepOnSchedule: false });
    expect(p.chainItems).toEqual([
      { id: expect.any(String), title: 'Book haircut', estimatedMinutes: null, deliverableKind: 'date', deliverableDatesNextStep: true },
      { id: expect.any(String), title: 'Get haircut', estimatedMinutes: 45 },
    ]);
  });

  it('needs two steps, and refuses what a step cannot carry', () => {
    expect(errorsOf({ chain: { steps: [{ title: 'Only' }] } })).toMatch(/two steps/);
    expect(errorsOf({ chain: { steps: [{ title: 'A', answerSchedulesNextStep: true }, { title: 'B' }] } })).toMatch(/asks: "date"/);
    expect(errorsOf({ chain: { steps: [{ title: 'A' }, { title: 'B' }], stepsFollowSchedule: true } })).toMatch(/repeats/);
  });

  it('keeps step ids and the live step on an edit', () => {
    const current = existing({ chainEnabled: true, chainIndex: 1, chainItems: [{ id: 'a', title: 'A', estimatedMinutes: null }, { id: 'b', title: 'B', estimatedMinutes: null }] });
    const p = ok({ chain: { steps: [{ title: 'A2' }, { title: 'B2' }, { title: 'C' }] } }, current);
    expect(p.chainItems!.map(i => i.id).slice(0, 2)).toEqual(['a', 'b']);
    expect(p.chainIndex).toBe(1);
  });

  it('lets a repeating chain follow the schedule', () => {
    expect(ok({ repeat: { every: 'week' }, chain: { steps: [{ title: 'A' }, { title: 'B' }], stepsFollowSchedule: true } }).chainStepOnSchedule).toBe(true);
  });
});

describe('target', () => {
  it('"8 times a day" makes a task with no rule repeat daily', () => {
    expect(ok({ target: { count: 8, per: 'day', unit: 'glasses' } })).toMatchObject({
      targetCount: 8, quotaPeriod: 'day', recurrenceType: 'daily', targetUnit: 'glasses',
    });
  });

  it('keeps an existing repeat for a daily target', () => {
    expect(ok({ target: { count: 3, per: 'day' } }, existing({ recurrenceType: 'weekly' })).recurrenceType).toBeUndefined();
  });

  it('"3 times a week" repeats weekly and drops the per-day machinery', () => {
    expect(ok({ target: { count: 3, per: 'week' } })).toMatchObject({
      targetCount: 3, quotaPeriod: 'week', recurrenceType: 'weekly', quotaIntervalMinutes: null, allowOvershoot: false,
    });
    expect(errorsOf({ target: { count: 3, per: 'week' }, repeat: { every: 'day' } })).toMatch(/repeats weekly/);
  });

  it('refuses a count outside the app\'s range', () => {
    expect(errorsOf({ target: { count: 1, per: 'day' } })).toMatch(/2 to 99/);
  });
});

describe('habit, window, follow-up, blockers', () => {
  it('makes a plain task an "avoid" habit, and refuses one on a chain or a target', () => {
    expect(ok({ habit: 'avoid' })).toMatchObject({ polarity: 'negative', showStreak: true });
    expect(errorsOf({ habit: 'avoid', target: { count: 3, per: 'day' } })).toMatch(/plain task/);
  });

  it('takes a 24-hour window and refuses anything else', () => {
    expect(ok({ window: { start: '08:00', end: '13:30' } })).toMatchObject({ windowStart: '08:00', windowEnd: '13:30' });
    expect(errorsOf({ window: { start: '8am' } })).toMatch(/HH:MM/);
    expect(ok({ window: null })).toMatchObject({ windowStart: null, windowEnd: null, windowStartSun: null, windowEndSun: null });
  });

  it('takes a bound that follows the sun, with the clock time it resolves to beside it', () => {
    const asked: [string, string | null][] = [];
    const sunDeps = {
      ...deps,
      sunClockFor: (anchor: string, dueDate: string | null) => {
        asked.push([anchor, dueDate]);
        return anchor === 'sunset-30' ? '18:12' : '06:41';
      },
    };
    const { patch, errors } = taskFieldsPatch(
      { dueDate: '2026-10-12T12:00:00', window: { start: 'sunrise+0', end: 'sunset-30' } }, null, sunDeps,
    );
    expect(errors).toEqual([]);
    expect(patch).toMatchObject({
      windowStart: '06:41', windowStartSun: 'sunrise',
      windowEnd: '18:12', windowEndSun: 'sunset-30',
    });
    // Resolved on the task's own day, the one being written alongside it.
    expect(asked.every(([, due]) => due === patch.dueDate)).toBe(true);
  });

  it('clears a bound\'s anchor when it is given a clock time instead', () => {
    expect(ok({ window: { start: '08:00' } })).toMatchObject({ windowStart: '08:00', windowStartSun: null });
  });

  it('refuses an anchor it cannot resolve, and one it cannot read', () => {
    // No sunClockFor at all, and one that answers null (no location saved).
    expect(errorsOf({ window: { end: 'sunset' } })).toMatch(/no location is saved/);
    const noPlace = { ...deps, sunClockFor: () => null };
    expect(taskFieldsPatch({ window: { end: 'sunset' } }, null, noPlace).errors.join(' ')).toMatch(/Settings, Day & time/);
    expect(errorsOf({ window: { end: 'dusk' } })).toMatch(/sunrise.*sunset/);
    expect(errorsOf({ window: { end: 'sunset-500' } })).toMatch(/up to 180/);
  });

  it('sets a follow-up only on a repeating task', () => {
    const p = ok({ repeat: { every: 'week' }, followUp: { everyN: 4, title: 'Replace shoes', notes: 'Size 10' } });
    expect(p).toMatchObject({ followUpTaskEveryN: 4, followUpTaskTitle: 'Replace shoes', followUpTaskOneAtATime: false });
    expect(p.followUpTaskDraft!.notes).toBe('Size 10');
    expect(errorsOf({ followUp: { everyN: 4, title: 'X' } })).toMatch(/repeating/);
    expect(errorsOf({ repeat: { every: 'week' }, followUp: { everyN: 1, title: 'X' } })).toMatch(/2 to 99/);
  });

  it('sets a follow-up for the end of a repeat, and only on a repeat that ends', () => {
    const p = ok({ repeat: { every: 'week', count: 6 }, followUp: { atEnd: true, title: 'Sign up again' } });
    expect(p).toMatchObject({ followUpTaskEveryN: null, followUpTaskAtEnd: true, followUpTaskTitle: 'Sign up again', followUpTaskOneAtATime: false });
    expect(errorsOf({ repeat: { every: 'week' }, followUp: { atEnd: true, title: 'X' } })).toMatch(/repeat that ends/);
    expect(errorsOf({ repeat: { every: 'week', count: 6 }, followUp: { atEnd: true, everyN: 3, title: 'X' } })).toMatch(/give one/);
    expect(errorsOf({ repeat: { every: 'week', count: 6 }, followUp: { title: 'X' } })).toMatch(/atEnd/);
  });

  it('hands blockers back for the replica to check, and refuses a task waiting on itself', () => {
    expect(patchOf({ waitsOn: ['a', 'a', 'b'] }).waitsOn).toEqual(['a', 'b']);
    expect(errorsOf({ waitsOn: ['t1'] }, existing())).toMatch(/itself/);
  });
});

describe('plain fields', () => {
  it('leaves out what was not named, so an update only touches what it says', () => {
    expect(ok({ notes: 'n' })).toEqual({ notes: 'n' });
  });

  it('accepts night as a time of day, and refuses a bad date', () => {
    expect(ok({ timeSegments: ['night'] }).timeSegments).toEqual(['night']);
    expect(errorsOf({ dueDate: 'next tuesday' })).toMatch(/ISO/);
  });
});

describe('timed', () => {
  it('sets the countdown and derives the estimate and effort the editor would', () => {
    expect(ok({ timed: { minutes: 25 } })).toMatchObject({ timedMinutes: 25, estimatedMinutes: 25 });
  });

  it('leaves an estimate or effort the caller named alone', () => {
    const p = ok({ timed: { minutes: 25 }, estimatedMinutes: 30, effort: 2 });
    expect(p.estimatedMinutes).toBe(30);
    expect(p.effort).toBe(2);
  });

  it('refuses a length outside 1 to 1440, and a subtask', () => {
    expect(errorsOf({ timed: { minutes: 0 } })).toMatch(/1 to 1440/);
    expect(errorsOf({ timed: { minutes: 5000 } })).toMatch(/1 to 1440/);
    expect(taskFieldsPatch({ timed: { minutes: 10 } }, null, deps, { isSubtask: true }).errors.join(' ')).toMatch(/share of its parent/);
  });

  it('null removes it', () => {
    expect(ok({ timed: null }, existing({ timedMinutes: 15 } as Partial<Task>)).timedMinutes).toBeNull();
  });
});

describe('rotation counts', () => {
  it('sums per-member counts into the target', () => {
    const patch = ok({ rotation: { members: [{ title: 'Run', timesPerWeek: 3 }, 'Peloton ride'] } });
    expect(patch.targetCount).toBe(4);
    expect(patch.rotationItems!.map(i => i.perWeek)).toEqual([3, undefined]);
  });

  it('keeps a stored count when a bare name is re-sent, and replaces it when one is stated', () => {
    const cur = existing({ rotationEnabled: true, rotationItems: [{ id: 'run', title: 'Run', linkUrl: null, perWeek: 3 }, { id: 'b', title: 'Bike', linkUrl: null }] } as Partial<Task>);
    expect(ok({ rotation: { members: ['run', 'Bike'] } }, cur).targetCount).toBe(4);
    expect(ok({ rotation: { members: [{ title: 'Run', timesPerWeek: 2 }, 'Bike'] } }, cur).targetCount).toBe(3);
    expect(ok({ rotation: { members: [{ title: 'Run', timesPerWeek: 1 }, 'Bike'] } }, cur).targetCount).toBe(2);
  });

  it('refuses a count outside 1 to 7', () => {
    expect(errorsOf({ rotation: { members: [{ title: 'A', timesPerWeek: 0 }, 'B'] } })).toMatch(/1 to 7/);
    expect(errorsOf({ rotation: { members: [{ title: 'A', timesPerWeek: 8 }, 'B'] } })).toMatch(/1 to 7/);
  });
});

describe('rotation', () => {
  it('makes a weekly target the size of the set', () => {
    expect(ok({ rotation: { members: ['Spanish', 'French', 'Hindi'] } })).toMatchObject({
      rotationEnabled: true, targetCount: 3, quotaPeriod: 'week', recurrenceType: 'weekly',
    });
  });

  it('keeps a repeat the task already has', () => {
    expect(ok({ rotation: { members: ['A', 'B'] } }, existing({ recurrenceType: 'daily' })).recurrenceType).toBeUndefined();
  });

  it('keeps a member\'s id when its title is sent again, so its history stays', () => {
    const cur = existing({ rotationEnabled: true, rotationItems: [{ id: 'keep', title: 'Spanish', linkUrl: null }, { id: 'drop', title: 'Old', linkUrl: null }] } as Partial<Task>);
    const items = ok({ rotation: { members: ['spanish', 'Hindi'] } }, cur).rotationItems!;
    expect(items.map(i => i.id)).toEqual(['keep', expect.stringMatching(/^id/)]);
    expect(items[0].title).toBe('spanish');
  });

  it('refuses one member, a blank, a duplicate and a subtask', () => {
    expect(errorsOf({ rotation: { members: ['A'] } })).toMatch(/at least 2/);
    expect(errorsOf({ rotation: { members: ['A', ' '] } })).toMatch(/blank/);
    expect(errorsOf({ rotation: { members: ['A', 'a'] } })).toMatch(/different/);
    expect(taskFieldsPatch({ rotation: { members: ['A', 'B'] } }, null, deps, { isSubtask: true }).errors.join(' ')).toMatch(/subtask/);
  });

  it('null removes it and the target that was derived from it', () => {
    const cur = existing({ rotationEnabled: true, rotationItems: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], targetCount: 2 } as Partial<Task>);
    expect(ok({ rotation: null }, cur)).toMatchObject({ rotationEnabled: false, rotationItems: [], targetCount: null, quotaPeriod: 'day' });
  });

  it('describes which members this week has covered', () => {
    const t = existing({
      rotationEnabled: true,
      rotationItems: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      rotationLastDone: { a: '2026-10-01T09:00:00.000Z' },
    } as Partial<Task>);
    expect(describeRotation(t, new Set(['a']))).toEqual({
      members: [{ title: 'A', doneThisWeek: true, lastDone: '2026-10-01T09:00:00.000Z' }, { title: 'B', doneThisWeek: false }],
    });
    expect(describeRotation(existing(), new Set())).toBeNull();
  });
});

describe('kinds are exclusive', () => {
  it('refuses a second kind and names the one to clear', () => {
    expect(errorsOf({ timed: { minutes: 10 } }, existing({ chainEnabled: true, chainItems: [{ id: 'a', title: 'A', estimatedMinutes: null }, { id: 'b', title: 'B', estimatedMinutes: null }] }))).toMatch(/chain and timed.*chain: null/);
    expect(errorsOf({ timed: { minutes: 10 }, healthTarget: { metric: 'steps' } })).toMatch(/timed and healthTarget/);
    expect(errorsOf({ rotation: { members: ['A', 'B'] }, target: { count: 3, per: 'day' } })).toMatch(/target and rotation/);
  });

  it('lets a kind replace another when the old one is cleared in the same call', () => {
    const cur = existing({ targetCount: 4 });
    expect(ok({ timed: { minutes: 10 }, target: null }, cur).timedMinutes).toBe(10);
  });

  it('an existing rotation is not also read as a plain target', () => {
    const cur = existing({ rotationEnabled: true, rotationItems: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], targetCount: 2 } as Partial<Task>);
    expect(ok({ rotation: { members: ['A', 'B', 'C'] } }, cur).targetCount).toBe(3);
  });
});

describe('health target', () => {
  it('sets the metric with the editor\'s starting value when no target is given', () => {
    expect(ok({ healthTarget: { metric: 'steps' } })).toMatchObject({ healthMetric: 'steps', healthTarget: 8000, healthFollowGoal: false });
  });

  it('keeps follow-goal only for a ring metric', () => {
    expect(ok({ healthTarget: { metric: 'standHours', followGoal: true } }).healthFollowGoal).toBe(true);
    expect(errorsOf({ healthTarget: { metric: 'steps', followGoal: true } })).toMatch(/followGoal only applies/);
  });

  it('refuses a target outside the metric\'s own range', () => {
    expect(errorsOf({ healthTarget: { metric: 'sleepHours', target: 20 } })).toMatch(/4 to 12/);
    expect(errorsOf({ healthTarget: { metric: 'steps', target: 100 } })).toMatch(/500 to 50000/);
  });

  it('null removes it', () => {
    expect(ok({ healthTarget: null })).toMatchObject({ healthMetric: null, healthTarget: null, healthFollowGoal: false });
  });

  it('describes a configured target, and nothing otherwise', () => {
    expect(describeHealthTarget(existing({ healthMetric: 'steps', healthTarget: 9000, healthFollowGoal: false } as Partial<Task>))).toEqual({ metric: 'steps', target: 9000 });
    expect(describeHealthTarget(existing({ healthMetric: 'steps', healthTarget: 0 } as Partial<Task>))).toBeNull();
    expect(describeHealthTarget(existing())).toBeNull();
  });

  it('every metric default is inside its own range', () => {
    for (const [metric, r] of Object.entries(HEALTH_TARGET_RANGES)) {
      expect(ok({ healthTarget: { metric: metric as keyof typeof HEALTH_TARGET_RANGES } }).healthTarget).toBe(r.default);
    }
  });
});

describe('supply', () => {
  const repeating = existing({ recurrenceType: 'daily' });

  it('sets the stock on a repeating task', () => {
    expect(ok({ supply: { count: 12, unit: 'filters', reorderAt: 2, leadDays: 3, refillCount: 6 } }, repeating)).toMatchObject({
      supplyCount: 12, supplyUnit: 'filters', supplyReorderAt: 2, supplyLeadDays: 3, supplyRefillCount: 6,
    });
  });

  it('accepts a repeat given in the same call', () => {
    expect(ok({ repeat: { every: 'week' }, supply: { count: 3 } }).supplyCount).toBe(3);
  });

  it('needs a repeat, and refuses a subtask', () => {
    expect(errorsOf({ supply: { count: 3 } })).toMatch(/needs a repeat/);
    expect(taskFieldsPatch({ supply: { count: 3 } }, repeating, deps, { isSubtask: true }).errors.join(' ')).toMatch(/subtask/);
  });

  it('allows 0 as a real count but keeps the reorder point at 1 or more', () => {
    expect(ok({ supply: { count: 0 } }, repeating).supplyCount).toBe(0);
    expect(errorsOf({ supply: { count: 3, reorderAt: 0 } }, repeating)).toMatch(/1 to 999/);
    expect(errorsOf({ supply: { count: 1000 } }, repeating)).toMatch(/0 to 999/);
  });

  it('null clears the whole stock', () => {
    expect(ok({ supply: null }, repeating)).toMatchObject({ supplyCount: null, supplyUnit: null, supplyReorderAt: 1, supplyDeclinedAtCount: null });
  });

  it('describes a stock, and nothing for a task that has none', () => {
    expect(describeSupplyFields(existing({ supplyCount: 0, supplyReorderAt: 1, supplyUnit: 'filters' } as Partial<Task>))).toEqual({ count: 0, unit: 'filters', reorderAt: 1 });
    expect(describeSupplyFields(existing({ supplyCount: null } as Partial<Task>))).toBeNull();
  });

});

describe('meter', () => {
  const car = { name: 'Car', unit: 'miles', every: 5000, dueAt: 45000 };

  it('makes a plain one-off due at a reading', () => {
    expect(ok({ meter: car })).toMatchObject({
      meterName: 'Car', meterUnit: 'miles', meterEvery: 5000, meterDueAt: 45000, meterLimitMonths: null,
    });
    expect(ok({ meter: { ...car, limitMonths: 6 } }).meterLimitMonths).toBe(6);
  });

  it('keeps the due reading on an update that leaves it out', () => {
    const current = existing({ meterName: 'Car', meterEvery: 5000, meterDueAt: 45000 });
    expect(ok({ meter: { name: 'Car', every: 3000 } }, current)).toMatchObject({ meterEvery: 3000, meterDueAt: 45000 });
  });

  it('refuses what the app would refuse', () => {
    expect(errorsOf({ meter: { ...car, name: ' ' } })).toMatch(/meter.name is required/);
    expect(errorsOf({ meter: { ...car, every: 0 } })).toMatch(/meter.every/);
    expect(errorsOf({ meter: { name: 'Car', every: 5000 } })).toMatch(/meter.dueAt is required/);
    expect(errorsOf({ meter: { ...car, limitMonths: 0 } })).toMatch(/limitMonths/);
  });

  it('is for a plain one-off only, judged as the task will be', () => {
    expect(errorsOf({ meter: car }, existing({ recurrenceType: 'weekly' }))).toMatch(/plain one-off/);
    expect(errorsOf({ meter: car, repeat: { every: 'day' } })).toMatch(/plain one-off/);
    expect(errorsOf({ meter: car }, existing({ weatherWait: 'sunny' }))).toMatch(/plain one-off/);
    expect(errorsOf({ meter: car, weatherWait: 'sunny' })).toMatch(/plain one-off/);
  });

  it('lets go of the app\'s own hold when the meter is cleared', () => {
    const held = existing({ meterName: 'Car', meterEvery: 5000, meterDueAt: 45000, meterHeldUntil: '2026-12-10', deferUntil: '2026-12-10T05:00:00.000Z' });
    expect(ok({ meter: null }, held)).toMatchObject({ meterName: null, meterDueAt: null, deferUntil: null, meterHeldUntil: null });
    expect(ok({ meter: null }, existing())).not.toHaveProperty('deferUntil');
  });
});

describe('weatherWait', () => {
  it('records the want on a plain one-off', () => {
    expect(ok({ weatherWait: 'sunny' })).toMatchObject({ weatherWait: 'sunny' });
    expect(ok({ weatherWait: 'rainy' }, existing())).toMatchObject({ weatherWait: 'rainy' });
  });

  it('refuses anything that already schedules itself', () => {
    expect(errorsOf({ weatherWait: 'sunny' }, existing({ recurrenceType: 'daily' }))).toMatch(/plain one-off/);
    expect(errorsOf({ weatherWait: 'sunny' }, existing({ chainEnabled: true }))).toMatch(/plain one-off/);
    expect(errorsOf({ weatherWait: 'sunny' }, existing({ seriesId: 's1' }))).toMatch(/plain one-off/);
    expect(errorsOf({ weatherWait: 'sunny' }, existing({ parentId: 'p1' }))).toMatch(/plain one-off/);
  });

  it('judges the task as it will be, not as it is', () => {
    expect(errorsOf({ weatherWait: 'sunny', repeat: { every: 'day' } })).toMatch(/plain one-off/);
    expect(ok({ weatherWait: 'sunny', repeat: { every: 'never' } }, existing({ recurrenceType: 'daily' }))).toMatchObject({ weatherWait: 'sunny' });
  });

  it('refuses a condition that is not one of the five', () => {
    expect(errorsOf({ weatherWait: 'foggy' as never })).toMatch(/weatherWait must be one of/);
  });

  it('lets a task go when the wait is cleared, unless the caller names a defer', () => {
    expect(ok({ weatherWait: null }, existing({ weatherWait: 'sunny' }))).toMatchObject({ weatherWait: null, deferUntil: null });
    expect(ok({ weatherWait: null, deferUntil: '2026-10-09' }, existing({ weatherWait: 'sunny' })).deferUntil).not.toBeNull();
    expect(ok({ weatherWait: null }, existing())).toEqual({ weatherWait: null });
  });
});
