import type { GroceryItem, MealPlanEntry, Recipe, RecipeIngredient } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import {
  collectPlannedIngredients,
  plannedIngredientsForRecipe,
  parseQuantityAmount,
  mergeQuantities,
  describeQuantities,
  classifyPlanned,
  restockRows,
  consumedRows,
} from '../utils/mealPlanGroceries';

// mealPlanGroceries reaches mealPlan.ts for isKeyInRange, which reaches
// dateUtils for dayKeyOf, which reaches the settings store for dayResetTime —
// which nothing here needs, since a day key is a calendar day and carries no
// time at all. Same mock as mealPlan.test.ts.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;

function ing(name: string, overrides: Partial<RecipeIngredient> = {}): RecipeIngredient {
  return {
    id: `ing-${++seq}`,
    name,
    nameKey: groceryNameKey(name),
    quantity: '',
    aisle: null,
    prep: null,
    purpose: null,
    section: null,
    choiceGroup: null,
    ...overrides,
  };
}

function recipe(name: string, ingredients: RecipeIngredient[]): Recipe {
  return {
    id: `r-${++seq}`,
    name,
    nameKey: name.toLowerCase(),
    notes: '',
    sourceUrl: null,
    sourceName: null,
    author: null,
    source: null,
    servings: null,
    servingsMax: null,
    recipeYield: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients,
    components: [],
    prepTasks: [],
    favorite: false,
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    sourceType: null,
    sourcePage: null,
    prepMinutes: null,
    prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0,
    lastPrepMinutes: null,
    prepTimeCount: 0,
    totalPrepMinutes: 0,
  };
}

function entry(date: string, recipeId: string | null, overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: `m-${++seq}`,
    date,
    slot: 'dinner',
    recipeId,
    title: overrides.title ?? 'Leftovers',
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookedAt: null,
    leftoverId: null,
    recipeChoices: [],
    recipeScale: 1,
    cookTask: null,
    calendarEventId: null,
    ...overrides,
  };
}

function item(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  return {
    id: `gi-${++seq}`,
    nameKey: groceryNameKey(overrides.name),
    brand: null,
    aisle: 'Other',
    quantity: null,
    note: '',
    onList: false,
    checked: false,
    inCatalog: true,
    sortOrder: seq,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    onHandUntil: null,
    sourceRecipeId: null,
    sourceRecipeTitle: null,
    choiceGroup: null,
    isStaple: false,
    expiresAt: null,
    useUpTask: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    ...overrides,
  };
}

beforeEach(() => { seq = 0; });

// Wednesday 12 Aug 2026 — matches mealPlan.test.ts's describeAddedToList fixture.
const RANGE = { startKey: '2026-08-09', endKey: '2026-08-15' };

