import {
  DEFAULT_MEAL_PLAN_NUDGE_TIME,
  DEFAULT_MEAL_PLAN_NUDGE_WEEKDAY,
  MEAL_PLAN_NUDGE_LINK_URL,
  dueMealPlanNudge,
  mealPlanNudgeSuppressed,
  partitionMealPlanNudgeTasks,
  countPlannedSlots,
  mealPlanNudgeDayKey,
  mealPlanNudgeLinkUrl,
  MEAL_PLAN_NUDGE_SLOT_COUNT,
} from '../utils/mealPlanNudge';
import type { MealSlot, Task } from '../types';

// mealPlanNudge reaches dateUtils/mealPlan for dayKeyOf/describeWeekRange,
// which reach the settings store for dayResetTime — which nothing here
// needs, since every date this module compares is a calendar day or an
// explicit clock time, never a logical-day rollback. Same defensive mock as
// mealPlan.test.ts / mealPlanGroceries.test.ts.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

// Aug 2025 starts on a Friday (see calendarGrid.test.ts), so with
// weekStartsOn=0 the week containing any of these is Sun Aug 3 – Sat Aug 9,
// and weekStartsOn=1's is Mon Aug 4 – Sun Aug 10. Fixed real dates rather than
// dates built from buildWeekDays in the test itself, so a bug shared between
// the module and the test can't hide the same way twice.
const SUN_AUG_3 = (h: number, m: number) => new Date(2025, 7, 3, h, m, 0);
const TUE_AUG_5 = (h: number, m: number) => new Date(2025, 7, 5, h, m, 0);
const FRI_AUG_8 = (h: number, m: number) => new Date(2025, 7, 8, h, m, 0);
const SAT_AUG_9 = (h: number, m: number) => new Date(2025, 7, 9, h, m, 0);
const SUN_AUG_10 = (h: number, m: number) => new Date(2025, 7, 10, h, m, 0);

describe('dueMealPlanNudge', () => {
  it('is not due before the trigger day/time arrives this week', () => {
    expect(dueMealPlanNudge(SUN_AUG_3(8, 59), 0, 0, '09:00', null)).toBeNull();
  });

  it('fires the moment the trigger instant arrives', () => {
    const due = dueMealPlanNudge(SUN_AUG_3(9, 0), 0, 0, '09:00', null);
    expect(due).not.toBeNull();
    expect(due!.weekKey).toBe('2025-08-03');
  });

  it('stays due for the rest of the week once the trigger day has passed', () => {
    // weekday=0 (Sunday) already happened by Tuesday, in the same week.
    const due = dueMealPlanNudge(TUE_AUG_5(10, 0), 0, 0, '09:00', null);
    expect(due).not.toBeNull();
    expect(due!.weekKey).toBe('2025-08-03');
  });

  it('does not fire twice in the same week (lastFiredWeekKey gate)', () => {
    expect(dueMealPlanNudge(TUE_AUG_5(10, 0), 0, 0, '09:00', '2025-08-03')).toBeNull();
    // Still gated right up to the last moment of the week the nudge already fired in.
    expect(dueMealPlanNudge(SAT_AUG_9(23, 59), 0, 0, '09:00', '2025-08-03')).toBeNull();
  });

  it('fires again once the next week starts, across the boundary', () => {
    const due = dueMealPlanNudge(SUN_AUG_10(9, 0), 0, 0, '09:00', '2025-08-03');
    expect(due).not.toBeNull();
    expect(due!.weekKey).toBe('2025-08-10');
  });

  it('targets the week after the one the trigger fires in', () => {
    const due = dueMealPlanNudge(SUN_AUG_3(9, 0), 0, 0, '09:00', null);
    expect(due!.targetWeekStartKey).toBe('2025-08-10');
    expect(due!.targetWeekEndKey).toBe('2025-08-16');
  });

  it('resolves the trigger day within the week regardless of which weekday it is', () => {
    // weekday=5 (Friday) inside the Sun Aug 3 – Sat Aug 9 week is Aug 8.
    expect(dueMealPlanNudge(FRI_AUG_8(8, 59), 0, 5, '09:00', null)).toBeNull();
    const due = dueMealPlanNudge(FRI_AUG_8(9, 0), 0, 5, '09:00', null);
    expect(due).not.toBeNull();
    expect(due!.weekKey).toBe('2025-08-03');
    expect(due!.targetWeekStartKey).toBe('2025-08-10');
  });

  it('respects weekStartsOn when computing the week and the target range', () => {
    // Monday-start week containing Aug 5 is Mon Aug 4 – Sun Aug 10.
    const due = dueMealPlanNudge(TUE_AUG_5(9, 0), 1, 1, '09:00', null);
    expect(due).not.toBeNull();
    expect(due!.weekKey).toBe('2025-08-04');
    expect(due!.targetWeekStartKey).toBe('2025-08-11');
    expect(due!.targetWeekEndKey).toBe('2025-08-17');
  });

  it('falls back to midnight for an unparseable time rather than never firing', () => {
    const due = dueMealPlanNudge(SUN_AUG_3(0, 0), 0, 0, 'garbage', null);
    expect(due).not.toBeNull();
  });

  it('titles the stack with a fixed name rather than a date range', () => {
    const due = dueMealPlanNudge(SUN_AUG_3(9, 0), 0, 0, '09:00', null);
    expect(due!.title).toBe("Plan next week's meals");
  });

  it('names all seven days of the target week, in week order', () => {
    const due = dueMealPlanNudge(SUN_AUG_3(9, 0), 0, 0, '09:00', null);
    expect(due!.days.map(d => d.dayKey)).toEqual([
      '2025-08-10',
      '2025-08-11',
      '2025-08-12',
      '2025-08-13',
      '2025-08-14',
      '2025-08-15',
      '2025-08-16',
    ]);
  });

  it('titles each day by weekday and numeric date, without repeating the stack\'s verb', () => {
    const due = dueMealPlanNudge(SUN_AUG_3(9, 0), 0, 0, '09:00', null);
    expect(due!.days[0].title).toBe('Sunday 08/10');
    expect(due!.days[6].title).toBe('Saturday 08/16');
  });

  it('follows weekStartsOn into the day set, not just the range', () => {
    // Monday-start, firing inside Mon Aug 4 – Sun Aug 10, so the week being
    // asked about is Mon Aug 11 – Sun Aug 17 and the rows start on a Monday.
    const due = dueMealPlanNudge(TUE_AUG_5(9, 0), 1, 1, '09:00', null);
    expect(due!.days).toHaveLength(7);
    expect(due!.days[0].dayKey).toBe('2025-08-11');
    expect(due!.days[0].title).toBe('Monday 08/11');
    expect(due!.days[6].dayKey).toBe('2025-08-17');
  });

  it('anchors dueDate to noon on the day it fires, not the trigger day', () => {
    const due = dueMealPlanNudge(TUE_AUG_5(16, 30), 0, 0, '09:00', null);
    expect(due!.dueDate.getFullYear()).toBe(2025);
    expect(due!.dueDate.getMonth()).toBe(7);
    expect(due!.dueDate.getDate()).toBe(5);
    expect(due!.dueDate.getHours()).toBe(12);
  });
});

