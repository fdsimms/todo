import type { Task } from '../types';
import {
  canSlotIn, effectiveSlotIn, slotInFromCategory, slotInInUse, isSlotHold, isSlotWaiting,
  slotWaitingSinceKey, isSlotInCandidate, planSlotIns, slotHoldPatch, slotLandPatch,
  slotReleasePatch, slotInChipText, slotWaitingTasks, compareSlotInOrder, planLateArrivals, SLOT_IN_LIGHT_DAY_MAX,
  DEFAULT_SLOT_IN_MAX_WAIT_DAYS, parseSlotInMaxWaitDays, type SlotInDay,
} from '../utils/slotIn';

const iso = (key: string) => new Date(`${key}T00:00:00`).toISOString();

let seq = 0;
function task(overrides: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `t${seq}`,
    title: `Task ${seq}`,
    parentId: null,
    completed: false,
    archived: false,
    dueDate: iso('2026-10-19'),
    deferUntil: null,
    deadline: null,
    targetCount: null,
    recurrenceType: 'none',
    recurrenceInterval: 1,
    polarity: 'positive',
    reminderTime: null,
    generatedKind: null,
    weatherWait: null,
    slotIn: true,
    category: null,
    slotDecidedOn: null,
    slotWaitingSince: null,
    driftingSince: null,
    pinned: false,
    priority: 0,
    timerStartedAt: null,
    sortOrder: seq,
    estimatedMinutes: 30,
    ...overrides,
  } as Task;
}

const TODAY = '2026-10-19';
const day = (overrides: Partial<SlotInDay> = {}): SlotInDay => ({
  todayKey: TODAY,
  baseMinutes: 0,
  full: false,
  busyMinutes: 180,
  minutesOf: t => t.estimatedMinutes ?? 30,
  maxWaitDays: DEFAULT_SLOT_IN_MAX_WAIT_DAYS,
  ...overrides,
});

describe('canSlotIn', () => {
  it('takes a dated one-off and a weekly chore', () => {
    expect(canSlotIn(task())).toBe(true);
    expect(canSlotIn(task({ recurrenceType: 'weekly' }))).toBe(true);
  });

  it('refuses what waiting would turn into something else', () => {
    expect(canSlotIn(task({ dueDate: null }))).toBe(false);
    expect(canSlotIn(task({ recurrenceType: 'daily', recurrenceInterval: 1 }))).toBe(false);
    expect(canSlotIn(task({ recurrenceType: 'hours' }))).toBe(false);
    expect(canSlotIn(task({ targetCount: 3 }))).toBe(false);
    expect(canSlotIn(task({ weatherWait: 'sunny' }))).toBe(false);
    expect(canSlotIn(task({ polarity: 'negative' }))).toBe(false);
    expect(canSlotIn(task({ reminderTime: iso('2026-10-19') }))).toBe(false);
    expect(canSlotIn(task({ parentId: 'p' }))).toBe(false);
  });

  it('takes a daily task that skips days, and a catch-up but not a use-up', () => {
    expect(canSlotIn(task({ recurrenceType: 'daily', recurrenceInterval: 2 }))).toBe(true);
    expect(canSlotIn(task({ generatedKind: 'reachOut' }))).toBe(true);
    expect(canSlotIn(task({ generatedKind: 'groceryUseUp' }))).toBe(false);
  });
});

describe('effectiveSlotIn', () => {
  const categories = [{ name: 'Chores', slotIn: true }, { name: 'Work', slotIn: false }];

  it('lets the task answer for itself, over its category', () => {
    expect(effectiveSlotIn(task({ slotIn: false, category: 'Chores' }), categories)).toBe(false);
    expect(effectiveSlotIn(task({ slotIn: true, category: 'Work' }), categories)).toBe(true);
  });

  it('follows the category when the task has no answer', () => {
    expect(effectiveSlotIn(task({ slotIn: null, category: 'Chores' }), categories)).toBe(true);
    expect(effectiveSlotIn(task({ slotIn: null, category: 'Work' }), categories)).toBe(false);
    expect(effectiveSlotIn(task({ slotIn: null, category: null }), categories)).toBe(false);
    expect(slotInFromCategory(task({ slotIn: null, category: 'Chores' }), categories)).toBe('Chores');
    expect(slotInFromCategory(task({ slotIn: false, category: 'Chores' }), categories)).toBeNull();
  });

  it('reads as in use once a task or a category turns it on', () => {
    expect(slotInInUse([task({ slotIn: null })], [{ slotIn: false }])).toBe(false);
    expect(slotInInUse([task({ slotIn: false })], [{ slotIn: false }])).toBe(false);
    expect(slotInInUse([task({ slotIn: true })], [])).toBe(true);
    expect(slotInInUse([], [{ slotIn: true }])).toBe(true);
  });
});