describe('collectPlannedIngredients', () => {
  it('flattens every entry\'s recipe ingredients, tagged with a day + dish source', () => {
    const ragu = recipe('Ragù', [ing('Onions', { quantity: '2' }), ing('Garlic', { quantity: '3 cloves' })]);
    const recipesById = new Map([[ragu.id, ragu]]);
    const entries = [entry('2026-08-11', ragu.id)]; // Tuesday

    const result = collectPlannedIngredients(entries, recipesById, RANGE);

    expect(result).toEqual([
      { name: 'Onions', nameKey: 'onions', quantity: '2', aisle: null, source: 'Tue Ragù', recipeId: ragu.id, recipeTitle: 'Ragù' },
      { name: 'Garlic', nameKey: 'garlic', quantity: '3 cloves', aisle: null, source: 'Tue Ragù', recipeId: ragu.id, recipeTitle: 'Ragù' },
    ]);
  });

  it('scales each entry by its own factor, leaving the others alone', () => {
    const ragu = recipe('Ragù', [ing('Onions', { quantity: '2' }), ing('Salt', { quantity: 'a pinch' })]);
    const recipesById = new Map([[ragu.id, ragu]]);
    const entries = [
      entry('2026-08-11', ragu.id, { recipeScale: 2 }),   // Tuesday, doubled
      entry('2026-08-13', ragu.id),                        // Thursday, as written
    ];

    const result = collectPlannedIngredients(entries, recipesById, RANGE);

    expect(result.map(r => [r.source, r.quantity])).toEqual([
      ['Tue Ragù', '4'],
      ['Tue Ragù', 'a pinch'], // rule 3: what can't be scaled passes through
      ['Thu Ragù', '2'],
      ['Thu Ragù', 'a pinch'],
    ]);
  });

  it('skips a free-text meal — it has no ingredient list', () => {
    const entries = [entry('2026-08-11', null, { title: 'Takeout' })];
    expect(collectPlannedIngredients(entries, new Map(), RANGE)).toEqual([]);
  });

  it('skips an entry whose recipe no longer resolves, rather than throwing', () => {
    const entries = [entry('2026-08-11', 'gone', { title: 'Whatever it was' })];
    expect(collectPlannedIngredients(entries, new Map(), RANGE)).toEqual([]);
  });

  it('re-filters by range rather than trusting the caller\'s entries are already scoped', () => {
    const ragu = recipe('Ragù', [ing('Onions')]);
    const recipesById = new Map([[ragu.id, ragu]]);
    const entries = [entry('2026-01-01', ragu.id)]; // well outside RANGE
    expect(collectPlannedIngredients(entries, recipesById, RANGE)).toEqual([]);
  });

  it('skips an entry already marked cooked', () => {
    const ragu = recipe('Ragù', [ing('Onions', { quantity: '2' })]);
    const recipesById = new Map([[ragu.id, ragu]]);
    const entries = [entry('2026-08-11', ragu.id, { cookedAt: '2026-08-11T18:00:00.000Z' })];
    expect(collectPlannedIngredients(entries, recipesById, RANGE)).toEqual([]);
  });

  it('carries the ingredient\'s own aisle hint through', () => {
    const ragu = recipe('Ragù', [ing('Basil', { aisle: 'Produce' })]);
    const recipesById = new Map([[ragu.id, ragu]]);
    const entries = [entry('2026-08-11', ragu.id)];
    expect(collectPlannedIngredients(entries, recipesById, RANGE)[0].aisle).toBe('Produce');
  });

  it('gives each night its own side when one recipe is planned twice', () => {
    const mash = recipe('Mash', [ing('Butter')]);
    const roast = recipe('Roast potatoes', [ing('Oil')]);
    const steak = recipe('Steak dinner', [ing('Steak')]);
    steak.components = [
      { id: 'c-mash', recipeId: mash.id, name: 'Mash', choiceGroup: 'Side' },
      { id: 'c-roast', recipeId: roast.id, name: 'Roast potatoes', choiceGroup: 'Side' },
    ];
    const recipesById = new Map([[steak.id, steak], [mash.id, mash], [roast.id, roast]]);
    const entries = [
      entry('2026-08-11', steak.id), // Tuesday, no pick — the default
      entry('2026-08-14', steak.id, { recipeChoices: ['c-roast'] }), // Friday, roast
    ];

    const result = collectPlannedIngredients(entries, recipesById, RANGE);

    expect(result.map(r => [r.name, r.source])).toEqual([
      ['Steak', 'Tue Steak dinner'],
      ['Butter', 'Tue Mash'],
      ['Steak', 'Fri Steak dinner'],
      ['Oil', 'Fri Roast potatoes'],
    ]);
  });

  it('brings a component\'s ingredients along, sourced to the part that wants them', () => {
    const mash = recipe('Mash', [ing('Potatoes', { quantity: '1 kg' })]);
    const steak = recipe('Steak with mash', [ing('Steak', { quantity: '2' })]);
    steak.components = [{ id: 'c1', recipeId: mash.id, name: 'Mash', choiceGroup: null }];
    const recipesById = new Map([[steak.id, steak], [mash.id, mash]]);
    const entries = [entry('2026-08-11', steak.id)]; // Tuesday

    const result = collectPlannedIngredients(entries, recipesById, RANGE);

    expect(result.map(r => [r.name, r.source, r.recipeTitle])).toEqual([
      ['Steak', 'Tue Steak with mash', 'Steak with mash'],
      ['Potatoes', 'Tue Mash', 'Mash'],
    ]);
  });
});

