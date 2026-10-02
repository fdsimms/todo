import type { MealPlanEntry, Task } from '../types';
import {
  isMealLogged,
  isWithinLogNudgeWindow,
  mealLogNudgeEntryId,
  mealLogNudgeLinkUrl,
  mealLogNudgeTitle,
  staleMealLogNudgeTasks,
  wantedMealLogNudges,
  type MealLogRecord,
} from '../utils/mealLogNudgeTasks';
import { mealSlotKey } from '../utils/mealPlan';

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

/** Nothing on file: no plan entry named, no slot with food in it. */
const NOTHING_LOGGED: MealLogRecord = { entryIds: new Set(), slotKeys: new Set() };

/** A food log row naming the plan entry outright — the old, narrow reading. */
function linked(...entryIds: string[]): MealLogRecord {
  return { entryIds: new Set(entryIds), slotKeys: new Set() };
}

/** Food logged into a (day, slot), with nothing pointing back at the plan. */
function inSlot(...meals: Pick<MealPlanEntry, 'date' | 'slot'>[]): MealLogRecord {
  return { entryIds: new Set(), slotKeys: new Set(meals.map(m => mealSlotKey(m.date, m.slot))) };
}

describe('isMealLogged', () => {
  it('counts a food log row that names the meal', () => {
    const meal = entry('2026-08-21');
    expect(isMealLogged(meal, linked(meal.id))).toBe(true);
  });

  it('counts food logged into the meal\'s own slot with nothing linking it', () => {
    const meal = entry('2026-08-21', { slot: 'lunch' });
    expect(isMealLogged(meal, inSlot(meal))).toBe(true);
  });

  it('does not count food logged into a different slot that day', () => {
    const meal = entry('2026-08-21', { slot: 'lunch' });
    expect(isMealLogged(meal, inSlot({ date: '2026-08-21', slot: 'breakfast' }))).toBe(false);
  });

  it('does not count the same slot on a different day', () => {
    const meal = entry('2026-08-21', { slot: 'lunch' });
    expect(isMealLogged(meal, inSlot({ date: '2026-08-20', slot: 'lunch' }))).toBe(false);
  });

  it('still counts a meal eaten late and filed under another slot, via the link', () => {
    const meal = entry('2026-08-21', { slot: 'lunch' });
    const record: MealLogRecord = {
      entryIds: new Set([meal.id]),
      slotKeys: new Set([mealSlotKey('2026-08-21', 'snack')]),
    };
    expect(isMealLogged(meal, record)).toBe(true);
  });
});

describe('mealLogNudgeTitle', () => {
  it('names the verb, the dish, and the night and slot', () => {
    expect(mealLogNudgeTitle('2026-08-19', 'breakfast', 'Overnight oats'))
      .toBe('Log Overnight oats (Wednesday Breakfast)');
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
    const wants = wantedMealLogNudges([meal], NOTHING_LOGGED, TODAY);
    expect(wants).toHaveLength(1);
    expect(wants[0]).toEqual({ entryId: meal.id, title: mealLogNudgeTitle('2026-08-21', 'dinner', 'Chicken tacos'), dayKey: '2026-08-21' });
  });

  it('ignores a meal already logged', () => {
    const meal = entry('2026-08-21');
    expect(wantedMealLogNudges([meal], linked(meal.id), TODAY)).toEqual([]);
  });

  it('ignores a meal whose slot has food in it, logged by hand', () => {
    const meal = entry('2026-08-21', { slot: 'lunch' });
    expect(wantedMealLogNudges([meal], inSlot(meal), TODAY)).toEqual([]);
  });

  it('still asks about the meals of a day only partly logged', () => {
    const lunch = entry('2026-08-21', { slot: 'lunch' });
    const dinner = entry('2026-08-21', { slot: 'dinner' });
    const wants = wantedMealLogNudges([lunch, dinner], inSlot(lunch), TODAY);
    expect(wants.map(w => w.entryId)).toEqual([dinner.id]);
  });

  it('covers both dishes of one dinner with one logged slot', () => {
    const chili = entry('2026-08-21', { slot: 'dinner', title: 'Chili' });
    const salad = entry('2026-08-21', { slot: 'dinner', title: 'Salad' });
    expect(wantedMealLogNudges([chili, salad], inSlot(chili), TODAY)).toEqual([]);
  });

  it('ignores a meal outside the lookback window, in either direction', () => {
    const tooOld = entry('2026-08-15');
    const today = entry(TODAY);
    const future = entry('2026-08-25');
    expect(wantedMealLogNudges([tooOld, today, future], NOTHING_LOGGED, TODAY)).toEqual([]);
  });

  it('does not care whether the meal was ever marked cooked', () => {
    const missed = entry('2026-08-21', { cookedAt: null });
    const cooked = entry('2026-08-20', { cookedAt: '2026-08-20T19:00:00.000Z' });
    const wants = wantedMealLogNudges([missed, cooked], NOTHING_LOGGED, TODAY, 3);
    expect(wants.map(w => w.entryId)).toEqual(expect.arrayContaining([missed.id, cooked.id]));
  });

  it('does not cap the set — every wanted meal in the window gets a row', () => {
    const meals = [
      entry('2026-08-19'), entry('2026-08-20'), entry('2026-08-21'), entry('2026-08-21', { slot: 'lunch' }),
    ];
    expect(wantedMealLogNudges(meals, NOTHING_LOGGED, TODAY, 3)).toHaveLength(4);
  });

  it('skips a meal that has been told not to ask', () => {
    const meal = entry('2026-08-21', { logMeal: false });
    expect(wantedMealLogNudges([meal], NOTHING_LOGGED, TODAY)).toEqual([]);
  });

  it('orders the oldest meal first', () => {
    const older = entry('2026-08-19', { title: 'Older' });
    const newer = entry('2026-08-21', { title: 'Newer' });
    const wants = wantedMealLogNudges([newer, older], NOTHING_LOGGED, TODAY, 3);
    expect(wants.map(w => w.entryId)).toEqual([older.id, newer.id]);
  });

});