describe('the hold', () => {
  it('recognises only a defer to the day after the one it decided', () => {
    expect(isSlotHold(task({ slotDecidedOn: '2026-10-18', deferUntil: iso('2026-10-19') }))).toBe(true);
    expect(isSlotHold(task({ slotDecidedOn: '2026-10-18', deferUntil: iso('2026-10-25') }))).toBe(false);
    expect(isSlotHold(task({ slotDecidedOn: null, deferUntil: iso('2026-10-19') }))).toBe(false);
  });

  it('is waiting only while the hold is still ahead', () => {
    const held = task({ slotDecidedOn: TODAY, deferUntil: iso('2026-10-20') });
    expect(isSlotWaiting(held, TODAY)).toBe(true);
    expect(isSlotWaiting(held, '2026-10-20')).toBe(false);
  });

  it('holds until tomorrow, stamping the day it was first meant for', () => {
    const patch = slotHoldPatch(task({ dueDate: iso('2026-10-16') }), TODAY);
    expect(patch).toEqual({ deferUntil: iso('2026-10-20'), slotDecidedOn: TODAY, slotWaitingSince: '2026-10-16' });
  });

  it('keeps the first stamp across holds', () => {
    const t = task({ dueDate: iso('2026-10-16'), slotWaitingSince: '2026-10-10', deferUntil: iso(TODAY) });
    expect(slotHoldPatch(t, TODAY).slotWaitingSince).toBe('2026-10-10');
  });

  it('counts a run of pushes by hand as waiting', () => {
    const t = task({ dueDate: iso('2026-10-18'), driftingSince: iso('2026-09-22') });
    expect(slotWaitingSinceKey(t)).toBe('2026-09-22');
  });

  it('only marks a task it let through', () => {
    expect(slotLandPatch(TODAY)).toEqual({ slotDecidedOn: TODAY });
  });
});

describe('slotWaitingTasks', () => {
  it('lists only the pass\'s own holds, longest wait first', () => {
    const newer = task({ slotDecidedOn: TODAY, deferUntil: iso('2026-10-20'), slotWaitingSince: '2026-10-17' });
    const older = task({ slotDecidedOn: TODAY, deferUntil: iso('2026-10-20'), slotWaitingSince: '2026-10-12' });
    const ownDefer = task({ deferUntil: iso('2026-10-25') });
    const done = task({ slotDecidedOn: TODAY, deferUntil: iso('2026-10-20'), completed: true });
    const sub = task({ slotDecidedOn: TODAY, deferUntil: iso('2026-10-20'), parentId: 'p' });
    expect(slotWaitingTasks([newer, ownDefer, done, sub, older], TODAY)).toEqual([older, newer]);
  });
});