describe('plannedIngredientsForRecipe', () => {
  it('maps each ingredient, tagged with the recipe as its own source', () => {
    const ragu = recipe('Ragù', [ing('Onions', { quantity: '2' }), ing('Garlic', { quantity: '3 cloves' })]);
    expect(plannedIngredientsForRecipe(ragu)).toEqual([
      { name: 'Onions', nameKey: 'onions', quantity: '2', aisle: null, source: 'Ragù', recipeId: ragu.id, recipeTitle: 'Ragù' },
      { name: 'Garlic', nameKey: 'garlic', quantity: '3 cloves', aisle: null, source: 'Ragù', recipeId: ragu.id, recipeTitle: 'Ragù' },
    ]);
  });

  it('scales every quantity by the factor it is given', () => {
    const ragu = recipe('Ragù', [ing('Onions', { quantity: '2' }), ing('Garlic', { quantity: '3 cloves' })]);
    expect(plannedIngredientsForRecipe(ragu, undefined, undefined, 2).map(p => p.quantity))
      .toEqual(['4', '6 cloves']);
    expect(plannedIngredientsForRecipe(ragu, undefined, undefined, 0.5).map(p => p.quantity))
      .toEqual(['1', '1 1/2 cloves']);
  });

  it('scales the quantity but not the prep clause riding with it', () => {
    const ragu = recipe('Ragù', [ing('Ginger', { quantity: '1 tsp', prep: 'minced' })]);
    expect(plannedIngredientsForRecipe(ragu, undefined, undefined, 2)[0].quantity)
      .toBe('2 tsp, minced');
  });

  it('scales a component\'s lines with the parent\'s factor', () => {
    const mash = recipe('Mash', [ing('Potatoes', { quantity: '1 kg' })]);
    const steak = recipe('Steak with mash', [ing('Steak', { quantity: '2' })]);
    steak.components = [{ id: 'c1', recipeId: mash.id, name: 'Mash', choiceGroup: null }];
    const recipesById = new Map([[steak.id, steak], [mash.id, mash]]);
    expect(plannedIngredientsForRecipe(steak, recipesById, undefined, 2).map(p => p.quantity))
      .toEqual(['4', '2 kg']);
  });

  it('is unchanged at a factor of 1, and treats a junk factor as 1', () => {
    const ragu = recipe('Ragù', [ing('Onions', { quantity: '2' })]);
    for (const factor of [1, 0, -1, NaN]) {
      expect(plannedIngredientsForRecipe(ragu, undefined, undefined, factor)[0].quantity).toBe('2');
    }
  });

  it('folds prep into the quantity, same as RecipeDetailScreen\'s own add', () => {
    const ragu = recipe('Ragù', [ing('Ginger', { quantity: '1 tsp', prep: 'minced' })]);
    expect(plannedIngredientsForRecipe(ragu)[0].quantity).toBe('1 tsp, minced');
  });

  it('folds purpose into the quantity as a "for" clause', () => {
    const ragu = recipe('Margarita night', [ing('Limes', { quantity: '6', purpose: 'margaritas' })]);
    expect(plannedIngredientsForRecipe(ragu)[0].quantity).toBe('6, for margaritas');
  });

  it('folds both prep and purpose into the quantity, prep first', () => {
    const ragu = recipe('Ragù', [ing('Flour', { quantity: '2 cups', prep: 'sifted', purpose: 'dusting' })]);
    expect(plannedIngredientsForRecipe(ragu)[0].quantity).toBe('2 cups, sifted, for dusting');
  });

  it('carries the aisle hint through', () => {
    const ragu = recipe('Ragù', [ing('Basil', { aisle: 'Produce' })]);
    expect(plannedIngredientsForRecipe(ragu)[0].aisle).toBe('Produce');
  });

  it('flattens a sectioned recipe — the section label does not carry over', () => {
    const cake = recipe('Layer Cake', [
      ing('Flour', { quantity: '2 cups', section: 'For the cake' }),
      ing('Butter', { quantity: '1 cup', section: 'For the frosting' }),
    ]);
    const planned = plannedIngredientsForRecipe(cake);
    expect(planned).toEqual([
      { name: 'Flour', nameKey: 'flour', quantity: '2 cups', aisle: null, source: 'Layer Cake', recipeId: cake.id, recipeTitle: 'Layer Cake' },
      { name: 'Butter', nameKey: 'butter', quantity: '1 cup', aisle: null, source: 'Layer Cake', recipeId: cake.id, recipeTitle: 'Layer Cake' },
    ]);
    expect(planned.some(p => 'section' in p)).toBe(false);
  });

  it('is empty for a recipe with no ingredients', () => {
    expect(plannedIngredientsForRecipe(recipe('Toast', []))).toEqual([]);
  });

  it('includes a component\'s ingredients, each sourced to the recipe it\'s written on', () => {
    const mash = recipe('Mash', [ing('Potatoes'), ing('Butter', { quantity: '50 g' })]);
    const steak = recipe('Steak with mash', [ing('Steak')]);
    steak.components = [{ id: 'c1', recipeId: mash.id, name: 'Mash', choiceGroup: null }];

    const result = plannedIngredientsForRecipe(steak, new Map([[steak.id, steak], [mash.id, mash]]));

    expect(result.map(r => [r.name, r.source])).toEqual([
      ['Steak', 'Steak with mash'],
      ['Potatoes', 'Mash'],
      ['Butter', 'Mash'],
    ]);
    expect(result[2].recipeId).toBe(mash.id);
  });

  it('shops for the alternative this meal picked, not both', () => {
    const mash = recipe('Mash', [ing('Potatoes'), ing('Butter')]);
    const roast = recipe('Roast potatoes', [ing('Potatoes'), ing('Oil')]);
    const steak = recipe('Steak dinner', [ing('Steak')]);
    steak.components = [
      { id: 'c-mash', recipeId: mash.id, name: 'Mash', choiceGroup: 'Side' },
      { id: 'c-roast', recipeId: roast.id, name: 'Roast potatoes', choiceGroup: 'Side' },
    ];
    const recipesById = new Map([[steak.id, steak], [mash.id, mash], [roast.id, roast]]);

    const onDefault = plannedIngredientsForRecipe(steak, recipesById);
    expect(onDefault.map(r => r.name)).toEqual(['Steak', 'Potatoes', 'Butter']);

    const onRoast = plannedIngredientsForRecipe(steak, recipesById, { chosen: ['c-roast'] });
    expect(onRoast.map(r => r.name)).toEqual(['Steak', 'Potatoes', 'Oil']);
  });

  it('stands for itself when the caller has no library to resolve against', () => {
    const steak = recipe('Steak with mash', [ing('Steak')]);
    steak.components = [{ id: 'c1', recipeId: 'r-mash', name: 'Mash', choiceGroup: null }];

    expect(plannedIngredientsForRecipe(steak).map(r => r.name)).toEqual(['Steak']);
  });
});

