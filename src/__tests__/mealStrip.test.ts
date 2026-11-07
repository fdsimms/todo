import type { FoodLogEntry, FoodNutrition, MealPlanEntry, NutrientKey } from '../types';
import {
  isMealStripDone,
  mealStripCoversMeal,
  mealStripCells,
  mealStripCoins,
  mealStripDoneSlots,
  mealStripOn,
  mealStripSlots,
} from '../utils/mealStrip';
import { baseCoinsFor } from '../utils/rewards';

// Reaches mealPlan.ts, which reaches dateUtils and so the settings store, which
// nothing here needs: every date in this file is a day key. Same mock
// mealLogCoverage.test.ts uses.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const DAY = '2026-11-03';

let seq = 0;
beforeEach(() => { seq = 0; });

function panel(amounts: Partial<Record<NutrientKey, number>>): FoodNutrition {
  return {
    basis: 'perServing', amounts, source: 'manual', servingGrams: null, servingText: null,
    sourceId: null, portions: [], recordedAt: '2026-11-03T12:30:00.000Z',
  };
}

function planned(overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: `m-${++seq}`, date: DAY, slot: 'dinner', recipeId: null, title: 'Frijoles', sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z', cookedAt: null, leftoverId: null,
    recipeChoices: [], recipeOverrides: [], recipeScale: 1,
    cookTask: null, shopTask: null, logMeal: null, calendarEventId: null,
    ...overrides,
  };
}

function logged(overrides: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return {
    id: `f-${++seq}`, dayKey: DAY, atISO: '2026-11-03T12:30:00.000Z', slot: 'lunch', label: 'Sandwich',
    recipeId: null, itemId: null, productId: null, mealPlanEntryId: null, quantity: '1 serving', grams: 200,
    nutrition: panel({ calorieKcal: 420 }), healthSampleIds: [], sortOrder: 0,
    createdAt: '2026-11-03T12:30:00.000Z',
    ...overrides,
  };
}

const title = (e: MealPlanEntry) => e.title;

describe('mealStripOn', () => {
  it('is on only for the strip, and only with the grocery area on', () => {
    expect(mealStripOn({ kitchenEnabled: true, mealsOnToday: 'top' })).toBe(true);
    expect(mealStripOn({ kitchenEnabled: true, mealsOnToday: 'inline' })).toBe(false);
    expect(mealStripOn({ kitchenEnabled: true, mealsOnToday: 'off' })).toBe(false);
    // The area put away hides the strip, and the meal tasks it would have
    // stood in for are stopped by the area's own gate.
    expect(mealStripOn({ kitchenEnabled: false, mealsOnToday: 'top' })).toBe(false);
  });
});

describe('mealStripSlots', () => {
  it('lays the meals out in the order of the day, whatever order they were named in', () => {
    expect(mealStripSlots(['dinner', 'breakfast'])).toEqual(['breakfast', 'dinner']);
    expect(mealStripSlots(['snack', 'lunch', 'breakfast', 'dinner'])).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
  });

  it('falls back to the default three rather than drawing an empty strip', () => {
    expect(mealStripSlots([])).toEqual(['breakfast', 'lunch', 'dinner']);
  });
});

describe('mealStripCells', () => {
  const slots = ['breakfast', 'lunch', 'dinner'] as const;

  it('says what each meal is: logged, planned, or nothing yet', () => {
    const cells = mealStripCells(slots, [planned()], [logged()], DAY, title);
    expect(cells.map(c => [c.slot, c.state, c.text])).toEqual([
      ['breakfast', 'empty', null],
      ['lunch', 'logged', 'Sandwich'],
      ['dinner', 'planned', 'Frijoles'],
    ]);
  });

  it('names a logged meal with the caller\'s label, so one food is not said twice', () => {
    const cells = mealStripCells(
      slots, [], [logged({ label: 'protein powder, Optimum Nutrition' })], DAY, title,
      () => 'Optimum Nutrition',
    );
    expect(cells.find(c => c.slot === 'lunch')?.text).toBe('Optimum Nutrition');
  });

  it('reads the log over the plan, since the log is what was eaten', () => {
    const cells = mealStripCells(
      slots,
      [planned({ slot: 'lunch', title: 'Leftover curry' })],
      [logged({ label: 'Popcorn chicken' }), logged({ label: 'Ketchup' })],
      DAY,
      title,
    );
    const lunch = cells[1];
    expect(lunch.state).toBe('logged');
    expect(lunch.text).toBe('Popcorn chicken, Ketchup');
    // The plan entry is still there for the menu to act on.
    expect(lunch.planned.map(e => e.title)).toEqual(['Leftover curry']);
  });

  it('names a repeated food once', () => {
    const cells = mealStripCells(slots, [], [logged({ label: 'Baked beans' }), logged({ label: 'Baked beans ' })], DAY, title);
    expect(cells[1].text).toBe('Baked beans');
  });

  it('calls a planned meal marked cooked eaten, before anything is logged', () => {
    const cells = mealStripCells(slots, [planned({ cookedAt: '2026-11-03T19:00:00.000Z' })], [], DAY, title);
    expect(cells[2].state).toBe('eaten');
    expect(cells[2].text).toBe('Frijoles');
  });

  it('joins a slot holding two dishes in plan order, through the title it is given', () => {
    const cells = mealStripCells(
      slots,
      [planned({ title: 'Cornbread', sortOrder: 2 }), planned({ title: 'Baked beans', sortOrder: 1 })],
      [],
      DAY,
      e => e.title.toUpperCase(),
    );
    expect(cells[2].text).toBe('BAKED BEANS, CORNBREAD');
    expect(cells[2].planned.map(e => e.title)).toEqual(['Baked beans', 'Cornbread']);
  });

  it('counts water as no meal at all, the way every coverage reader does', () => {
    const water = logged({ label: 'Water', quantity: '500 ml', grams: null, nutrition: panel({ waterMl: 500 }) });
    expect(mealStripCells(slots, [], [water], DAY, title)[1].state).toBe('empty');
  });

  it('ignores other days and meals left out of the strip', () => {
    const cells = mealStripCells(
      ['lunch'],
      [planned({ date: '2026-11-04', slot: 'lunch' })],
      [logged({ dayKey: '2026-11-02' }), logged({ slot: 'snack', label: 'Pretzel' })],
      DAY,
      title,
    );
    expect(cells).toHaveLength(1);
    expect(cells[0].state).toBe('empty');
  });
});