describe('isSlotInCandidate', () => {
  const none: { name: string; slotIn: boolean }[] = [];

  it('decides a task whose day has come', () => {
    expect(isSlotInCandidate(task(), none, TODAY)).toBe(true);
    expect(isSlotInCandidate(task({ dueDate: iso('2026-10-12') }), none, TODAY)).toBe(true);
  });

  it('leaves a task not due yet, or held to a later day by the person', () => {
    expect(isSlotInCandidate(task({ dueDate: iso('2026-10-22') }), none, TODAY)).toBe(false);
    expect(isSlotInCandidate(task({ deferUntil: iso('2026-10-25') }), none, TODAY)).toBe(false);
  });

  it('never decides a task twice in one day', () => {
    expect(isSlotInCandidate(task({ slotDecidedOn: TODAY }), none, TODAY)).toBe(false);
    // Yesterday's hold arriving today is today's question.
    expect(isSlotInCandidate(task({ slotDecidedOn: '2026-10-18', deferUntil: iso(TODAY) }), none, TODAY)).toBe(true);
  });

  it('leaves a task let through on an earlier day where it landed', () => {
    // Landed yesterday and not done: it stays on Today rather than taking
    // today's one landing again.
    expect(isSlotInCandidate(task({ slotDecidedOn: '2026-10-18', dueDate: iso('2026-10-15') }), none, TODAY)).toBe(false);
    // Moved by hand to today since it landed: today is a fresh question.
    expect(isSlotInCandidate(task({ slotDecidedOn: '2026-10-16', dueDate: iso('2026-10-15'), deferUntil: iso(TODAY) }), none, TODAY)).toBe(true);
  });

  it('leaves a task not set to wait', () => {
    expect(isSlotInCandidate(task({ slotIn: false }), none, TODAY)).toBe(false);
    expect(isSlotInCandidate(task({ slotIn: null }), none, TODAY)).toBe(false);
  });
});

describe('planSlotIns', () => {
  it('lands up to the light-day limit on a light day', () => {
    const tasks = [task(), task(), task(), task()];
    const plan = planSlotIns(tasks, day());
    expect(plan.land).toHaveLength(SLOT_IN_LIGHT_DAY_MAX);
    expect(plan.hold).toHaveLength(tasks.length - SLOT_IN_LIGHT_DAY_MAX);
  });

  it('always lands one, even on a full day', () => {
    const plan = planSlotIns([task(), task()], day({ baseMinutes: 400, full: true }));
    expect(plan.land).toHaveLength(1);
    expect(plan.hold).toHaveLength(1);
  });

  it('stops once the next task would make the day busy', () => {
    const a = task({ estimatedMinutes: 20 });
    const b = task({ estimatedMinutes: 30 });
    const plan = planSlotIns([a, b], day({ baseMinutes: 150 }));
    expect(plan.land.map(t => t.id)).toEqual([a.id]);
    expect(plan.hold.map(t => t.id)).toEqual([b.id]);
  });

  it('lands the longest wait first', () => {
    const fresh = task({ dueDate: iso(TODAY) });
    const old = task({ dueDate: iso('2026-10-12'), slotWaitingSince: '2026-09-22' });
    const plan = planSlotIns([fresh, old], day({ full: true }));
    expect(plan.land.map(t => t.id)).toEqual([old.id]);
  });

  it('breaks a tie in waiting by priority', () => {
    const low = task({ priority: 1 });
    const high = task({ priority: 3 });
    expect([low, high].sort(compareSlotInOrder)[0].id).toBe(high.id);
  });

  it('never holds past a deadline, and that does not use up the day’s one', () => {
    const due = task({ deadline: iso(TODAY), dueDate: iso('2026-10-17') });
    const waiting = task({ dueDate: iso('2026-10-10') });
    const plan = planSlotIns([waiting, due], day({ full: true }));
    expect(plan.land.map(t => t.id).sort()).toEqual([due.id, waiting.id].sort());
  });

  it(`lands everything that has waited ${DEFAULT_SLOT_IN_MAX_WAIT_DAYS} days, even on a full day`, () => {
    const oldest = task({ slotWaitingSince: '2026-10-10' });
    const longEnough = task({ slotWaitingSince: '2026-10-16' });
    const notYet = task({ slotWaitingSince: '2026-10-17' });
    const fresh = task();
    const plan = planSlotIns([fresh, notYet, longEnough, oldest], day({ baseMinutes: 400, full: true }));
    expect(plan.land.map(t => t.id)).toEqual([oldest.id, longEnough.id]);
    expect(plan.hold.map(t => t.id)).toEqual([notYet.id, fresh.id]);
  });

  it('follows the longest wait the person picked', () => {
    const fiveDays = task({ slotWaitingSince: '2026-10-14' });
    const fresh = task();
    const plan = planSlotIns([fresh, fiveDays, task({ slotWaitingSince: '2026-10-13' })], day({ full: true, maxWaitDays: 7 }));
    // Only the floor lands: neither has waited a week.
    expect(plan.land).toHaveLength(1);
    // At one day, yesterday's lands beside the floor's; today's still waits.
    const yesterday = task({ slotWaitingSince: '2026-10-18' });
    const short = planSlotIns([fresh, yesterday, fiveDays], day({ full: true, maxWaitDays: 1 }));
    expect(short.land.map(t => t.id)).toEqual([fiveDays.id, yesterday.id]);
  });

  it('counts a long wait toward a light day’s limit', () => {
    const old = task({ slotWaitingSince: '2026-10-10' });
    const older = task({ slotWaitingSince: '2026-10-09' });
    const fresh = task();
    const plan = planSlotIns([fresh, old, older], day());
    expect(plan.land.map(t => t.id)).toEqual([older.id, old.id]);
  });

  it('lands what is pinned or urgent whatever the day', () => {
    const pinned = task({ pinned: true });
    const urgent = task({ priority: 4 });
    const waiting = task();
    const plan = planSlotIns([pinned, urgent, waiting], day({ full: true }));
    expect(plan.land).toHaveLength(3);
  });
});