describe('parseQuantityAmount', () => {
  it('parses a number and a unit word', () => {
    expect(parseQuantityAmount('2 lb')).toEqual({ amount: 2, unit: 'lb' });
    expect(parseQuantityAmount('1.5kg')).toEqual({ amount: 1.5, unit: 'kg' });
  });

  it('parses a bare number as an empty unit', () => {
    expect(parseQuantityAmount('3')).toEqual({ amount: 3, unit: '' });
  });

  // These used to be refused, on the grounds that summing fractions with
  // unlike denominators was arithmetic this module shouldn't be doing. Recipe
  // scaling settled that by making the arithmetic exact (recipeScale's
  // rationals) — and made refusing untenable, since a halved recipe *produces*
  // fractions and every merged row would otherwise degrade to rule 5's list.
  it('parses a fraction and a mixed number, summing them exactly', () => {
    expect(parseQuantityAmount('1/2')).toEqual({ amount: 0.5, unit: '' });
    expect(parseQuantityAmount('1 1/2 cups')).toEqual({ amount: 1.5, unit: 'cups' });
    expect(mergeQuantities(['1/2 cup', '1/4 cup'])).toBe('3/4 cup');
    expect(mergeQuantities(['1 1/2 cups', '1/2 cup'])).toBe('2 cups');
    expect(mergeQuantities(['1/3 cup', '1/3 cup', '1/3 cup'])).toBe('1 cup');
  });

  it('still refuses anything that is not a whole amount-plus-unit string', () => {
    expect(parseQuantityAmount('2 14 oz cans')).toBeNull();
    expect(parseQuantityAmount('1 cup, packed')).toBeNull();
  });

  it('refuses empty input and anything that is not a leading number', () => {
    expect(parseQuantityAmount('')).toBeNull();
    expect(parseQuantityAmount('a bunch')).toBeNull();
    expect(parseQuantityAmount('x2')).toBeNull();
  });
});

