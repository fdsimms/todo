import {
  describeWater,
  describeWaterDay,
  describeWaterMl,
  isWaterEntry,
  waterEntryOf,
  waterHelping,
  waterInUnit,
  waterRange,
  waterToMl,
  waterTotalMl,
  WATER_MAX_ML,
  WATER_MIN_ML,
  WATER_STEP_ML,
} from '../utils/waterLog';
import type { FoodLogEntry, FoodNutrition, NutrientKey } from '../types';

const NOW = new Date('2026-04-02T18:30:00.000Z');

function panel(amounts: Partial<Record<NutrientKey, number>>): FoodNutrition {
  return {
    basis: 'perServing',
    servingGrams: null,
    servingText: null,
    amounts,
    source: 'manual',
    sourceId: null,
    portions: [],
    recordedAt: '2026-04-02T00:00:00.000Z',
  };
}

let seq = 0;
function entry(overrides: Partial<FoodLogEntry> = {}): FoodLogEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    dayKey: '2026-04-02',
    atISO: `2026-04-02T0${seq}:00:00.000Z`,
    slot: null,
    label: 'Water',
    recipeId: null,
    itemId: null,
    productId: null,
    mealPlanEntryId: null,
    quantity: '500 ml',
    grams: null,
    nutrition: panel({ waterMl: 500 }),
    healthSampleIds: [],
    sortOrder: 0,
    createdAt: '2026-04-02T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => { seq = 0; });

describe('the stepper range', () => {
  it('is the target sheet\'s own range, so the two can\'t disagree', () => {
    expect(WATER_STEP_ML).toBe(250);
    expect(WATER_MIN_ML).toBe(250);
    expect(WATER_MAX_ML).toBe(6000);
  });
});

describe('isWaterEntry', () => {
  it('claims an unfiled entry stating water and nothing else', () => {
    expect(isWaterEntry(entry())).toBe(true);
  });

  it('leaves a bottle picked out of the catalog alone', () => {
    // It belongs in its meal, and stepping the day's water must not rewrite
    // the row that says which bottle it was.
    expect(isWaterEntry(entry({ itemId: 'item-bottled' }))).toBe(false);
    expect(isWaterEntry(entry({ productId: 'prod-bottled' }))).toBe(false);
    expect(isWaterEntry(entry({ recipeId: 'r1' }))).toBe(false);
  });

  it('leaves a drink stating a second nutrient alone', () => {
    expect(isWaterEntry(entry({ nutrition: panel({ waterMl: 250, caffeineMg: 80 }) }))).toBe(false);
  });

  it('refuses an entry stating no water at all', () => {
    expect(isWaterEntry(entry({ nutrition: panel({ calorieKcal: 90 }) }))).toBe(false);
  });
});

describe('waterEntryOf', () => {
  it('finds the day\'s water among the food', () => {
    const toast = entry({ label: 'Toast', nutrition: panel({ calorieKcal: 90 }) });
    const water = entry();
    expect(waterEntryOf([toast, water])?.id).toBe(water.id);
  });

  it('is null on a day with nothing logged, and on one with only food', () => {
    expect(waterEntryOf([])).toBeNull();
    expect(waterEntryOf([entry({ nutrition: panel({ calorieKcal: 90 }) })])).toBeNull();
  });

  it('takes the first of two, which is what a sync can leave behind', () => {
    const a = entry();
    const b = entry();
    expect(waterEntryOf([a, b])?.id).toBe(a.id);
  });
});

describe('waterTotalMl', () => {
  it('counts every entry stating water, not just the stepper\'s row', () => {
    // A bottle logged as a catalog food is water somebody drank, so the figure
    // against the target has to say so.
    const stepped = entry({ nutrition: panel({ waterMl: 1000 }) });
    const bottle = entry({ itemId: 'item-bottled', nutrition: panel({ waterMl: 500, calorieKcal: 0 }) });
    expect(waterTotalMl([stepped, bottle])).toBe(1500);
  });

  it('is zero when nothing stated water', () => {
    expect(waterTotalMl([entry({ nutrition: panel({ calorieKcal: 90 }) })])).toBe(0);
  });

  it('ignores a broken figure rather than summing it', () => {
    const broken = entry({ nutrition: panel({ waterMl: Number.NaN }) });
    expect(waterTotalMl([broken, entry()])).toBe(500);
  });
});

