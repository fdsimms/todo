import { describeRepeat, taskFieldsPatch, type TaskFieldsInput } from '../taskFields';
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
    expect(ok({ window: null })).toMatchObject({ windowStart: null, windowEnd: null });
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
