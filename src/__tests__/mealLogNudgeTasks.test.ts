import type { MealPlanEntry, Task } from '../types';
import {
  MAX_MEAL_LOG_NUDGE_TASKS,
  MEAL_LOG_NUDGE_LOOKBACK_DAYS,
  isWithinLogNudgeWindow,
  mealLogNudgeEntryId,
  mealLogNudgeLinkUrl,
  mealLogNudgeTitle,
  staleMealLogNudgeTasks,
  wantedMealLogNudges,
} from '../utils/mealLogNudgeTasks';

// Reaches mealPlan.ts for shiftDayKey/slotRank, which reaches dateUtils and so
// the settings store — which nothing here needs, since a day key is a
// calendar day and carries no time. Same mock mealShortfallTasks.test.ts uses.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;
beforeEach(() => { seq = 0; });

const TODAY = '2026-08-22';

function entry(date: string, overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: `m-${++seq}`,
    date,
    slot: 'dinner',
    recipeId: null,
    title: 'Chicken tacos',
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookedAt: null,
    leftoverId: null,
    recipeChoices: [],
    personIds: [],
    recipeScale: 1,
    cookTask: null,
    shopTask: null,
    logMeal: null,
    calendarEventId: null,
    ...overrides,
  };
}

function task(overrides: Partial<Task> & { generatedSourceId: string | null }): Pick<
  Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'
> {
  return {
    generatedKind: 'mealLogNudge',
    completed: false,
    archived: false,
    ...overrides,
  } as Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>;
}

describe('mealLogNudgeTitle', () => {
  it('names the verb, the dish, and the night and slot', () => {
    expect(mealLogNudgeTitle('2026-08-19', 'breakfast', 'Overnight oats'))
      .toBe('Log Overnight oats (Wed Breakfast)');
  });
});

describe('mealLogNudgeEntryId', () => {
  it('reads its own kind and no other', () => {
    expect(mealLogNudgeEntryId({ generatedKind: 'mealLogNudge', generatedSourceId: 'm-1' })).toBe('m-1');
    expect(mealLogNudgeEntryId({ generatedKind: 'mealShortfall', generatedSourceId: 'm-1' })).toBeNull();
  });
});

describe('mealLogNudgeLinkUrl', () => {
  it('opens the meal plan on the day the meal is on', () => {
    expect(mealLogNudgeLinkUrl('2026-08-19')).toBe('dundundun://mealplan?date=2026-08-19');
  });
});

describe('isWithinLogNudgeWindow', () => {
  it('excludes today — there is still all day to log it', () => {
    expect(isWithinLogNudgeWindow(TODAY, TODAY)).toBe(false);
  });

  it('includes yesterday and the earliest day of the lookback', () => {
    expect(isWithinLogNudgeWindow('2026-08-21', TODAY, 3)).toBe(true);
    expect(isWithinLogNudgeWindow('2026-08-19', TODAY, 3)).toBe(true);
  });

  it('excludes a day further back than the lookback', () => {
    expect(isWithinLogNudgeWindow('2026-08-18', TODAY, 3)).toBe(false);
  });

  it('excludes a day in the future', () => {
    expect(isWithinLogNudgeWindow('2026-08-23', TODAY, 3)).toBe(false);
  });
});