describe('mealPlanNudgeSuppressed', () => {
  const due = { targetWeekStartKey: '2025-08-10', targetWeekEndKey: '2025-08-16' };

  it('is false when nothing is planned in the target week', () => {
    expect(mealPlanNudgeSuppressed(due, [])).toBe(false);
    expect(mealPlanNudgeSuppressed(due, [{ date: '2025-08-09' }, { date: '2025-08-17' }])).toBe(false);
  });

  it('is true when anything at all is planned in the target week', () => {
    expect(mealPlanNudgeSuppressed(due, [{ date: '2025-08-12' }])).toBe(true);
  });

  it('treats both ends of the range as inclusive', () => {
    expect(mealPlanNudgeSuppressed(due, [{ date: '2025-08-10' }])).toBe(true);
    expect(mealPlanNudgeSuppressed(due, [{ date: '2025-08-16' }])).toBe(true);
  });
});

describe('partitionMealPlanNudgeTasks', () => {
  // The week dueMealPlanNudge asks about when it fires on Sun Aug 3.
  const due = { targetWeekStartKey: '2025-08-10', targetWeekEndKey: '2025-08-16' };

  const nudgeTask = (
    overrides: Partial<Task> = {}
  ): Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'> => ({
    generatedKind: 'mealPlanNudge',
    generatedSourceId: '2025-08-11',
    completed: false,
    archived: false,
    ...overrides,
  });

  it('finds nothing in an empty list', () => {
    expect(partitionMealPlanNudgeTasks([], due)).toEqual({ current: [], stale: [] });
  });

  it('counts a live task for a day of the target week as current', () => {
    const task = nudgeTask();
    expect(partitionMealPlanNudgeTasks([task], due)).toEqual({ current: [task], stale: [] });
  });

  it('treats both ends of the target week as inside it', () => {
    const first = nudgeTask({ generatedSourceId: '2025-08-10' });
    const last = nudgeTask({ generatedSourceId: '2025-08-16' });
    expect(partitionMealPlanNudgeTasks([first, last], due).current).toEqual([first, last]);
  });

  it('counts a live task for a day outside that week as stale', () => {
    // Last week's set, still sitting there. Its day has already happened, so it
    // is cleared rather than allowed to block this week's nudge for ever.
    const task = nudgeTask({ generatedSourceId: '2025-08-04' });
    expect(partitionMealPlanNudgeTasks([task], due)).toEqual({ current: [], stale: [task] });
  });

  it('counts a legacy nudge task with no day at all as stale', () => {
    // What an install upgrading into this feature carries: one task for the
    // whole week, backfilled with the kind but no source id.
    const task = nudgeTask({ generatedSourceId: null });
    expect(partitionMealPlanNudgeTasks([task], due)).toEqual({ current: [], stale: [task] });
  });

  it('ignores completed and archived tasks, which are neither', () => {
    const done = nudgeTask({ completed: true });
    const archived = nudgeTask({ archived: true });
    const staleDone = nudgeTask({ generatedSourceId: '2025-08-04', completed: true });
    expect(partitionMealPlanNudgeTasks([done, archived, staleDone], due)).toEqual({
      current: [],
      stale: [],
    });
  });

  it('ignores tasks no generator wrote, live or not', () => {
    // The link alone used to be the marker, so a hand-written task pointing at
    // the meal plan counted as the nudge's own. It no longer does.
    expect(partitionMealPlanNudgeTasks([nudgeTask({ generatedKind: null })], due)).toEqual({
      current: [],
      stale: [],
    });
  });

  it("ignores another generator's task, even one whose source id looks like a day", () => {
    // One column holds four generators' source ids now, so the kind check is
    // the only thing keeping a cook task out of the nudge's week.
    const cook = nudgeTask({ generatedKind: 'mealCook', generatedSourceId: '2025-08-11' });
    expect(partitionMealPlanNudgeTasks([cook], due)).toEqual({ current: [], stale: [] });
  });

  it('splits a mixed list of both weeks', () => {
    const thisWeek = nudgeTask({ generatedSourceId: '2025-08-12' });
    const lastWeek = nudgeTask({ generatedSourceId: '2025-08-05' });
    expect(partitionMealPlanNudgeTasks([lastWeek, thisWeek], due)).toEqual({
      current: [thisWeek],
      stale: [lastWeek],
    });
  });
});