describe('mergeQuantities', () => {
  it('drops blanks and returns empty when nothing is left', () => {
    expect(mergeQuantities(['', '  '])).toBe('');
    expect(mergeQuantities([])).toBe('');
  });

  it('returns the one remaining quantity verbatim', () => {
    expect(mergeQuantities(['', '2 lb'])).toBe('2 lb');
  });

  it('sums same-unit quantities rather than concatenating them', () => {
    // "3 lbs", not "3 lb": the unit agrees with the total it sits next to, now
    // that merging and scaling share one pluralization table (recipeScale).
    expect(mergeQuantities(['1 lb', '2 lb'])).toBe('3 lbs');
    expect(mergeQuantities(['2', '3', '1'])).toBe('6'); // empty unit counts as "the same"
  });

  it('sums across singular and plural spellings of one unit', () => {
    // The form scaling itself produces — a halved "1 cup" is "1/2 cup" while
    // the recipe next door still says "2 cups". Same unit, so it sums.
    expect(mergeQuantities(['1/2 cup', '2 cups'])).toBe('2 1/2 cups');
    expect(mergeQuantities(['1 clove', '3 cloves'])).toBe('4 cloves');
  });

  it('still never collapses two units that merely measure alike', () => {
    // Doing so would be a unit conversion, which nothing here claims to do.
    expect(mergeQuantities(['500 g', '1 grams'])).toBe('500 g · 1 grams');
  });

  it('never crosses units — it lists instead', () => {
    expect(mergeQuantities(['2', '1 bunch', '3'])).toBe('2 · 1 bunch · 3');
    expect(mergeQuantities(['1 lb', '2 kg'])).toBe('1 lb · 2 kg');
  });

  it('lists rather than sums the moment any one quantity does not parse', () => {
    expect(mergeQuantities(['2 lb', 'a pinch'])).toBe('2 lb · a pinch');
  });

  it('keeps a fractional sum to two places without float noise', () => {
    expect(mergeQuantities(['1.1 lb', '2.2 lb'])).toBe('3.3 lbs');
  });
});

describe('describeQuantities', () => {
  it('is mergeQuantities\' answer when there is one', () => {
    expect(describeQuantities(['1 lb', '2 lb'])).toBe('3 lbs');
  });

  it('falls back to a source count when every quantity is blank', () => {
    expect(describeQuantities(['', ''])).toBe('×2');
  });

  it('is empty for a single blank quantity — nothing to count', () => {
    expect(describeQuantities([''])).toBe('');
  });
});

