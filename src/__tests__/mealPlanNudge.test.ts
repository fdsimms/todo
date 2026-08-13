import {
  DEFAULT_MEAL_PLAN_NUDGE_TIME,
  DEFAULT_MEAL_PLAN_NUDGE_WEEKDAY,
  MEAL_PLAN_NUDGE_LINK_URL,
  dueMealPlanNudge,
  mealPlanNudgeSuppressed,
  hasLiveMealPlanNudgeTask,
} from '../utils/mealPlanNudge';
import type { Task } from '../types';

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

  it('titles the task with the target week\'s own date range', () => {
    const due = dueMealPlanNudge(SUN_AUG_3(9, 0), 0, 0, '09:00', null);
    expect(due!.title).toBe('Plan meals for 10 – 16 Aug');
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

describe('hasLiveMealPlanNudgeTask', () => {
  const nudgeTask = (overrides: Partial<Task> = {}): Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'> => ({
    generatedKind: 'mealPlanNudge',
    generatedSourceId: null,
    completed: false,
    archived: false,
    ...overrides,
  });

  it('is false with no tasks at all', () => {
    expect(hasLiveMealPlanNudgeTask([])).toBe(false);
  });

  it('is true when an incomplete, unarchived nudge task exists', () => {
    expect(hasLiveMealPlanNudgeTask([nudgeTask()])).toBe(true);
  });

  it('ignores a completed nudge task', () => {
    expect(hasLiveMealPlanNudgeTask([nudgeTask({ completed: true })])).toBe(false);
  });

  it('ignores an archived nudge task', () => {
    expect(hasLiveMealPlanNudgeTask([nudgeTask({ archived: true })])).toBe(false);
  });

  it('ignores tasks no generator wrote, live or not', () => {
    // The link alone used to be the marker, so a hand-written task pointing at
    // the meal plan counted as the nudge's own. It no longer does.
    expect(hasLiveMealPlanNudgeTask([nudgeTask({ generatedKind: null })])).toBe(false);
  });

  it('ignores a task another generator wrote', () => {
    expect(
      hasLiveMealPlanNudgeTask([nudgeTask({ generatedKind: 'mealCook', generatedSourceId: 'm-1' })])
    ).toBe(false);
  });

  it('is true if any one task among several is a live nudge task', () => {
    expect(
      hasLiveMealPlanNudgeTask([
        nudgeTask({ generatedKind: null }),
        nudgeTask({ completed: true }),
        nudgeTask(),
      ])
    ).toBe(true);
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