describe('mealPlanNudgeDayKey', () => {
  it('reads the day off a nudge task', () => {
    expect(
      mealPlanNudgeDayKey({ generatedKind: 'mealPlanNudge', generatedSourceId: '2025-08-11' })
    ).toBe('2025-08-11');
  });

  it("refuses another generator's source id", () => {
    expect(
      mealPlanNudgeDayKey({ generatedKind: 'leftoverUseUp', generatedSourceId: 'l-1' })
    ).toBeNull();
  });

  it('is null for a task nothing generated', () => {
    expect(mealPlanNudgeDayKey({ generatedKind: null, generatedSourceId: null })).toBeNull();
  });
});

describe('countPlannedSlots', () => {
  const entry = (date: string, slot: MealSlot) => ({ date, slot });

  it('is zero for a day with nothing on it', () => {
    expect(countPlannedSlots([], '2025-08-11')).toBe(0);
  });

  it('counts each of the three meals once', () => {
    const entries = [
      entry('2025-08-11', 'breakfast'),
      entry('2025-08-11', 'lunch'),
      entry('2025-08-11', 'dinner'),
    ];
    expect(countPlannedSlots(entries, '2025-08-11')).toBe(MEAL_PLAN_NUDGE_SLOT_COUNT);
  });

  it('counts two things on one dinner as one planned meal', () => {
    // There is deliberately no UNIQUE(date, slot) — two dishes on one evening
    // is a legal plan, and counting rows would report 2/3 for a day with one
    // meal on it (and 4/3 for a fuller one).
    const entries = [entry('2025-08-11', 'dinner'), entry('2025-08-11', 'dinner')];
    expect(countPlannedSlots(entries, '2025-08-11')).toBe(1);
  });

  it('does not count a snack', () => {
    // The fourth slot is deliberately unscored: a day is not incomplete for
    // want of a snack, and counting it would put a fully planned day at 3/4.
    const entries = [
      entry('2025-08-11', 'snack'),
      entry('2025-08-11', 'breakfast'),
    ];
    expect(countPlannedSlots(entries, '2025-08-11')).toBe(1);
  });

  it('ignores meals on other days', () => {
    const entries = [
      entry('2025-08-10', 'breakfast'),
      entry('2025-08-12', 'lunch'),
      entry('2025-08-11', 'dinner'),
    ];
    expect(countPlannedSlots(entries, '2025-08-11')).toBe(1);
  });
});

describe('mealPlanNudgeLinkUrl', () => {
  it('carries the day as a query parameter', () => {
    expect(mealPlanNudgeLinkUrl('2025-08-11')).toBe('dundundun://mealplan?date=2025-08-11');
  });

  it('falls back to the bare link rather than minting one that matches nothing', () => {
    expect(mealPlanNudgeLinkUrl('')).toBe(MEAL_PLAN_NUDGE_LINK_URL);
  });
});

describe('constants', () => {
  it('default weekday is Sunday and default time is a plausible morning', () => {
    expect(DEFAULT_MEAL_PLAN_NUDGE_WEEKDAY).toBe(0);
    expect(DEFAULT_MEAL_PLAN_NUDGE_TIME).toBe('09:00');
  });

  it('links to the meal plan screen', () => {
    expect(MEAL_PLAN_NUDGE_LINK_URL).toBe('dundundun://mealplan');
  });
});
