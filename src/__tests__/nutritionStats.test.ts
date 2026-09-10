import type { FoodLogEntry, FoodNutritionSource, NutrientKey } from '../types';
import { cookingWindow } from '../utils/cookingStats';
import {
  EMPTY_NUTRITION_COUNTS,
  foodDayInputs,
  hasNutritionData,
  mostLoggedFoods,
  nutrientAverages,
  nutritionCounts,
  sourceMix,
} from '../utils/nutritionStats';

// nutritionStats reaches dateUtils for dayKeyToDate, and cookingStats reaches it
// for dayKeyOf, which reaches the settings store for dayResetTime — which
// nothing here needs, since every date it compares is a calendar day key. Same
// stub cookingStats.test.ts uses, for the same reason.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

// A fixed local Thursday, so a run at 23:59 is the same test as a run at noon
// and a runner's zone can't move the window. `cookingWindow` takes the logical
// day rather than reaching for `new Date()`, which is what makes that possible.
const TODAY = new Date(2026, 8, 10, 12, 0, 0);
const WINDOW = cookingWindow(TODAY, 30);

let seq = 0;

function entry(
  dayKey: string,
  over: {
    label?: string;
    slot?: FoodLogEntry['slot'];
    amounts?: Partial<Record<NutrientKey, number>>;
    source?: FoodNutritionSource;
    recipeId?: string | null;
    hour?: number;
  } = {},
): FoodLogEntry {
  seq += 1;
  const hour = String(over.hour ?? 8).padStart(2, '0');
  return {
    id: `e${seq}`,
    dayKey,
    atISO: `${dayKey}T${hour}:00:00.000Z`,
    slot: over.slot ?? 'breakfast',
    label: over.label ?? 'Porridge',
    recipeId: over.recipeId ?? null,
    itemId: null,
    productId: null,
    mealPlanEntryId: null,
    quantity: '1 bowl',
    grams: 200,
    nutrition: {
      basis: 'perServing',
      servingGrams: 200,
      servingText: '1 bowl',
      amounts: over.amounts ?? { calorieKcal: 300, proteinG: 10 },
      source: over.source ?? 'fdc',
      sourceId: null,
      portions: [],
      recordedAt: `${dayKey}T${hour}:00:00.000Z`,
    },
    healthSampleIds: [],
    createdAt: `${dayKey}T${hour}:00:00.000Z`,
  };
}

/** A day logged completely enough to stand for itself: two different meals. */
function fullDay(dayKey: string, over: Parameters<typeof entry>[1] = {}): FoodLogEntry[] {
  return [
    entry(dayKey, { ...over, slot: 'breakfast', hour: 8 }),
    entry(dayKey, { ...over, slot: 'dinner', hour: 19 }),
  ];
}

describe('nutritionCounts', () => {
  it('counts the window, the days logged and the entries', () => {
    const counts = nutritionCounts(
      [...fullDay('2026-09-08'), ...fullDay('2026-09-09')],
      WINDOW,
    );
    expect(counts.days).toBe(30);
    expect(counts.daysLogged).toBe(2);
    expect(counts.entries).toBe(4);
  });

  it('separates a day somebody started logging from one they finished', () => {
    // Breakfast and nothing after is not a day's eating, and averaging it
    // beside a full day would report a calorie count nobody ate.
    const counts = nutritionCounts(
      [...fullDay('2026-09-08'), entry('2026-09-09', { slot: 'breakfast' })],
      WINDOW,
    );
    expect(counts.daysLogged).toBe(2);
    expect(counts.daysComplete).toBe(1);
  });

  it('counts two entries in one meal as one meal', () => {
    const counts = nutritionCounts(
      [
        entry('2026-09-08', { slot: 'breakfast', hour: 8 }),
        entry('2026-09-08', { slot: 'breakfast', hour: 9 }),
      ],
      WINDOW,
    );
    expect(counts.daysComplete).toBe(0);
  });

  it('counts today, since it is a day that happened', () => {
    const counts = nutritionCounts(fullDay('2026-09-10'), WINDOW);
    expect(counts.daysLogged).toBe(1);
  });

  it('ignores anything outside the window', () => {
    const counts = nutritionCounts(
      [...fullDay('2026-01-01'), ...fullDay('2026-09-09')],
      WINDOW,
    );
    expect(counts.daysLogged).toBe(1);
    expect(counts.entries).toBe(2);
  });

  it('reads as nothing rather than as a run of zeroes', () => {
    expect(nutritionCounts([], WINDOW).entries).toBe(0);
    expect(EMPTY_NUTRITION_COUNTS.daysLogged).toBe(0);
  });
});

