import type { GroceryItem, MealPlanEntry, Recipe, RecipeIngredient } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import {
  collectPlannedIngredients,
  parseQuantityAmount,
  mergeQuantities,
  describeQuantities,
  classifyPlanned,
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
    servings: null,
    ingredients,
    favorite: false,
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
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
    ...overrides,
  };
}

function item(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  return {
    id: `gi-${++seq}`,
    nameKey: groceryNameKey(overrides.name),
    aisle: 'Other',
    quantity: null,
    note: '',
    onList: false,
    checked: false,
    inCatalog: true,
    sortOrder: seq,
    favorite: false,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    onHandUntil: null,
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
      { name: 'Onions', nameKey: 'onions', quantity: '2', aisle: null, source: 'Tue Ragù' },
      { name: 'Garlic', nameKey: 'garlic', quantity: '3 cloves', aisle: null, source: 'Tue Ragù' },
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

  it('carries the ingredient\'s own aisle hint through', () => {
    const ragu = recipe('Ragù', [ing('Basil', { aisle: 'Produce' })]);
    const recipesById = new Map([[ragu.id, ragu]]);
    const entries = [entry('2026-08-11', ragu.id)];
    expect(collectPlannedIngredients(entries, recipesById, RANGE)[0].aisle).toBe('Produce');
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

  it('refuses a fraction or mixed number rather than guess at summing it', () => {
    expect(parseQuantityAmount('1/2')).toBeNull();
    expect(parseQuantityAmount('1 1/2 cups')).toBeNull();
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
    expect(mergeQuantities(['1 lb', '2 lb'])).toBe('3 lb');
    expect(mergeQuantities(['2', '3', '1'])).toBe('6'); // empty unit counts as "the same"
  });

  it('never crosses units — it lists instead', () => {
    expect(mergeQuantities(['2', '1 bunch', '3'])).toBe('2 · 1 bunch · 3');
    expect(mergeQuantities(['1 lb', '2 kg'])).toBe('1 lb · 2 kg');
  });

  it('lists rather than sums the moment any one quantity does not parse', () => {
    expect(mergeQuantities(['2 lb', 'a pinch'])).toBe('2 lb · a pinch');
  });

  it('keeps a fractional sum to two places without float noise', () => {
    expect(mergeQuantities(['1.1 lb', '2.2 lb'])).toBe('3.3 lb');
  });
});

describe('describeQuantities', () => {
  it('is mergeQuantities\' answer when there is one', () => {
    expect(describeQuantities(['1 lb', '2 lb'])).toBe('3 lb');
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
      { nameKey: 'saffron', name: 'Saffron', aisle: null, quantity: '1 pinch', sources: ['Tue Paella'], category: 'needToBuy', reason: null },
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
