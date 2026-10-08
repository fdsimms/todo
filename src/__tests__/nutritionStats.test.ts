import type { FoodLogEntry, FoodNutritionSource, NutrientKey } from '../types';
import { cookingWindow, lastDaysOf } from '../utils/cookingStats';
import {
  EMPTY_NUTRITION_COUNTS,
  foodDayInputs,
  foodKeyNames,
  foodKeyResolver,
  hasNutritionData,
  mostLoggedFoods,
  daysWithinLimits,
  nutrientAverages,
  nutritionCounts,
  produceAverage,
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
    itemId?: string | null;
    productId?: string | null;
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
    itemId: over.itemId ?? null,
    productId: over.productId ?? null,
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
    sortOrder: 0,
    createdAt: `${dayKey}T${hour}:00:00.000Z`,
  };
}

/** The day's water, as the stepper files it: unslotted, stating only water. */
function water(dayKey: string, ml = 1500): FoodLogEntry {
  return entry(dayKey, { slot: null, label: 'Water', amounts: { waterMl: ml }, hour: 12 });
}

/** A day logged completely enough to stand for itself: two different meals. */
function fullDay(dayKey: string, over: Parameters<typeof entry>[1] = {}): FoodLogEntry[] {
  return [
    entry(dayKey, { ...over, slot: 'breakfast', hour: 8 }),
    entry(dayKey, { ...over, slot: 'dinner', hour: 19 }),
  ];
}