describe('wantedMealLogNudges', () => {
  it('wants a past meal with nothing logged', () => {
    const meal = entry('2026-08-21');
    const wants = wantedMealLogNudges([meal], new Set(), TODAY);
    expect(wants).toHaveLength(1);
    expect(wants[0]).toEqual({ entryId: meal.id, title: mealLogNudgeTitle('2026-08-21', 'dinner', 'Chicken tacos'), dayKey: '2026-08-21' });
  });

  it('ignores a meal already logged', () => {
    const meal = entry('2026-08-21');
    expect(wantedMealLogNudges([meal], new Set([meal.id]), TODAY)).toEqual([]);
  });

  it('ignores a meal outside the lookback window, in either direction', () => {
    const tooOld = entry('2026-08-15');
    const today = entry(TODAY);
    const future = entry('2026-08-25');
    expect(wantedMealLogNudges([tooOld, today, future], new Set(), TODAY)).toEqual([]);
  });

  it('does not care whether the meal was ever marked cooked', () => {
    const missed = entry('2026-08-21', { cookedAt: null });
    const cooked = entry('2026-08-20', { cookedAt: '2026-08-20T19:00:00.000Z' });
    const wants = wantedMealLogNudges([missed, cooked], new Set(), TODAY);
    expect(wants.map(w => w.entryId)).toEqual(expect.arrayContaining([missed.id, cooked.id]));
  });

  it('skips a meal that has been told not to ask', () => {
    const meal = entry('2026-08-21', { logMeal: false });
    expect(wantedMealLogNudges([meal], new Set(), TODAY)).toEqual([]);
  });

  it('orders the oldest meal first', () => {
    const older = entry('2026-08-19', { title: 'Older' });
    const newer = entry('2026-08-21', { title: 'Newer' });
    const wants = wantedMealLogNudges([newer, older], new Set(), TODAY);
    expect(wants.map(w => w.entryId)).toEqual([older.id, newer.id]);
  });

  it('caps the set', () => {
    const meals = [
      entry('2026-08-19'), entry('2026-08-20'), entry('2026-08-21'), entry('2026-08-21', { slot: 'lunch' }),
    ];
    expect(wantedMealLogNudges(meals, new Set(), TODAY, MEAL_LOG_NUDGE_LOOKBACK_DAYS, 2)).toHaveLength(2);
    expect(MAX_MEAL_LOG_NUDGE_TASKS).toBeGreaterThan(0);
  });
});

describe('staleMealLogNudgeTasks', () => {
  it('leaves a task whose meal still wants asking about', () => {
    const meal = entry('2026-08-21');
    const t = task({ generatedSourceId: meal.id });
    expect(staleMealLogNudgeTasks([t], [meal], new Set(), TODAY)).toEqual([]);
  });

  it('clears a task whose meal was deleted', () => {
    const t = task({ generatedSourceId: 'gone' });
    expect(staleMealLogNudgeTasks([t], [], new Set(), TODAY)).toEqual([t]);
  });

  it('clears a task once the meal has been logged', () => {
    const meal = entry('2026-08-21');
    const t = task({ generatedSourceId: meal.id });
    expect(staleMealLogNudgeTasks([t], [meal], new Set([meal.id]), TODAY)).toEqual([t]);
  });

  it('clears a task whose meal has been told not to ask', () => {
    const meal = entry('2026-08-21', { logMeal: false });
    const t = task({ generatedSourceId: meal.id });
    expect(staleMealLogNudgeTasks([t], [meal], new Set(), TODAY)).toEqual([t]);
  });

  it('clears a task whose meal has fallen out of the lookback window', () => {
    const meal = entry('2026-08-15');
    const t = task({ generatedSourceId: meal.id });
    expect(staleMealLogNudgeTasks([t], [meal], new Set(), TODAY)).toEqual([t]);
  });

  it('is judged on the predicate alone, never on the cap', () => {
    const meals = [
      entry('2026-08-19'), entry('2026-08-20'), entry('2026-08-21'), entry('2026-08-21', { slot: 'lunch' }),
    ];
    const tasks = meals.map(m => task({ generatedSourceId: m.id }));
    expect(staleMealLogNudgeTasks(tasks, meals, new Set(), TODAY)).toEqual([]);
  });

  it('ignores completed and archived rows, and other generators', () => {
    const meal = entry('2026-08-15');
    const done = task({ generatedSourceId: meal.id, completed: true });
    const archived = task({ generatedSourceId: meal.id, archived: true });
    const other = task({ generatedSourceId: meal.id, generatedKind: 'mealShortfall' });
    expect(staleMealLogNudgeTasks([done, archived, other], [meal], new Set(), TODAY)).toEqual([]);
  });
});