describe('mealStripCells: a skipped meal', () => {
  const slots = ['breakfast', 'lunch', 'dinner'] as const;

  it('reads a skipped meal as skipped, with no text, and leaves the others alone', () => {
    const cells = mealStripCells(slots, [], [], DAY, title, e => e.label, ['breakfast']);
    expect(cells.map(c => [c.slot, c.state, c.text])).toEqual([
      ['breakfast', 'skipped', null],
      ['lunch', 'empty', null],
      ['dinner', 'empty', null],
    ]);
  });

  it('puts the skip over a plan, keeping the entry for the menu', () => {
    const cells = mealStripCells(slots, [planned()], [], DAY, title, e => e.label, ['dinner']);
    expect(cells[2].state).toBe('skipped');
    expect(cells[2].planned.map(e => e.title)).toEqual(['Frijoles']);
  });

  it('lets food in the log or a meal marked eaten win over a skip', () => {
    const cells = mealStripCells(
      slots,
      [planned({ cookedAt: '2026-11-03T19:00:00.000Z' })],
      [logged()],
      DAY,
      title,
      e => e.label,
      ['lunch', 'dinner'],
    );
    expect(cells[1].state).toBe('logged');
    expect(cells[2].state).toBe('eaten');
  });

  it('is not done, so it pays no coins', () => {
    expect(isMealStripDone({ state: 'skipped' })).toBe(false);
  });
});

describe('isMealStripDone / mealStripDoneSlots', () => {
  it('counts a logged meal and a meal marked eaten, and nothing else', () => {
    expect(isMealStripDone({ state: 'logged' })).toBe(true);
    expect(isMealStripDone({ state: 'eaten' })).toBe(true);
    expect(isMealStripDone({ state: 'planned' })).toBe(false);
    expect(isMealStripDone({ state: 'empty' })).toBe(false);
    expect(mealStripDoneSlots(
      ['breakfast', 'lunch', 'dinner'],
      [planned({ slot: 'breakfast', cookedAt: '2026-11-03T08:00:00.000Z' }), planned()],
      [logged()],
      DAY,
    )).toEqual(['breakfast', 'lunch']);
  });
});

describe('mealStripCoins', () => {
  it('pays what the meal task’s Eat step did: an easy half hour', () => {
    expect(mealStripCoins()).toBe(baseCoinsFor({ estimatedMinutes: 30, effort: 0, difficulty: 'easy' }));
    expect(mealStripCoins()).toBeGreaterThan(0);
  });
});

describe('mealStripCoversMeal', () => {
  const on = { kitchenEnabled: true, mealsOnToday: 'top', mealSlotsEnabled: ['lunch', 'dinner'] as const };

  it('covers a strip meal from today to the end of the week the meal tasks were written for', () => {
    expect(mealStripCoversMeal({ ...on, mealSlotsEnabled: [...on.mealSlotsEnabled] }, DAY, 'dinner', DAY)).toBe(true);
    expect(mealStripCoversMeal({ ...on, mealSlotsEnabled: [...on.mealSlotsEnabled] }, '2026-11-09', 'dinner', DAY)).toBe(true);
    expect(mealStripCoversMeal({ ...on, mealSlotsEnabled: [...on.mealSlotsEnabled] }, '2026-11-10', 'dinner', DAY)).toBe(false);
    expect(mealStripCoversMeal({ ...on, mealSlotsEnabled: [...on.mealSlotsEnabled] }, '2026-11-02', 'dinner', DAY)).toBe(false);
  });

  it('covers nothing the strip has no cell for, or with the strip off', () => {
    expect(mealStripCoversMeal({ ...on, mealSlotsEnabled: [...on.mealSlotsEnabled] }, DAY, 'breakfast', DAY)).toBe(false);
    expect(mealStripCoversMeal({ ...on, mealsOnToday: 'inline', mealSlotsEnabled: [...on.mealSlotsEnabled] }, DAY, 'dinner', DAY)).toBe(false);
  });
});
