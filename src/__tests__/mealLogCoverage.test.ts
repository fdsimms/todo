import type { FoodLogEntry, FoodNutrition, MealPlanEntry, MealSlot, NutrientKey } from '../types';
import {
  countsAsMealLog,
  describeDayCoverage,
  describePlannedSlot,
  describeSlotLog,
  loggedMealSlotKeys,
  mealDayCoverage,
  unloggedPlannedSlots,
} from '../utils/mealLogCoverage';
import { mealSlotKey } from '../utils/mealPlan';

// Reaches mealPlan.ts, which reaches dateUtils and so the settings store —
// which nothing here needs, since every date in this file is a day key. Same
// mock mealLogNudgeTasks.test.ts uses.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const DAY = '2026-08-21';

let seq = 0;
beforeEach(() => { seq = 0; });

function panel(amounts: Partial<Record<NutrientKey, number>>): FoodNutrition {
  return {
    basis: 'perServing',
    amounts,
    source: 'manual',
    servingGrams: null,
    servingText: null,
    sourceId: null,
    portions: [],
    recordedAt: '2026-08-21T12:30:00.000Z',
  };
}

function planned(overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: `m-${++seq}`,
    date: DAY,
    slot: 'lunch',
    recipeId: null,
    title: 'Chicken salad',
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

function logged(overrides: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return {
    id: `f-${++seq}`,
    dayKey: DAY,
    atISO: '2026-08-21T12:30:00.000Z',
    slot: 'lunch',
    label: 'Chicken salad',
    recipeId: null,
    itemId: null,
    productId: null,
    mealPlanEntryId: null,
    quantity: '1 serving',
    grams: 320,
    nutrition: panel({ calorieKcal: 420 }),
    healthSampleIds: [],
    sortOrder: 0,
    createdAt: '2026-08-21T12:30:00.000Z',
    ...overrides,
  };
}

/** A `waterMl`-only row, which `isWaterEntry` recognises. */
function water(slot: MealSlot | null): FoodLogEntry {
  return logged({ slot, label: 'Water', quantity: '500 ml', grams: null, nutrition: panel({ waterMl: 500 }) });
}

describe('countsAsMealLog', () => {
  it('counts an ordinary food filed under a meal', () => {
    expect(countsAsMealLog(logged())).toBe(true);
  });

  it('refuses a food eaten outside a meal', () => {
    expect(countsAsMealLog(logged({ slot: null }))).toBe(false);
  });

  it('refuses a glass of water, even dragged into a meal', () => {
    expect(countsAsMealLog(water('lunch'))).toBe(false);
  });
});

describe('loggedMealSlotKeys', () => {
  it('names every (day, slot) with food in it', () => {
    const keys = loggedMealSlotKeys([
      logged({ slot: 'lunch' }),
      logged({ slot: 'dinner' }),
      logged({ dayKey: '2026-08-20', slot: 'lunch' }),
    ]);
    expect(keys).toEqual(new Set([
      mealSlotKey(DAY, 'lunch'),
      mealSlotKey(DAY, 'dinner'),
      mealSlotKey('2026-08-20', 'lunch'),
    ]));
  });

  it('collapses several entries in one slot to one key', () => {
    expect(loggedMealSlotKeys([logged(), logged(), logged()]).size).toBe(1);
  });

  it('leaves out water and unslotted rows', () => {
    expect(loggedMealSlotKeys([water('lunch'), logged({ slot: null })])).toEqual(new Set());
  });
});

describe('mealDayCoverage', () => {
  it('pairs a planned meal with the food logged in its slot', () => {
    const lunch = planned();
    const food = logged();
    const coverage = mealDayCoverage([lunch], [food], DAY);
    expect(coverage.get('lunch')).toMatchObject({
      slot: 'lunch',
      planned: [lunch],
      logged: [food],
      linked: false,
    });
    expect(coverage.get('lunch')!.totals.total.calorieKcal).toBe(420);
  });

  it('reports linked when a logged row names one of the slot\'s own entries', () => {
    const lunch = planned();
    const coverage = mealDayCoverage([lunch], [logged({ mealPlanEntryId: lunch.id })], DAY);
    expect(coverage.get('lunch')!.linked).toBe(true);
  });

  it('does not report linked for a row naming some other day\'s meal', () => {
    const lunch = planned();
    const coverage = mealDayCoverage([lunch], [logged({ mealPlanEntryId: 'somewhere-else' })], DAY);
    expect(coverage.get('lunch')!.linked).toBe(false);
  });

  it('leaves out a slot nobody planned and nobody logged', () => {
    expect([...mealDayCoverage([planned()], [], DAY).keys()]).toEqual(['lunch']);
  });

  it('holds a slot that was logged without being planned', () => {
    const coverage = mealDayCoverage([], [logged({ slot: 'snack' })], DAY);
    expect(coverage.get('snack')).toMatchObject({ planned: [], linked: false });
  });

  it('keys by slot in the order a day is read', () => {
    const entries = [planned({ slot: 'dinner' }), planned({ slot: 'breakfast' }), planned({ slot: 'lunch' })];
    expect([...mealDayCoverage(entries, [], DAY).keys()]).toEqual(['breakfast', 'lunch', 'dinner']);
  });

  it('filters both sides to the day asked about', () => {
    const coverage = mealDayCoverage(
      [planned({ date: '2026-08-20' })],
      [logged({ dayKey: '2026-08-20' })],
      DAY,
    );
    expect(coverage.size).toBe(0);
  });

  it('keeps water out of a slot\'s logged run', () => {
    const coverage = mealDayCoverage([planned()], [water('lunch')], DAY);
    expect(coverage.get('lunch')!.logged).toEqual([]);
  });
});

describe('describeSlotLog', () => {
  it('names the slot\'s calories', () => {
    const coverage = mealDayCoverage([planned()], [logged(), logged({ nutrition: panel({ calorieKcal: 180 }) })], DAY);
    expect(describeSlotLog(coverage.get('lunch'))).toBe('Logged 600 cal');
  });

  it('says only that it was logged when nothing stated calories', () => {
    const coverage = mealDayCoverage([planned()], [logged({ nutrition: panel({ proteinG: 20 }) })], DAY);
    expect(describeSlotLog(coverage.get('lunch'))).toBe('Logged');
  });

  it('says nothing for a slot with nothing in it', () => {
    const coverage = mealDayCoverage([planned()], [], DAY);
    expect(describeSlotLog(coverage.get('lunch'))).toBeNull();
    expect(describeSlotLog(undefined)).toBeNull();
  });
});

describe('describeDayCoverage', () => {
  it('counts logged planned slots against planned ones', () => {
    const meals = [planned({ slot: 'breakfast' }), planned({ slot: 'lunch' }), planned({ slot: 'dinner' })];
    expect(describeDayCoverage(meals, [logged({ slot: 'lunch' })], DAY)).toBe('1 of 3 planned meals logged');
  });

  it('counts slots rather than dishes, so two dinners are one meal', () => {
    const meals = [planned({ slot: 'dinner' }), planned({ slot: 'dinner', title: 'Salad' })];
    expect(describeDayCoverage(meals, [], DAY)).toBe('0 of 1 planned meal logged');
  });

  it('says nothing about a day with no plan', () => {
    expect(describeDayCoverage([], [logged()], DAY)).toBeNull();
  });

  it('ignores food logged into a slot nobody planned', () => {
    expect(describeDayCoverage([planned()], [logged({ slot: 'snack' })], DAY)).toBe('0 of 1 planned meal logged');
  });
});

describe('unloggedPlannedSlots', () => {
  it('names the planned slots with nothing in them, in day order', () => {
    const meals = [planned({ slot: 'dinner' }), planned({ slot: 'breakfast' }), planned({ slot: 'lunch' })];
    const open = unloggedPlannedSlots(meals, [logged({ slot: 'lunch' })], DAY);
    expect(open.map(c => c.slot)).toEqual(['breakfast', 'dinner']);
  });

  it('leaves out a slot that was logged but never planned', () => {
    expect(unloggedPlannedSlots([], [logged()], DAY)).toEqual([]);
  });
});

describe('describePlannedSlot', () => {
  it('names the meal and its dish', () => {
    const coverage = mealDayCoverage([planned()], [], DAY);
    expect(describePlannedSlot(coverage.get('lunch')!)).toBe('Lunch · Chicken salad');
  });

  it('counts the extras rather than listing them', () => {
    const meals = [planned({ slot: 'dinner', title: 'Chili' }), planned({ slot: 'dinner', title: 'Salad' })];
    const coverage = mealDayCoverage(meals, [], DAY);
    expect(describePlannedSlot(coverage.get('dinner')!)).toBe('Dinner · Chili and 1 more');
  });
});