describe('nutrientAverages', () => {
  it('averages over the days that were logged, never over the window', () => {
    // Two days of 600 calories inside a thirty-day window averages 600, not 40.
    // A day nobody logged is not a day of nothing.
    const rows = nutrientAverages(
      [...fullDay('2026-09-08'), ...fullDay('2026-09-09')],
      WINDOW,
    );
    const calories = rows.find(r => r.key === 'calorieKcal');
    expect(calories).toEqual({ key: 'calorieKcal', total: 1200, days: 2, average: 600 });
  });

  it('leaves today out, since it is still being eaten', () => {
    const rows = nutrientAverages(
      [...fullDay('2026-09-09'), ...fullDay('2026-09-10', { amounts: { calorieKcal: 10 } })],
      WINDOW,
    );
    expect(rows.find(r => r.key === 'calorieKcal')?.days).toBe(1);
    expect(rows.find(r => r.key === 'calorieKcal')?.average).toBe(600);
  });

  it('leaves out a day nobody finished logging', () => {
    const rows = nutrientAverages(
      [...fullDay('2026-09-08'), entry('2026-09-09', { amounts: { calorieKcal: 5 } })],
      WINDOW,
    );
    expect(rows.find(r => r.key === 'calorieKcal')?.days).toBe(1);
    expect(rows.find(r => r.key === 'calorieKcal')?.average).toBe(600);
  });

  it('divides each nutrient by the days that stated it', () => {
    // Fibre on one day of two is a one-day average, and says so. Dividing by
    // every logged day would report it as though thirty days agreed.
    const rows = nutrientAverages(
      [
        ...fullDay('2026-09-08', { amounts: { calorieKcal: 300, fiberG: 4 } }),
        ...fullDay('2026-09-09', { amounts: { calorieKcal: 300 } }),
      ],
      WINDOW,
    );
    expect(rows.find(r => r.key === 'calorieKcal')?.days).toBe(2);
    const fiber = rows.find(r => r.key === 'fiberG');
    expect(fiber?.days).toBe(1);
    expect(fiber?.average).toBe(8);
  });

  it('gives a nutrient nothing stated no average at all', () => {
    const rows = nutrientAverages(fullDay('2026-09-08'), WINDOW);
    expect(rows.some(r => r.key === 'caffeineMg')).toBe(false);
  });

  it('says nothing for a window with nothing finished in it', () => {
    expect(nutrientAverages([], WINDOW)).toEqual([]);
    expect(nutrientAverages(fullDay('2026-09-10'), WINDOW)).toEqual([]);
  });

  it('reports in the order a label prints them', () => {
    const rows = nutrientAverages(
      fullDay('2026-09-08', { amounts: { proteinG: 10, calorieKcal: 300 } }),
      WINDOW,
    );
    expect(rows.map(r => r.key)).toEqual(['calorieKcal', 'proteinG']);
  });
});