describe('nutritionCounts', () => {
  it('reads the last week out of a month of rows without reloading them', () => {
    // Stats keeps a month loaded and narrows it (#2916). A day outside the
    // week has to drop out of every figure, not just the day count.
    const week = lastDaysOf(WINDOW, 7);
    const rows = [...fullDay('2026-08-20'), ...fullDay('2026-09-08')];
    expect(nutritionCounts(rows, week)).toMatchObject({ days: 7, daysLogged: 1, entries: 2 });
    expect(nutritionCounts(rows, WINDOW)).toMatchObject({ days: 30, daysLogged: 2, entries: 4 });
    expect(nutrientAverages(rows, week).find(r => r.key === 'calorieKcal')?.days).toBe(1);
    expect(mostLoggedFoods(rows, week, 5)[0]?.count).toBe(2);
  });

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

  it('does not count the day\'s water as a second meal', () => {
    const counts = nutritionCounts([entry('2026-09-09'), water('2026-09-09')], WINDOW);
    expect(counts.daysComplete).toBe(0);
    expect(counts.entries).toBe(2);
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

  it('averages water over finished days without letting it finish a day', () => {
    const rows = nutrientAverages(
      [
        ...fullDay('2026-09-08'), water('2026-09-08', 2000),
        entry('2026-09-09', { amounts: { calorieKcal: 5 } }), water('2026-09-09'),
      ],
      WINDOW,
    );
    expect(rows.find(r => r.key === 'calorieKcal')).toMatchObject({ days: 1, average: 600 });
    expect(rows.find(r => r.key === 'waterMl')).toMatchObject({ days: 1, average: 2000 });
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

  it('counts a nutrient for a day only when every food entry that day stated it', () => {
    // Breakfast is a scanned cereal stating 3 g of fibre; lunch and dinner
    // state none. Summing what was stated made that 3 g the day's fibre, and
    // since every day had one such entry the "across N days" clause never
    // appeared. The rule is foodDayInputs' coverage rule.
    const partial = (dayKey: string) => [
      entry(dayKey, { slot: 'breakfast', hour: 8, amounts: { calorieKcal: 300, fiberG: 3 } }),
      entry(dayKey, { slot: 'lunch', hour: 12, amounts: { calorieKcal: 500 } }),
      entry(dayKey, { slot: 'dinner', hour: 19, amounts: { calorieKcal: 700 } }),
    ];
    const rows = nutrientAverages(
      [
        ...partial('2026-09-07'),
        ...partial('2026-09-08'),
        ...fullDay('2026-09-09', { amounts: { calorieKcal: 400, fiberG: 5 } }),
      ],
      WINDOW,
    );
    expect(rows.find(r => r.key === 'calorieKcal')).toMatchObject({ days: 3 });
    expect(rows.find(r => r.key === 'fiberG')).toEqual({ key: 'fiberG', total: 10, days: 1, average: 10 });
  });

  it('gives no row to a nutrient no day stated throughout', () => {
    const rows = nutrientAverages(
      [
        entry('2026-09-08', { slot: 'breakfast', hour: 8, amounts: { calorieKcal: 300, fiberG: 3 } }),
        entry('2026-09-08', { slot: 'dinner', hour: 19, amounts: { calorieKcal: 700 } }),
      ],
      WINDOW,
    );
    expect(rows.some(r => r.key === 'fiberG')).toBe(false);
    expect(rows.find(r => r.key === 'calorieKcal')).toMatchObject({ days: 1, average: 1000 });
  });

  it('keeps the day\'s water out of the other nutrients\' coverage', () => {
    // The water entry states nothing but water: counted as a food it would
    // veto calories on every day somebody drank anything.
    const rows = nutrientAverages(
      [...fullDay('2026-09-08'), water('2026-09-08', 1800)],
      WINDOW,
    );
    expect(rows.find(r => r.key === 'calorieKcal')).toMatchObject({ days: 1, average: 600 });
    expect(rows.find(r => r.key === 'proteinG')).toMatchObject({ days: 1, average: 20 });
    expect(rows.find(r => r.key === 'waterMl')).toMatchObject({ days: 1, average: 1800 });
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

  it('leaves the day\'s water off the list', () => {
    // A running total, not a food; logged daily it topped the list.
    const rows = mostLoggedFoods(
      [water('2026-09-07'), water('2026-09-08'), water('2026-09-09'), entry('2026-09-09', { label: 'Toast' })],
      WINDOW,
    );
    expect(rows.map(r => r.label)).toEqual(['Toast']);
  });

  it('counts "Coffee" and "coffee" as one food, named as it was last typed', () => {
    const rows = mostLoggedFoods(
      [entry('2026-09-08', { label: 'Coffee' }), entry('2026-09-09', { label: 'coffee' })],
      WINDOW,
    );
    expect(rows).toEqual([expect.objectContaining({ label: 'coffee', count: 2 })]);
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

describe('sourceMix, water', () => {
  it('leaves the day\'s water out of where the figures came from', () => {
    const mix = sourceMix([water('2026-09-08'), entry('2026-09-08', { source: 'fdc' })], WINDOW);
    expect(mix.database).toBe(1);
    expect(mix.manual).toBe(0);
  });
});

describe('nutritionCounts, the averaged days', () => {
  it('counts the complete days the averages draw from, which stop at yesterday', () => {
    // Today's complete day is complete but not averaged, so a nutrient every
    // finished day stated no longer reads as "across fewer days".
    const counts = nutritionCounts([...fullDay('2026-09-08'), ...fullDay('2026-09-10')], WINDOW);
    expect(counts.daysComplete).toBe(2);
    expect(counts.daysAveraged).toBe(1);
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
  it('has nothing to say about a record of only water', () => {
    // It used to open the Eating card on "Days you logged 0 of 30".
    expect(hasNutritionData(nutritionCounts([water('2026-09-08'), water('2026-09-09')], WINDOW))).toBe(false);
  });

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

  it('leaves the day\'s water out: not a meal, not a food, and no veto on the rest', () => {
    // Water states nothing but water, so under the every-entry coverage rule
    // it used to erase every other nutrient from the day.
    const [row] = foodDayInputs([...fullDay('2026-09-08'), water('2026-09-08')]);
    expect(row.nutrients).toEqual({ calorieKcal: 600, proteinG: 20 });
    expect(row.labels).toEqual(['porridge']);
    // And breakfast plus a glass of water is still breakfast alone.
    expect(foodDayInputs([entry('2026-09-08'), water('2026-09-08')])).toEqual([]);
  });

  it('adds a nutrient a task logged on its own to the day total, without making it a meal', () => {
    // `entry` reads a null slot as the default one, so the slot is cleared after.
    const sodium = (dayKey: string, mg: number): FoodLogEntry => ({
      ...entry(dayKey, { label: 'Sodium', amounts: { sodiumMg: mg }, hour: 12 }),
      slot: null,
    });
    const meals = fullDay('2026-09-08', { amounts: { calorieKcal: 300, sodiumMg: 400 } });
    const [row] = foodDayInputs([...meals, sodium('2026-09-08', 500)]);
    expect(row.nutrients.sodiumMg).toBe(1300);
    expect(row.nutrients.calorieKcal).toBe(600);
    expect(row.labels).toEqual(['porridge']);
    // Not a second meal: breakfast plus a supplement is still breakfast alone.
    expect(foodDayInputs([entry('2026-09-08'), sodium('2026-09-08', 500)])).toEqual([]);
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

describe('foodKeyResolver', () => {
  it('keys a linked entry by the row it points at, and a box by its item', () => {
    // The picker offers "Bread" and "Bread, Dave's Killer 21 grain" as two
    // rows. Both are bread, and a symptom page that split them compared bread
    // days against bread days (#2947).
    const plain = entry('2026-09-01', { label: 'Bread', itemId: 'bread' });
    const branded = entry('2026-09-02', { label: "Bread, Dave's Killer 21 grain", itemId: 'bread', productId: 'dk' });
    const keyOf = foodKeyResolver([plain, branded]);
    expect(keyOf(plain)).toBe('item:bread');
    expect(keyOf(branded)).toBe('item:bread');
  });

  it('keys a dish by its recipe, so renaming it does not split it', () => {
    const before = entry('2026-09-01', { label: 'Chili', recipeId: 'r1' });
    const after = entry('2026-09-08', { label: 'Weeknight chili', recipeId: 'r1' });
    const keyOf = foodKeyResolver([before, after]);
    expect(keyOf(before)).toBe(keyOf(after));
  });

  it('keys an unlinked entry by its lowercased label, as it always did', () => {
    const typed = entry('2026-09-01', { label: '  Porridge ' });
    expect(foodKeyResolver([typed])(typed)).toBe('porridge');
  });

  it('counts a hand-typed label as the row a linked entry was logged under by that name', () => {
    // Keying linked entries by id must not split "bread" typed by hand from
    // the Bread row it was always counted with when everything keyed by label.
    const linked = entry('2026-09-01', { label: 'Bread', itemId: 'bread' });
    const typed = entry('2026-09-02', { label: 'bread' });
    expect(foodKeyResolver([linked, typed])(typed)).toBe('item:bread');
  });

  it('leaves a label alone when linked entries use it for two different rows', () => {
    const recipe = entry('2026-09-01', { label: 'Chili', recipeId: 'r1' });
    const item = entry('2026-09-02', { label: 'Chili', itemId: 'chili-flakes' });
    const typed = entry('2026-09-03', { label: 'chili' });
    expect(foodKeyResolver([recipe, item, typed])(typed)).toBe('chili');
  });
});

describe('foodKeyNames', () => {
  it('names a row or recipe by its current name, and anything else as it was typed', () => {
    const rows = [
      entry('2026-09-01', { label: "Bread, Dave's Killer 21 grain", itemId: 'bread', productId: 'dk', hour: 9 }),
      entry('2026-09-02', { label: 'Old name', recipeId: 'r1' }),
      entry('2026-09-03', { label: 'Porridge' }),
    ];
    const names = foodKeyNames(rows, {
      items: new Map([['bread', 'Bread']]),
      recipes: new Map([['r1', 'Weeknight chili']]),
    });
    expect(names.get('item:bread')).toBe('Bread');
    expect(names.get('recipe:r1')).toBe('Weeknight chili');
    expect(names.get('porridge')).toBe('Porridge');
  });

  it('falls back to the label most recently logged for a row that has since gone', () => {
    const rows = [
      entry('2026-09-01', { label: 'Sourdough', itemId: 'gone' }),
      entry('2026-09-05', { label: 'Sourdough loaf', itemId: 'gone' }),
    ];
    expect(foodKeyNames(rows).get('item:gone')).toBe('Sourdough loaf');
  });
});

describe('foodDayInputs food keys', () => {
  it('puts a branded day in the food\'s own group, not its "without" group', () => {
    // The issue's own case: fifteen bread days, ten logged as the item and
    // five as a box of it. Every one of them has to say bread.
    const rows: FoodLogEntry[] = [];
    for (let d = 1; d <= 15; d += 1) {
      const dayKey = `2026-08-${String(d + 10).padStart(2, '0')}`;
      const bread = d <= 10
        ? entry(dayKey, { label: 'Bread', itemId: 'bread', slot: 'breakfast' })
        : entry(dayKey, { label: "Bread, Dave's Killer 21 grain", itemId: 'bread', productId: 'dk', slot: 'breakfast' });
      rows.push(bread, entry(dayKey, { label: 'Soup', slot: 'dinner', hour: 19 }));
    }
    const days = foodDayInputs(rows);
    expect(days).toHaveLength(15);
    expect(days.every(day => day.labels.includes('item:bread'))).toBe(true);
  });
});

describe('mostLoggedFoods by food', () => {
  it('counts an item and its boxes as one food, named by the item', () => {
    const rows = [
      entry('2026-09-01', { label: 'Bread', itemId: 'bread' }),
      entry('2026-09-02', { label: "Bread, Dave's Killer 21 grain", itemId: 'bread', productId: 'dk' }),
      entry('2026-09-03', { label: 'Porridge' }),
    ];
    const top = mostLoggedFoods(rows, WINDOW, 5, { items: new Map([['bread', 'Bread']]) });
    expect(top[0]).toMatchObject({ key: 'item:bread', label: 'Bread', count: 2 });
    expect(top[1]).toMatchObject({ key: 'porridge', label: 'Porridge', count: 1 });
  });
});

describe('produceAverage', () => {
  /** A complete day with some produce on it: 160 g of carrot and 80 g of apple. */
  function produceDay(dayKey: string, extra: FoodLogEntry[] = []): FoodLogEntry[] {
    return [
      { ...entry(dayKey, { label: 'Carrots', slot: 'lunch' }), grams: 160 },
      { ...entry(dayKey, { label: 'Apple', slot: 'snack' }), grams: 80 },
      ...extra,
    ];
  }

  it('averages complete, finished days, and leaves today out', () => {
    const entries = [...produceDay('2026-09-08'), ...produceDay('2026-09-09'), ...produceDay('2026-09-10')];
    expect(produceAverage(entries, WINDOW)).toEqual({ vegetable: 2, fruit: 1, days: 2, daysLeftOut: 0 });
  });

  it('is null when nothing qualifies, rather than an average of zero', () => {
    expect(produceAverage([], WINDOW)).toBeNull();
    // One meal is not a day.
    expect(produceAverage([entry('2026-09-08', { label: 'Carrots' })], WINDOW)).toBeNull();
  });

  it('leaves out a day with an entry it could not measure, and says so', () => {
    const unweighed = { ...entry('2026-09-08', { label: 'Broccoli', slot: 'dinner' }), grams: null };
    const entries = [...produceDay('2026-09-08', [unweighed]), ...produceDay('2026-09-09')];
    expect(produceAverage(entries, WINDOW)).toEqual({ vegetable: 2, fruit: 1, days: 1, daysLeftOut: 1 });
  });
});

describe('daysWithinLimits', () => {
  // fullDay is two entries, so a day's saturated fat is twice the per-entry figure.
  const sat = (g: number) => ({ amounts: { calorieKcal: 300, satFatG: g } });

  it('counts the measurable days at or under each limit', () => {
    const rows = daysWithinLimits(
      [...fullDay('2026-09-07', sat(4)), ...fullDay('2026-09-08', sat(8)), ...fullDay('2026-09-09', sat(12))],
      WINDOW,
      { satFatG: 16, proteinG: 100 },
      ['satFatG'],
    );
    expect(rows).toEqual([{ key: 'satFatG', within: 2, days: 3 }]);
  });

  it('leaves out today, an unfinished day, and a day an entry did not state it', () => {
    const rows = daysWithinLimits(
      [
        ...fullDay('2026-09-08', sat(4)),
        entry('2026-09-09', { slot: 'breakfast', amounts: { satFatG: 30 } }),
        entry('2026-09-09', { slot: 'dinner', amounts: { calorieKcal: 900 } }),
        ...fullDay('2026-09-10', sat(30)),
      ],
      WINDOW,
      { satFatG: 16 },
      ['satFatG'],
    );
    expect(rows).toEqual([{ key: 'satFatG', within: 1, days: 1 }]);
  });

  it('says nothing for a goal, or a limit with nothing measured', () => {
    expect(daysWithinLimits(fullDay('2026-09-08', sat(4)), WINDOW, { satFatG: 16 }, [])).toEqual([]);
    expect(daysWithinLimits(fullDay('2026-09-08'), WINDOW, { sugarG: 35 }, ['sugarG'])).toEqual([]);
  });
});