describe('parseSlotInMaxWaitDays', () => {
  it('reads a missing or unreadable row as the default, and clamps the rest', () => {
    expect(parseSlotInMaxWaitDays(null)).toBe(DEFAULT_SLOT_IN_MAX_WAIT_DAYS);
    expect(parseSlotInMaxWaitDays('')).toBe(DEFAULT_SLOT_IN_MAX_WAIT_DAYS);
    expect(parseSlotInMaxWaitDays('null')).toBe(DEFAULT_SLOT_IN_MAX_WAIT_DAYS);
    expect(parseSlotInMaxWaitDays('5')).toBe(5);
    expect(parseSlotInMaxWaitDays('0')).toBe(1);
    expect(parseSlotInMaxWaitDays('99')).toBe(14);
  });
});

describe('planLateArrivals', () => {
  it('holds a task written after the day was decided while others wait', () => {
    const late = task({ generatedKind: 'reachOut' });
    const plan = planLateArrivals([late], true, TODAY);
    expect(plan.hold).toEqual([late]);
  });

  it('lets it through when nothing is waiting, or when it has a deadline today', () => {
    const late = task({ generatedKind: 'reachOut' });
    expect(planLateArrivals([late], false, TODAY).land).toEqual([late]);
    const due = task({ generatedKind: 'reachOut', deadline: iso(TODAY) });
    expect(planLateArrivals([due], true, TODAY).land).toEqual([due]);
  });
});

describe('slotReleasePatch', () => {
  it('lifts a hold still ahead and clears the marks', () => {
    const t = task({ slotDecidedOn: TODAY, deferUntil: iso('2026-10-20'), slotWaitingSince: '2026-10-15' });
    expect(slotReleasePatch(t, TODAY)).toEqual({ slotDecidedOn: null, slotWaitingSince: null, deferUntil: null });
  });

  it('leaves the person’s own defer', () => {
    const t = task({ slotDecidedOn: '2026-10-15', deferUntil: iso('2026-10-25'), slotWaitingSince: '2026-10-15' });
    expect(slotReleasePatch(t, TODAY)).toEqual({ slotDecidedOn: null, slotWaitingSince: null });
  });

  it('has nothing to do for a task the pass never touched', () => {
    expect(slotReleasePatch(task(), TODAY)).toBeNull();
  });
});

describe('slotInChipText', () => {
  it('says how long a held task has been waiting', () => {
    const t = task({ slotDecidedOn: TODAY, deferUntil: iso('2026-10-20'), slotWaitingSince: '2026-10-16' });
    expect(slotInChipText(t, TODAY)).toBe('Waiting since Fri');
    expect(slotInChipText({ ...t, slotWaitingSince: '2026-09-22' }, TODAY)).toBe('Waiting since Sep 22');
  });

  it('says it waited once it is let through', () => {
    const t = task({ slotDecidedOn: TODAY, slotWaitingSince: '2026-10-16' });
    expect(slotInChipText(t, TODAY)).toBe('Waited since Fri');
  });

  it('says nothing for a task that never waited', () => {
    expect(slotInChipText(task({ slotDecidedOn: TODAY }), TODAY)).toBeNull();
    expect(slotInChipText(task({ slotWaitingSince: '2026-10-16', completed: true }), TODAY)).toBeNull();
  });
});