describe('classifyPlanned', () => {
  const now = new Date(2026, 7, 12);

  it('classifies a name with no catalog row as needToBuy', () => {
    const planned = [{ name: 'Saffron', nameKey: 'saffron', quantity: '1 pinch', aisle: null, source: 'Tue Paella' }];
    const rows = classifyPlanned(planned, [], now);
    expect(rows).toEqual([
      { nameKey: 'saffron', name: 'Saffron', aisle: null, quantity: '1 pinch', sources: ['Tue Paella'], category: 'needToBuy', known: false, reason: null, sourceRecipeId: null, sourceRecipeTitle: null },
    ]);
  });

  it('classifies a known, off-list row as probablyHave when the pantry guess says so, with its reason', () => {
    const items = [item({
      name: 'Milk', onList: false, purchaseCount: 3,
      createdAt: new Date(2026, 4, 14).toISOString(), // 90 days before `now`
      lastPurchasedAt: new Date(2026, 7, 2).toISOString(), // 10 days before `now`
    })];
    const planned = [{ name: 'Milk', nameKey: 'milk', quantity: '', aisle: null, source: 'Thu Cereal' }];
    const row = classifyPlanned(planned, items, now)[0];
    expect(row.category).toBe('probablyHave');
    expect(row.reason).toBe('bought 3× · last on 2 Aug');
  });

  it('classifies a known catalog row that is off the list as needToBuy, not probablyHave', () => {
    const items = [item({ name: 'Flour', onList: false, inCatalog: true })];
    const planned = [{ name: 'Flour', nameKey: 'flour', quantity: '', aisle: null, source: 'Wed Bread' }];
    expect(classifyPlanned(planned, items, now)[0].category).toBe('needToBuy');
  });

  it('classifies a staple, off the list, as staple — with no purchase history needed', () => {
    const items = [item({ name: 'Salt', onList: false, isStaple: true, purchaseCount: 0 })];
    const planned = [{ name: 'Salt', nameKey: 'salt', quantity: '', aisle: null, source: 'Tue Ragù' }];
    expect(classifyPlanned(planned, items, now)[0].category).toBe('staple');
  });

  it('a staple still wins over the pantry guess', () => {
    const items = [item({
      name: 'Salt', onList: false, isStaple: true, purchaseCount: 3,
      createdAt: new Date(2026, 4, 14).toISOString(),
      lastPurchasedAt: new Date(2026, 7, 2).toISOString(),
    })];
    const planned = [{ name: 'Salt', nameKey: 'salt', quantity: '', aisle: null, source: 'Tue Ragù' }];
    expect(classifyPlanned(planned, items, now)[0].category).toBe('staple');
  });

  it('an on-list staple still classifies by list state, not as a staple', () => {
    const items = [item({ name: 'Salt', onList: true, checked: false, isStaple: true })];
    const planned = [{ name: 'Salt', nameKey: 'salt', quantity: '', aisle: null, source: 'Tue Ragù' }];
    expect(classifyPlanned(planned, items, now)[0].category).toBe('alreadyOnList');
  });

  it('classifies an unchecked on-list row as alreadyOnList', () => {
    const items = [item({ name: 'Milk', onList: true, checked: false })];
    const planned = [{ name: 'Milk', nameKey: 'milk', quantity: '1 gal', aisle: null, source: 'Thu Cereal' }];
    expect(classifyPlanned(planned, items, now)[0].category).toBe('alreadyOnList');
  });

  it('classifies a checked on-list row as inTrolley', () => {
    const items = [item({ name: 'Eggs', onList: true, checked: true })];
    const planned = [{ name: 'Eggs', nameKey: 'eggs', quantity: '12', aisle: null, source: 'Fri Omelette' }];
    expect(classifyPlanned(planned, items, now)[0].category).toBe('inTrolley');
  });

  it('marks a row with a catalog row known, and one without unknown', () => {
    const items = [item({ name: 'Flour', onList: false, inCatalog: true })];
    const planned = [
      { name: 'Flour', nameKey: 'flour', quantity: '', aisle: null, source: 'Wed Bread' },
      { name: 'Saffron', nameKey: 'saffron', quantity: '', aisle: null, source: 'Wed Bread' },
    ];
    const rows = classifyPlanned(planned, items, now);
    expect(rows.find(r => r.nameKey === 'flour')!.known).toBe(true);
    expect(rows.find(r => r.nameKey === 'saffron')!.known).toBe(false);
  });

  it('groups every source sharing a key into one row, merging quantities and collecting sources', () => {
    const planned = [
      { name: 'Onions', nameKey: 'onions', quantity: '2', aisle: null, source: 'Tue Ragù' },
      { name: 'onions', nameKey: 'onions', quantity: '1 bunch', aisle: null, source: 'Thu Curry' },
      { name: 'Onions', nameKey: 'onions', quantity: '3', aisle: null, source: 'Sat Soup' },
    ];
    const rows = classifyPlanned(planned, [], now);
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe('2 · 1 bunch · 3');
    expect(rows[0].sources).toEqual(['Tue Ragù', 'Thu Curry', 'Sat Soup']);
  });

  it('credits a single-recipe row with its recipe', () => {
    const planned = [
      { name: 'Saffron', nameKey: 'saffron', quantity: '1 pinch', aisle: null, source: 'Tue Paella', recipeId: 'r1', recipeTitle: 'Paella' },
    ];
    const row = classifyPlanned(planned, [], now)[0];
    expect(row.sourceRecipeId).toBe('r1');
    expect(row.sourceRecipeTitle).toBe('Paella');
  });

  it('leaves a row uncredited once it merges ingredients from more than one recipe', () => {
    const planned = [
      { name: 'Onions', nameKey: 'onions', quantity: '2', aisle: null, source: 'Tue Ragù', recipeId: 'r1', recipeTitle: 'Ragù' },
      { name: 'Onions', nameKey: 'onions', quantity: '1', aisle: null, source: 'Thu Curry', recipeId: 'r2', recipeTitle: 'Curry' },
    ];
    const row = classifyPlanned(planned, [], now)[0];
    expect(row.sourceRecipeId).toBeNull();
    expect(row.sourceRecipeTitle).toBeNull();
  });

  it('prefers the live catalog row\'s own name over any source spelling', () => {
    const items = [item({ name: 'Yellow Onions', onList: true })];
    const planned = [
      { name: 'onions', nameKey: 'yellow onions', quantity: '', aisle: null, source: 'Tue Ragù' },
    ];
    // Force the nameKey to line up with the catalog row for this test.
    const withKey = [{ ...planned[0], nameKey: items[0].nameKey }];
    expect(classifyPlanned(withKey, items, now)[0].name).toBe('Yellow Onions');
  });

  it('falls back to the shortest source name when nothing is in the catalog', () => {
    const planned = [
      { name: 'Onion', nameKey: 'onion', quantity: '', aisle: null, source: 'Tue Ragù' },
      { name: 'Onions, diced', nameKey: 'onion', quantity: '', aisle: null, source: 'Thu Curry' },
    ];
    expect(classifyPlanned(planned, [], now)[0].name).toBe('Onion');
  });

  it('carries an aisle hint from any source that has one', () => {
    const planned = [
      { name: 'Basil', nameKey: 'basil', quantity: '', aisle: null, source: 'Tue Ragù' },
      { name: 'Basil', nameKey: 'basil', quantity: '', aisle: 'Produce', source: 'Thu Curry' },
    ];
    expect(classifyPlanned(planned, [], now)[0].aisle).toBe('Produce');
  });

  it('shows a source count rather than an empty pill when every source left quantity blank', () => {
    const planned = [
      { name: 'Salt', nameKey: 'salt', quantity: '', aisle: null, source: 'Tue Ragù' },
      { name: 'Salt', nameKey: 'salt', quantity: '', aisle: null, source: 'Thu Curry' },
      { name: 'Salt', nameKey: 'salt', quantity: '', aisle: null, source: 'Sat Soup' },
    ];
    expect(classifyPlanned(planned, [], now)[0].quantity).toBe('×3');
  });
});

