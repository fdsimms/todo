import type { FoodLogEntry, FoodNutrition, GroceryItem, Recipe, RecipeIngredient } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import { dayProduce } from '../utils/produceServings';
import { dishShare, helpingsOf, recipeProduceGrams, recipeProduceResolver } from '../utils/recipeProduce';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;

function ing(name: string, quantity: string): RecipeIngredient {
  return {
    id: `ing-${++seq}`,
    name,
    nameKey: groceryNameKey(name),
    quantity,
    aisle: null,
    prep: null,
    purpose: null,
    section: null,
    choiceGroup: null,
  };
}

function recipe(name: string, ingredients: RecipeIngredient[], over: Partial<Recipe> = {}): Recipe {
  return {
    backfillDismissedFields: [],
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
    cookedWeightG: null,
    leftoverKeepDays: null,
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients,
    emptySections: [],
    emptyStepSections: [],
    components: [],
    prepTasks: [],
    steps: [],
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    cookCount: 0,
    lastCookedAt: null,
    vote: null,
    upNext: false,
    upNextOrder: 0,
    estimatedMinutes: null,
    timerStartedAt: null,
    timerElapsedSeconds: 0,
    lastCookMinutes: null,
    cookTimeCount: 0,
    totalCookMinutes: 0,
    sourceType: null,
    sourcePage: null,
    cookbookId: null,
    prepMinutes: null,
    prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0,
    lastPrepMinutes: null,
    prepTimeCount: 0,
    totalPrepMinutes: 0,
    ...over,
  };
}

function panel(): FoodNutrition {
  return {
    basis: 'per100g',
    servingGrams: null,
    servingText: null,
    amounts: { calorieKcal: 50 },
    portions: [],
    source: 'fdc',
    sourceId: '1',
    recordedAt: '2026-09-01T00:00:00.000Z',
  };
}

function item(name: string, withPanel = true): GroceryItem {
  return {
    id: `gi-${++seq}`,
    nameKey: groceryNameKey(name),
    name,
    preferredProductId: null,
    productStrict: false,
    aisle: 'Produce',
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
    lastPriceQuantity: null,
    priceHistory: [],
    nutrition: withPanel ? panel() : null,
  } as unknown as GroceryItem;
}

function logged(recipeId: string, over: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return {
    id: `e-${++seq}`,
    dayKey: '2026-09-10',
    atISO: '2026-09-10T18:00:00.000Z',
    slot: 'dinner',
    label: 'Stew',
    recipeId,
    itemId: null,
    productId: null,
    mealPlanEntryId: null,
    quantity: '1 serving',
    grams: null,
    nutrition: { ...panel(), basis: 'perServing' },
    healthSampleIds: [],
    sortOrder: 0,
    createdAt: '2026-09-10T18:00:00.000Z',
    ...over,
  };
}

beforeEach(() => { seq = 0; });

describe('helpingsOf', () => {
  it('reads a serving count and nothing else', () => {
    expect(helpingsOf('2 servings')).toBe(2);
    expect(helpingsOf('1.5')).toBe(1.5);
    expect(helpingsOf('340g')).toBeNull();
    expect(helpingsOf('1 bowl')).toBeNull();
    expect(helpingsOf('')).toBeNull();
  });
});

describe('dishShare', () => {
  it('prefers a weighed plate against a weighed dish', () => {
    const dish = recipe('Stew', [], { servings: 4, cookedWeightG: 1000 });
    expect(dishShare(logged(dish.id, { grams: 250 }), dish)).toBe(0.25);
  });

  it('divides helpings by the recipe servings', () => {
    const dish = recipe('Stew', [], { servings: 4 });
    expect(dishShare(logged(dish.id, { quantity: '2 servings' }), dish)).toBe(0.5);
  });

  it('refuses a recipe that never said how many it serves', () => {
    expect(dishShare(logged('x'), recipe('Stew', []))).toBeNull();
  });
});

describe('recipeProduceGrams', () => {
  it('sums the grams of each produce kind', () => {
    const items = [item('Carrot'), item('Apple'), item('Rice')];
    const dish = recipe('Mix', [ing('Carrot', '200 g'), ing('Apple', '100 g'), ing('Rice', '100 g')]);
    expect(recipeProduceGrams(dish, items)).toEqual({ vegetable: 200, fruit: 100, dried: 0, legume: 0 });
  });

  it('refuses a dish with a produce line it could not weigh, rather than undercounting', () => {
    const items = [item('Carrot'), item('Tomato', false), item('Rice')];
    const dish = recipe('Mix', [ing('Carrot', '200 g'), ing('Tomato', '3'), ing('Rice', '100 g')]);
    expect(recipeProduceGrams(dish, items)).toBeNull();
  });

  it('refuses a dish too little of which could be weighed', () => {
    const dish = recipe('Mystery', [ing('Carrot', '200 g'), ing('Unknown', '1 cup'), ing('Other', '1 cup')]);
    expect(recipeProduceGrams(dish, [item('Carrot')])).toBeNull();
  });

  it('is null for a recipe with no ingredients', () => {
    expect(recipeProduceGrams(recipe('Empty', []), [])).toBeNull();
  });
});

describe('recipeProduceResolver with dayProduce', () => {
  it("counts one helping as a share of the dish's vegetables", () => {
    const items = [item('Carrot'), item('Rice')];
    const stew = recipe('Stew', [ing('Carrot', '320 g'), ing('Rice', '100 g')], { servings: 4 });
    const day = dayProduce([logged(stew.id)], recipeProduceResolver([stew], items));
    expect(day).toEqual({ vegetable: 1, fruit: 0, unmeasured: 0 });
  });

  it('is unmeasured for a deleted recipe', () => {
    const day = dayProduce([logged('gone')], recipeProduceResolver([], []));
    expect(day.unmeasured).toBe(1);
  });
});