describe('describeWaterMl', () => {
  it('says millilitres below a litre', () => {
    expect(describeWaterMl(250)).toBe('250 ml');
    expect(describeWaterMl(750)).toBe('750 ml');
  });

  it('says litres at a litre and above, without trailing zeroes', () => {
    expect(describeWaterMl(1000)).toBe('1 L');
    expect(describeWaterMl(1500)).toBe('1.5 L');
    expect(describeWaterMl(2250)).toBe('2.25 L');
  });

  it('answers something for a broken figure rather than throwing', () => {
    expect(describeWaterMl(Number.NaN)).toBe('0 ml');
  });
});

describe('the two units', () => {
  it('steps in whole fluid ounces rather than the millilitre step converted', () => {
    // 250ml is 8.45 fl oz, which would put a decimal on every figure. 8 is the
    // glass the unit is actually counted in.
    expect(waterRange('ml')).toEqual({ min: 250, max: 6000, step: 250 });
    expect(waterRange('flOz')).toEqual({ min: 8, max: 200, step: 8 });
  });

  it('reads a stored volume as whole units of the picked one', () => {
    expect(waterInUnit(1250, 'ml')).toBe(1250);
    expect(waterInUnit(1250, 'flOz')).toBe(42);
  });

  it('has no number to show for a day with no water', () => {
    expect(waterInUnit(null, 'flOz')).toBeNull();
    expect(waterInUnit(0, 'ml')).toBeNull();
  });

  it('converts the stepper\'s number back to what is stored', () => {
    expect(waterToMl(1250, 'ml')).toBe(1250);
    expect(waterToMl(42, 'flOz')).toBe(1242);
    expect(waterToMl(null, 'flOz')).toBe(0);
  });

  it('round-trips lossily in ounces, which is the cost of counting in them', () => {
    const back = waterToMl(waterInUnit(1250, 'flOz'), 'flOz');
    expect(back).not.toBe(1250);
    expect(Math.abs(back - 1250)).toBeLessThan(15);
  });

  it('stays in ounces all the way up, since there is no bigger unit a drink uses', () => {
    expect(describeWater(1500, 'ml')).toBe('1.5 L');
    expect(describeWater(1500, 'flOz')).toBe('51 fl oz');
    expect(describeWater(250, 'flOz')).toBe('8 fl oz');
  });

  it('writes the target comparison in the picked unit too', () => {
    expect(describeWaterDay(1500, 1500, 2000, 'flOz')).toBe('51 fl oz of 68 fl oz');
  });
});

describe('describeWaterDay', () => {
  it('writes both halves in the stepper\'s own shape', () => {
    // The point of not reusing describeAgainstTarget, which says "1,500 of
    // 2,000ml" beside a stepper reading "1.5 L".
    expect(describeWaterDay(1500, 1500, 2000)).toBe('1.5 L of 2 L');
  });

  it('says nothing on a day with no water', () => {
    expect(describeWaterDay(0, null, 2000)).toBeNull();
  });

  it('reports the day rather than the stepper\'s row', () => {
    // A bottle logged as a catalog food is water somebody drank.
    expect(describeWaterDay(2000, 1500, 2000)).toBe('2 L of 2 L');
  });

  it('still reports a day with no target when something else stated water', () => {
    // Otherwise that bottle is invisible, since the totals card leaves water out.
    expect(describeWaterDay(2000, 1500, undefined)).toBe('2 L today');
  });

  it('withholds a no-target line the stepper has already said', () => {
    expect(describeWaterDay(1500, 1500, undefined)).toBeNull();
    expect(describeWaterDay(500, 500, undefined)).toBeNull();
  });

  it('treats a target of zero as no target', () => {
    expect(describeWaterDay(1500, 1500, 0)).toBeNull();
  });
});

describe('waterHelping', () => {
  it('states the volume and nothing else', () => {
    const built = waterHelping(1500, NOW)!;
    expect(built.label).toBe('Water');
    expect(built.quantity).toBe('1.5 L');
    expect(built.nutrition.amounts).toEqual({ waterMl: 1500 });
    expect(built.nutrition.servingText).toBe('1.5 L');
    expect(built.nutrition.source).toBe('manual');
  });

  it('carries no weight, rather than inventing a density', () => {
    expect(waterHelping(1000, NOW)!.nutrition.servingGrams).toBeNull();
  });

  it('builds an entry `isWaterEntry` claims, which is what makes stepping work', () => {
    const built = waterHelping(500, NOW)!;
    expect(isWaterEntry(entry({ ...built }))).toBe(true);
  });

  it('is null at nothing, so the caller deletes the row instead of storing a zero', () => {
    expect(waterHelping(0, NOW)).toBeNull();
    expect(waterHelping(-250, NOW)).toBeNull();
    expect(waterHelping(Number.NaN, NOW)).toBeNull();
  });
});