describe('restockRows', () => {
  const now = new Date(2026, 7, 12);

  const planned = (name: string) => ({
    name, nameKey: groceryNameKey(name), quantity: '', aisle: null, source: 'Tue Mash',
  });

  it('keeps a known item that is off the list', () => {
    const items = [item({ name: 'Yukon Gold potatoes', onList: false, inCatalog: true })];
    const rows = restockRows(classifyPlanned([planned('Yukon Gold potatoes')], items, now));
    expect(rows.map(r => r.name)).toEqual(['Yukon Gold potatoes']);
  });

  it('drops a name the app has never seen — the whole reason it exists', () => {
    // Every line of a dish cooked for the first time is needToBuy. Offering to
    // restock 1/4 tsp of black pepper on the strength of that is the bug.
    const rows = restockRows(classifyPlanned(
      [planned('ground black pepper'), planned('sea salt')],
      [],
      now
    ));
    expect(rows).toEqual([]);
  });

  it('drops anything already handled — on the list, in the trolley, a staple, or probably still around', () => {
    const items = [
      item({ name: 'Milk', onList: true, checked: false }),
      item({ name: 'Eggs', onList: true, checked: true }),
      item({ name: 'Salt', onList: false, isStaple: true }),
      item({
        name: 'Butter', onList: false, purchaseCount: 3,
        createdAt: new Date(2026, 4, 14).toISOString(),
        lastPurchasedAt: new Date(2026, 7, 2).toISOString(),
      }),
    ];
    const rows = restockRows(classifyPlanned(
      [planned('Milk'), planned('Eggs'), planned('Salt'), planned('Butter')],
      items,
      now
    ));
    expect(rows).toEqual([]);
  });

  it('names only the defensible lines out of a mixed recipe', () => {
    const items = [
      item({ name: 'Yukon Gold potatoes', onList: false, inCatalog: true }),
      item({ name: 'vegan butter', onList: false, inCatalog: true }),
      item({ name: 'sea salt', onList: false, isStaple: true }),
    ];
    const rows = restockRows(classifyPlanned(
      [planned('Yukon Gold potatoes'), planned('vegan butter'), planned('sea salt'), planned('garlic powder')],
      items,
      now
    ));
    expect(rows.map(r => r.name).sort()).toEqual(['Yukon Gold potatoes', 'vegan butter']);
  });
});

