import type { GroceryItem, MealPlanEntry, Recipe, RecipeIngredient } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import { NO_STANDING_SWAPS, type StandingSwap, type StandingSwapMap } from '../utils/standingSwaps';
import {
  estimateRecipeCost,
  estimateWeekCost,
  describeRecipeCost,
  describeWeekCost,
  type CostEstimate,
} from '../utils/recipeCost';

// recipeCost reaches mealPlanGroceries for estimateWeekCost, which reaches
// mealPlan.ts for isKeyInRange, which reaches dateUtils for dayKeyOf, which
// reaches the settings store for dayResetTime — unneeded here, since a day
// key is a calendar day. Same mock as mealPlanGroceries.test.ts.
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

function recipe(name: string, ingredients: RecipeIngredient[], overrides: Partial<Recipe> = {}): Recipe {
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
    leftoverKeepDays: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients,
    emptySections: [],
    components: [],
    prepTasks: [],
    steps: [],
    favorite: false,
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
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
    ...overrides,
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
    personIds: [],
    recipeScale: 1,
    cookTask: null,
    shopTask: null,
    calendarEventId: null,
    ...overrides,
  };
}

function item(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  return {
    id: `gi-${++seq}`,
    nameKey: groceryNameKey(overrides.name),
    preferredProductId: null,
    productStrict: false,
    aisle: 'Other',
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    checked: false,
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
    shelfLifeDays: null,
    useUpTask: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  } as GroceryItem;
}

beforeEach(() => { seq = 0; });

const NOW = new Date('2026-08-18T00:00:00.000Z');