describe('staleMealLogNudgeTasks', () => {
  it('leaves a task whose meal still wants asking about', () => {
    const meal = entry('2026-08-21');
    const t = task({ generatedSourceId: meal.id });
    expect(staleMealLogNudgeTasks([t], [meal], NOTHING_LOGGED, TODAY)).toEqual([]);
  });

  it('clears a task whose meal was deleted', () => {
    const t = task({ generatedSourceId: 'gone' });
    expect(staleMealLogNudgeTasks([t], [], NOTHING_LOGGED, TODAY)).toEqual([t]);
  });

  it('clears a task once the meal has been logged', () => {
    const meal = entry('2026-08-21');
    const t = task({ generatedSourceId: meal.id });
    expect(staleMealLogNudgeTasks([t], [meal], linked(meal.id), TODAY)).toEqual([t]);
  });

  it('clears a task once the meal\'s slot has food logged in it', () => {
    const meal = entry('2026-08-21', { slot: 'lunch' });
    const t = task({ generatedSourceId: meal.id });
    expect(staleMealLogNudgeTasks([t], [meal], inSlot(meal), TODAY)).toEqual([t]);
  });

  it('clears a task whose meal has been told not to ask', () => {
    const meal = entry('2026-08-21', { logMeal: false });
    const t = task({ generatedSourceId: meal.id });
    expect(staleMealLogNudgeTasks([t], [meal], NOTHING_LOGGED, TODAY)).toEqual([t]);
  });

  it('clears a task whose meal has fallen out of the lookback window', () => {
    const meal = entry('2026-08-15');
    const t = task({ generatedSourceId: meal.id });
    expect(staleMealLogNudgeTasks([t], [meal], NOTHING_LOGGED, TODAY)).toEqual([t]);
  });

  it('leaves every task whose meal is still wanted, with no cap on how many', () => {
    const meals = [
      entry('2026-08-19'), entry('2026-08-20'), entry('2026-08-21'), entry('2026-08-21', { slot: 'lunch' }),
    ];
    const tasks = meals.map(m => task({ generatedSourceId: m.id }));
    expect(staleMealLogNudgeTasks(tasks, meals, NOTHING_LOGGED, TODAY, 3)).toEqual([]);
  });

  it('ignores completed and archived rows, and other generators', () => {
    const meal = entry('2026-08-15');
    const done = task({ generatedSourceId: meal.id, completed: true });
    const archived = task({ generatedSourceId: meal.id, archived: true });
    const other = task({ generatedSourceId: meal.id, generatedKind: 'mealShortfall' });
    expect(staleMealLogNudgeTasks([done, archived, other], [meal], NOTHING_LOGGED, TODAY)).toEqual([]);
  });
});