describe('consumedRows', () => {
  const now = new Date(2026, 7, 12);

  const planned = (name: string) => ({
    name, nameKey: groceryNameKey(name), quantity: '', aisle: null, source: 'Tue Chili',
  });

  /** Bought often enough, and recently enough, for the cadence guess to hold. */
  const stocked = (name: string) => item({
    name,
    onList: false,
    inCatalog: true,
    purchaseCount: 3,
    createdAt: new Date(2026, 4, 14).toISOString(),
    lastPurchasedAt: new Date(2026, 7, 2).toISOString(),
  });

  it('names what the app currently claims you have', () => {
    const rows = consumedRows(classifyPlanned([planned('Butter')], [stocked('Butter')], now));
    expect(rows.map(r => r.name)).toEqual(['Butter']);
  });

  it('carries probablyHaveReason so the sheet can say why it asked', () => {
    const rows = consumedRows(classifyPlanned([planned('Butter')], [stocked('Butter')], now));
    expect(rows[0].reason).toMatch(/bought 3×/);
  });

  it('takes an explicit "Got it" as readily as the cadence guess', () => {
    // A fortnight-old assertion is exactly the stale claim a cook should be
    // able to take back, so it's asked about like any other.
    const asserted = item({
      name: 'Soy sauce',
      onList: false,
      inCatalog: true,
      onHandUntil: new Date(2026, 7, 20).toISOString(),
    });
    const rows = consumedRows(classifyPlanned([planned('Soy sauce')], [asserted], now));
    expect(rows.map(r => r.name)).toEqual(['Soy sauce']);
  });

  it('drops a name the app has never seen — it can only take away a claim it made', () => {
    const rows = consumedRows(classifyPlanned([planned('gochujang')], [], now));
    expect(rows).toEqual([]);
  });

  it('drops a staple, which is a standing fact rather than a guess about this week', () => {
    const items = [item({ name: 'Salt', onList: false, isStaple: true })];
    expect(consumedRows(classifyPlanned([planned('Salt')], items, now))).toEqual([]);
  });

  it('drops anything already being restocked', () => {
    const items = [
      item({ name: 'Milk', onList: true, checked: false }),
      item({ name: 'Eggs', onList: true, checked: true }),
    ];
    const rows = consumedRows(classifyPlanned([planned('Milk'), planned('Eggs')], items, now));
    expect(rows).toEqual([]);
  });

  it('drops an item already marked out of — there is no claim left to take back', () => {
    const out = item({
      name: 'Butter',
      onList: false,
      inCatalog: true,
      purchaseCount: 3,
      createdAt: new Date(2026, 4, 14).toISOString(),
      lastPurchasedAt: new Date(2026, 7, 2).toISOString(),
      onHandUntil: new Date(0).toISOString(),
    });
    expect(consumedRows(classifyPlanned([planned('Butter')], [out], now))).toEqual([]);
  });

  it('is disjoint from restockRows, and the two cover every known line', () => {
    // The property the whole design leans on: answering here moves a row from
    // this set into that one, so the buy offer follows from the consumption
    // answer rather than being asked up front.
    const items = [stocked('Butter'), item({ name: 'Onions', onList: false, inCatalog: true })];
    const classified = classifyPlanned(
      [planned('Butter'), planned('Onions'), planned('gochujang')],
      items,
      now
    );
    const consumed = consumedRows(classified).map(r => r.nameKey);
    const restock = restockRows(classified).map(r => r.nameKey);

    expect(consumed).toEqual(['butter']);
    expect(restock).toEqual(['onions']);
    expect(consumed.filter(k => restock.includes(k))).toEqual([]);
    expect([...consumed, ...restock].sort()).toEqual(
      classified.filter(r => r.known).map(r => r.nameKey).sort()
    );
  });
});