describe('estimateRecipeCost', () => {
  it('is null for a recipe with no ingredients', () => {
    const empty = recipe('Toast', []);
    expect(estimateRecipeCost(empty, [])).toBeNull();
  });

  it('is null when nothing on the line is priced', () => {
    const dish = recipe('Salad', [ing('Lettuce', { quantity: '1 head' })]);
    const catalog = [item({ name: 'Lettuce' })];
    expect(estimateRecipeCost(dish, catalog)).toBeNull();
  });

  it('declines below the coverage floor — the issue\'s own 3-of-9 example', () => {
    const dish = recipe('Big dish', [
      ing('Flour', { quantity: '1 lb' }),
      ing('Sugar', { quantity: '1 lb' }),
      ing('Butter', { quantity: '1 lb' }),
    ]);
    const catalog = [
      item({ name: 'Flour', lastPriceMinor: 200, lastPriceQuantity: '2 lb', lastPricedAt: NOW.toISOString() }),
    ];
    // 1 of 3 priced (33%) — below the 50% floor.
    expect(estimateRecipeCost(dish, catalog)).toBeNull();
  });

  it('answers once coverage clears the floor — the issue\'s own 6-of-9-style example', () => {
    const dish = recipe('Dinner', [
      ing('Flour', { quantity: '1 lb' }),
      ing('Sugar', { quantity: '1 lb' }),
      ing('Cinnamon', { quantity: '1 tsp' }),
    ]);
    const catalog = [
      item({ name: 'Flour', lastPriceMinor: 200, lastPriceQuantity: '2 lb', lastPricedAt: NOW.toISOString() }),
      item({ name: 'Sugar', lastPriceMinor: 300, lastPriceQuantity: '2 lb', lastPricedAt: NOW.toISOString() }),
    ];
    const estimate = estimateRecipeCost(dish, catalog);
    expect(estimate).not.toBeNull();
    expect(estimate).toMatchObject({ priced: 2, total: 3 });
    // Flour: 200 * (1/2) = 100. Sugar: 300 * (1/2) = 150. Total 250.
    expect(estimate!.totalMinor).toBe(250);
  });

  it('relates a line to a differently-sized purchase, exact fraction', () => {
    const dish = recipe('Bread', [ing('Flour', { quantity: '1 lb' })]);
    const catalog = [item({ name: 'Flour', lastPriceMinor: 200, lastPriceQuantity: '2 lb' })];
    const estimate = estimateRecipeCost(dish, catalog);
    expect(estimate!.totalMinor).toBe(100);
    expect(estimate!.priced).toBe(1);
    expect(estimate!.total).toBe(1);
  });

  it('relates across unit systems within the same dimension', () => {
    const dish = recipe('Bread', [ing('Flour', { quantity: '500 g' })]);
    const catalog = [item({ name: 'Flour', lastPriceMinor: 300, lastPriceQuantity: '1 kg' })];
    const estimate = estimateRecipeCost(dish, catalog);
    // 500g is half of 1kg.
    expect(estimate!.totalMinor).toBe(150);
  });

  it('relates matching counted units, never a bare count against a different word', () => {
    const dish = recipe('Ragù', [
      ing('Garlic', { quantity: '3 cloves' }),
      ing('Onions', { quantity: '2' }),
    ]);
    const catalog = [
      item({ name: 'Garlic', lastPriceMinor: 500, lastPriceQuantity: '10 cloves' }),
      // A bag is not a count of onions — refused, not guessed, so this line
      // stays uncovered even though the item itself is priced.
      item({ name: 'Onions', lastPriceMinor: 400, lastPriceQuantity: '1 bag' }),
    ];
    const estimate = estimateRecipeCost(dish, catalog);
    // Only the garlic line relates safely: 1 of 2 (50%, right at the floor).
    expect(estimate).toMatchObject({ priced: 1, total: 2 });
    expect(estimate!.totalMinor).toBe(150); // 500 * 3/10
  });

  it('refuses to relate two different dimensions', () => {
    const dish = recipe('Soup', [
      ing('Stock', { quantity: '2 cups' }),
      ing('Salt', { quantity: '1 tsp' }),
    ]);
    const catalog = [
      // Stock bought by the pound (mass); the recipe measures it by the cup
      // (volume) — genuinely different dimensions, refused rather than guessed.
      item({ name: 'Stock', lastPriceMinor: 500, lastPriceQuantity: '1 lb' }),
      item({ name: 'Salt', lastPriceMinor: 150, lastPriceQuantity: '1 lb' }),
    ];
    expect(estimateRecipeCost(dish, catalog)).toBeNull();
  });

  it('excludes a staple from both sides of the coverage fraction', () => {
    const dish = recipe('Dinner', [
      ing('Flour', { quantity: '1 lb' }),
      ing('Salt', { quantity: '1 tsp' }),
    ]);
    const catalog = [
      item({ name: 'Flour', lastPriceMinor: 200, lastPriceQuantity: '2 lb' }),
      // Priced, but a staple — must not count for or against coverage.
      item({ name: 'Salt', lastPriceMinor: 150, lastPriceQuantity: '1 lb', isStaple: true }),
    ];
    const estimate = estimateRecipeCost(dish, catalog);
    expect(estimate).toMatchObject({ priced: 1, total: 1 });
    expect(estimate!.totalMinor).toBe(100);
  });

  it('scales each line before costing it', () => {
    const dish = recipe('Bread', [ing('Flour', { quantity: '1 lb' })]);
    const catalog = [item({ name: 'Flour', lastPriceMinor: 200, lastPriceQuantity: '2 lb' })];
    const doubled = estimateRecipeCost(dish, catalog, undefined, undefined, 2);
    // Doubled to "2 lb", which is now the full purchase amount.
    expect(doubled!.totalMinor).toBe(200);
  });

  it('carries the oldest contributing price forward', () => {
    const dish = recipe('Dinner', [
      ing('Flour', { quantity: '1 lb' }),
      ing('Sugar', { quantity: '1 lb' }),
    ]);
    const catalog = [
      item({
        name: 'Flour', lastPriceMinor: 200, lastPriceQuantity: '2 lb', priceHistory: [],
        lastPricedAt: '2026-08-01T00:00:00.000Z',
      }),
      item({
        name: 'Sugar', lastPriceMinor: 300, lastPriceQuantity: '2 lb', priceHistory: [],
        lastPricedAt: '2026-03-01T00:00:00.000Z',
      }),
    ];
    const estimate = estimateRecipeCost(dish, catalog);
    expect(estimate!.oldestPricedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('includes a component\'s ingredients, priced through the same catalog', () => {
    const mash = recipe('Mash', [ing('Potatoes', { quantity: '1 lb' }), ing('Butter', { quantity: '1 tbsp' })]);
    const steak = recipe('Steak dinner', [ing('Steak', { quantity: '1 lb' })], {
      components: [{ id: 'c1', recipeId: mash.id, name: mash.name, choiceGroup: null }],
    });
    const recipesById = new Map([[steak.id, steak], [mash.id, mash]]);
    const catalog = [
      item({ name: 'Steak', lastPriceMinor: 1000, lastPriceQuantity: '2 lb' }),
      item({ name: 'Potatoes', lastPriceMinor: 500, lastPriceQuantity: '5 lb' }),
    ];
    const estimate = estimateRecipeCost(steak, catalog, recipesById);
    // 3 lines total (steak, potatoes, butter); 2 priced (steak, potatoes).
    expect(estimate).toMatchObject({ priced: 2, total: 3 });
    // Steak: 1000 * 1/2 = 500. Potatoes: 500 * 1/5 = 100. Total 600.
    expect(estimate!.totalMinor).toBe(600);
  });

  it('prices what a standing swap actually substitutes, not the recipe\'s own word', () => {
    const dish = recipe('Overnight oats', [ing('Milk', { quantity: '1 cup' })]);
    const milk = item({ name: 'Milk' });
    const oatMilk = item({ name: 'Oat milk', lastPriceMinor: 400, lastPriceQuantity: '2 cups' });
    const swap: StandingSwap = {
      link: {
        itemId: milk.id, subItemId: oatMilk.id, standing: true, note: null,
        ratioFrom: null, ratioTo: null, createdAt: '2026-01-01T00:00:00.000Z',
      },
      from: milk,
      to: oatMilk,
    };
    const swaps: StandingSwapMap = new Map([[milk.nameKey, swap]]);
    const estimate = estimateRecipeCost(dish, [milk, oatMilk], undefined, undefined, 1, swaps);
    // 1 cup of a 2-cup, 400c purchase = 200.
    expect(estimate!.totalMinor).toBe(200);
    expect(estimate!.priced).toBe(1);
  });
});

describe('estimateWeekCost', () => {
  const RANGE = { startKey: '2026-08-09', endKey: '2026-08-15' };

  it('is null when nothing in range resolves to a recipe', () => {
    const entries = [entry('2026-08-11', null)];
    expect(estimateWeekCost(entries, new Map(), [], RANGE)).toBeNull();
  });

  it('sums priced lines across the week\'s entries', () => {
    const soup = recipe('Soup', [ing('Stock', { quantity: '1 lb' })]);
    const bread = recipe('Bread', [ing('Flour', { quantity: '1 lb' })]);
    const recipesById = new Map([[soup.id, soup], [bread.id, bread]]);
    const entries = [
      entry('2026-08-10', soup.id),
      entry('2026-08-12', bread.id),
    ];
    const catalog = [
      item({ name: 'Stock', lastPriceMinor: 400, lastPriceQuantity: '2 lb' }),
      item({ name: 'Flour', lastPriceMinor: 200, lastPriceQuantity: '2 lb' }),
    ];
    const estimate = estimateWeekCost(entries, recipesById, catalog, RANGE);
    expect(estimate).toMatchObject({ priced: 2, total: 2 });
    expect(estimate!.totalMinor).toBe(300); // 200 + 100
  });

  it('applies each entry\'s own scale', () => {
    const soup = recipe('Soup', [ing('Stock', { quantity: '1 lb' })]);
    const recipesById = new Map([[soup.id, soup]]);
    const entries = [entry('2026-08-10', soup.id, { recipeScale: 2 })];
    const catalog = [item({ name: 'Stock', lastPriceMinor: 400, lastPriceQuantity: '2 lb' })];
    const estimate = estimateWeekCost(entries, recipesById, catalog, RANGE);
    expect(estimate!.totalMinor).toBe(400); // "2 lb" is the full purchase amount
  });

  it('excludes a cooked entry, same as collectPlannedIngredients', () => {
    const soup = recipe('Soup', [ing('Stock', { quantity: '1 lb' })]);
    const recipesById = new Map([[soup.id, soup]]);
    const entries = [entry('2026-08-10', soup.id, { cookedAt: '2026-08-10T00:00:00.000Z' })];
    const catalog = [item({ name: 'Stock', lastPriceMinor: 400, lastPriceQuantity: '2 lb' })];
    expect(estimateWeekCost(entries, recipesById, catalog, RANGE)).toBeNull();
  });

  it('declines below the coverage floor across the week', () => {
    const dish = recipe('Big dish', [
      ing('Flour', { quantity: '1 lb' }),
      ing('Sugar', { quantity: '1 lb' }),
      ing('Butter', { quantity: '1 lb' }),
    ]);
    const recipesById = new Map([[dish.id, dish]]);
    const entries = [entry('2026-08-10', dish.id)];
    const catalog = [item({ name: 'Flour', lastPriceMinor: 200, lastPriceQuantity: '2 lb' })];
    expect(estimateWeekCost(entries, recipesById, catalog, RANGE)).toBeNull();
  });
});

describe('describeRecipeCost / describeWeekCost', () => {
  it('is null for a null estimate', () => {
    expect(describeRecipeCost(null, '$', NOW)).toBeNull();
    expect(describeWeekCost(null, '$', NOW)).toBeNull();
  });

  it('renders full coverage with no fraction clause', () => {
    const estimate: CostEstimate = { totalMinor: 1400, priced: 3, total: 3, oldestPricedAt: null };
    expect(describeRecipeCost(estimate, '$', NOW)).toBe('≈ $14.00');
  });

  it('renders partial coverage with the ingredients fraction, recipe wording', () => {
    const estimate: CostEstimate = { totalMinor: 1400, priced: 6, total: 9, oldestPricedAt: null };
    expect(describeRecipeCost(estimate, '$', NOW)).toBe('≈ $14.00, from 6 of 9 ingredients');
  });

  it('renders partial coverage with the items fraction, week wording', () => {
    const estimate: CostEstimate = { totalMinor: 5800, priced: 13, total: 22, oldestPricedAt: null };
    expect(describeWeekCost(estimate, '$', NOW)).toBe('≈ $58.00, from 13 of 22 items');
  });

  it('appends the oldest price\'s age', () => {
    const estimate: CostEstimate = {
      totalMinor: 1400, priced: 3, total: 3, oldestPricedAt: '2026-03-01T00:00:00.000Z',
    };
    expect(describeRecipeCost(estimate, '$', NOW)).toBe('≈ $14.00 · prices as of Mar');
  });
});

// The empty-swaps default is exercised implicitly by every call above that
// omits the parameter; this just pins that the export exists for callers that
// want to pass "no swaps" explicitly, same as every other flattening reader.
describe('NO_STANDING_SWAPS', () => {
  it('is an empty map', () => {
    expect(NO_STANDING_SWAPS.size).toBe(0);
  });
});