describe('mostLoggedFoods', () => {
  it('ranks by how often something was logged', () => {
    const rows = mostLoggedFoods(
      [
        entry('2026-09-08', { label: 'Porridge' }),
        entry('2026-09-09', { label: 'Porridge' }),
        entry('2026-09-09', { label: 'Toast' }),
      ],
      WINDOW,
    );
    expect(rows.map(r => [r.label, r.count])).toEqual([['Porridge', 2], ['Toast', 1]]);
  });

  it('groups by the label rather than by a catalog id', () => {
    // itemId and recipeId are null for anything typed in, so grouping on those
    // would silently drop every hand-entered food from the leaderboard.
    const rows = mostLoggedFoods(
      [entry('2026-09-08', { label: 'Toast' }), entry('2026-09-09', { label: 'Toast' })],
      WINDOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(2);
  });

  it('breaks a tie on the most recent, then on the label', () => {
    const rows = mostLoggedFoods(
      [
        entry('2026-09-01', { label: 'Apple' }),
        entry('2026-09-09', { label: 'Banana' }),
      ],
      WINDOW,
    );
    expect(rows.map(r => r.label)).toEqual(['Banana', 'Apple']);
  });

  it('honours its limit and drops a nameless row', () => {
    const rows = mostLoggedFoods(
      [
        entry('2026-09-08', { label: 'A' }),
        entry('2026-09-08', { label: 'B' }),
        entry('2026-09-08', { label: '   ' }),
      ],
      WINDOW,
      1,
    );
    expect(rows).toHaveLength(1);
  });

  it('ignores anything outside the window', () => {
    expect(mostLoggedFoods([entry('2026-01-01')], WINDOW)).toEqual([]);
  });
});

describe('sourceMix', () => {
  it('counts where the figures came from, four claims kept apart', () => {
    const mix = sourceMix(
      [
        entry('2026-09-08', { source: 'openFoodFacts' }),
        entry('2026-09-08', { source: 'fdc' }),
        entry('2026-09-09', { source: 'manual' }),
        entry('2026-09-09', { source: 'estimated', recipeId: 'r1' }),
      ],
      WINDOW,
    );
    expect(mix).toEqual({ label: 1, database: 1, manual: 1, estimated: 1, fromRecipe: 1 });
  });

  it('counts a recipe helping alongside its source rather than instead of it', () => {
    // How the figures were arrived at and what they were a helping of are two
    // different facts, and the second doesn't replace the first.
    const mix = sourceMix(
      [entry('2026-09-08', { source: 'estimated', recipeId: 'r1' })],
      WINDOW,
    );
    expect(mix.estimated).toBe(1);
    expect(mix.fromRecipe).toBe(1);
  });

  it('is empty for a window with nothing in it', () => {
    expect(sourceMix([], WINDOW)).toEqual({
      label: 0, database: 0, manual: 0, estimated: 0, fromRecipe: 0,
    });
  });
});

describe('hasNutritionData', () => {
  it('separates nothing logged from nothing looked at yet', () => {
    // A null means nothing has read yet, which is a third answer and must not
    // render as a row of zeroes.
    expect(hasNutritionData(null)).toBe(false);
    expect(hasNutritionData(nutritionCounts([], WINDOW))).toBe(false);
    expect(hasNutritionData(nutritionCounts(fullDay('2026-09-08'), WINDOW))).toBe(true);
  });
});

describe('foodDayInputs', () => {
  it('gives a day that reached two meals a row of its totals', () => {
    const [row] = foodDayInputs(fullDay('2026-09-08'));
    expect(row.dayKey).toBe('2026-09-08');
    expect(row.nutrients).toEqual({ calorieKcal: 600, proteinG: 20 });
  });

  it('refuses a day logged too thinly to stand for a day of eating', () => {
    // The rule the whole pairing rests on. Somebody who logged breakfast and
    // got on with their life did not eat 300 calories, and a correlation fed
    // that figure manufactures "your mood is lower on the days you eat less"
    // out of the days somebody stopped logging at 11am.
    expect(foodDayInputs([entry('2026-09-08')])).toEqual([]);
  });

  it('pools every unslotted entry into one bucket, so two snacks are not two meals', () => {
    expect(foodDayInputs([
      entry('2026-09-08', { slot: null, hour: 11 }),
      entry('2026-09-08', { slot: null, hour: 16 }),
    ])).toEqual([]);
  });

  it('keeps today, unlike the averages', () => {
    // Averaging stops at yesterday because a partial day drags a mean down.
    // This is paired rather than averaged, and the two-meal bar already asks
    // that question — so dropping today would cost somebody the day they are
    // most likely to be looking at.
    const todayKey = WINDOW.todayKey;
    expect(foodDayInputs(fullDay(todayKey)).map(r => r.dayKey)).toEqual([todayKey]);
  });

  it('drops a nutrient that only some of the day stated, rather than reporting a partial total', () => {
    // Perfectly good on the day's own card, where a coverage clause travels
    // with it. Across days there is nowhere to print one, and the coverage
    // varies day to day, so the variation reads as variation in the food.
    const [row] = foodDayInputs([
      entry('2026-09-08', { slot: 'breakfast', amounts: { calorieKcal: 300, fiberG: 4 } }),
      entry('2026-09-08', { slot: 'dinner', amounts: { calorieKcal: 500 } }),
    ]);
    expect(row.nutrients.calorieKcal).toBe(800);
    expect(row.nutrients.fiberG).toBeUndefined();
  });

  it('never sums an absent nutrient as a zero', () => {
    const [row] = foodDayInputs([
      entry('2026-09-08', { slot: 'breakfast', amounts: { calorieKcal: 300 } }),
      entry('2026-09-08', { slot: 'dinner', amounts: { calorieKcal: 500 } }),
    ]);
    expect('proteinG' in row.nutrients).toBe(false);
  });

  it('folds two spellings of one food into a single label', () => {
    // Two groups built from one habit halve the days on each side of every
    // contrast that reads them.
    const [row] = foodDayInputs([
      entry('2026-09-08', { slot: 'breakfast', label: 'Coffee' }),
      entry('2026-09-08', { slot: 'dinner', label: 'coffee' }),
    ]);
    expect(row.labels).toEqual(['coffee']);
  });

  it('comes back oldest first', () => {
    expect(foodDayInputs([
      ...fullDay('2026-09-09'),
      ...fullDay('2026-09-07'),
    ]).map(r => r.dayKey)).toEqual(['2026-09-07', '2026-09-09']);
  });
});
