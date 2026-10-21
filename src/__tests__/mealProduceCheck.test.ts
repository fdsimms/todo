import type { FoodNutrition, GroceryItem, MealPlanEntry, MealSlot, Recipe, RecipeIngredient } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import { FREEZER_SECTION, kitchenEntryId, type KitchenEntry } from '../utils/kitchenInventory';
import {
  describeProduceGaps,
  listsNoProduce,
  mealsWithoutProduce,
  producesOnHand,
} from '../utils/mealProduceCheck';

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
    leftoverKeepDays: null, ovenTemp: null, ovenTempUnit: 'F',
    imagePath: null,
    mealType: null,
    tags: [],
    ingredients,
    emptySections: [],
    emptyStepSections: [],
    components: [],
    blanks: [],
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

beforeEach(() => { seq = 0; });

function planned(recipeId: string | null, slot: MealSlot, over: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: `m-${++seq}`, date: '2026-10-20', slot, recipeId, title: '', cookedAt: null, recipeScale: null,
    ...over,
  } as unknown as MealPlanEntry;
}

const byId = (...recipes: Recipe[]) => new Map(recipes.map(r => [r.id, r]));

describe('listsNoProduce', () => {
  it('is true for a weighed recipe with no vegetables or fruit', () => {
    const mac = recipe('Mac and cheese', [ing('Pasta', '200 g'), ing('Cheddar', '100 g')]);
    const items = [item('Pasta'), item('Cheddar')];
    expect(listsNoProduce(planned(mac.id, 'dinner'), byId(mac), items)).toBe(true);
  });

  it('is false when the recipe has produce', () => {
    const soup = recipe('Soup', [ing('Carrot', '200 g'), ing('Stock', '500 g')]);
    expect(listsNoProduce(planned(soup.id, 'dinner'), byId(soup), [item('Carrot'), item('Stock')])).toBe(false);
  });

  it('refuses when the recipe could not be weighed', () => {
    const mac = recipe('Mac and cheese', [ing('Pasta', '200 g'), ing('Cheddar', '100 g')]);
    expect(listsNoProduce(planned(mac.id, 'dinner'), byId(mac), [item('Pasta', false), item('Cheddar', false)])).toBe(false);
  });

  it('refuses a recipe naming a mixed dish, whose split the name hides', () => {
    const bowl = recipe('Bowl', [ing('Rice', '200 g'), ing('Stir fry vegetables', '100 g')]);
    expect(listsNoProduce(planned(bowl.id, 'dinner'), byId(bowl), [item('Rice'), item('Stir fry vegetables')])).toBe(false);
  });

  it('refuses a meal with no recipe or a missing one', () => {
    expect(listsNoProduce(planned(null, 'dinner'), byId(), [])).toBe(false);
    expect(listsNoProduce(planned('nope', 'dinner'), byId(), [])).toBe(false);
  });
});

describe('mealsWithoutProduce', () => {
  const mac = recipe('Mac and cheese', [ing('Pasta', '200 g'), ing('Cheddar', '100 g')]);
  const toast = recipe('Toast', [ing('Bread', '60 g'), ing('Butter', '10 g')]);
  const items = [item('Pasta'), item('Cheddar'), item('Bread'), item('Butter')];

  it('flags lunch and dinner, in that order, and skips breakfast', () => {
    const day = [planned(mac.id, 'dinner'), planned(toast.id, 'breakfast'), planned(toast.id, 'lunch')];
    const out = mealsWithoutProduce(day, new Set(), byId(mac, toast), items);
    expect(out.map(g => [g.slot, g.recipeName])).toEqual([['lunch', 'Toast'], ['dinner', 'Mac and cheese']]);
  });

  it('skips a meal already cooked or logged', () => {
    const day = [planned(mac.id, 'dinner', { cookedAt: '2026-10-20T18:00:00.000Z' }), planned(toast.id, 'lunch')];
    expect(mealsWithoutProduce(day, new Set<MealSlot>(['lunch']), byId(mac, toast), items)).toEqual([]);
  });
});

function entry(title: string, over: Partial<KitchenEntry> = {}): KitchenEntry {
  seq += 1;
  return {
    id: kitchenEntryId('grocery', `k-${seq}`), sourceId: `k-${seq}`, kind: 'grocery', title, productName: null,
    itemId: null, section: 'Produce', useBy: '2026-10-25', freshness: 'fresh', daysLeft: 5, reason: '',
    useByCaption: '', caption: '', onList: false, matchKey: title.toLowerCase(), ...over,
  };
}

describe('producesOnHand', () => {
  it('lists frozen produce first, as frozen, then the rest by name', () => {
    const out = producesOnHand([entry('Spinach'), entry('Peas', { section: FREEZER_SECTION }), entry('Carrot')]);
    expect(out).toEqual(['frozen peas', 'carrot', 'spinach']);
  });

  it('skips leftovers, produce past its use-by day and things that are not produce', () => {
    const out = producesOnHand([
      entry('Kale', { freshness: 'over' }), entry('Soup', { kind: 'leftover' }), entry('Bread'),
    ]);
    expect(out).toEqual([]);
  });
});

describe('describeProduceGaps', () => {
  it('reads singular and plural, and names up to three things on hand', () => {
    expect(describeProduceGaps([{ slot: 'dinner', recipeName: 'Mac and cheese' }], ['frozen peas', 'spinach']))
      .toBe('Dinner (Mac and cheese) lists no vegetables or fruit. On hand: frozen peas, spinach.');
    expect(describeProduceGaps(
      [{ slot: 'lunch', recipeName: 'Toast' }, { slot: 'dinner', recipeName: 'Pasta' }],
      ['a', 'b', 'c', 'd'],
    )).toBe('Lunch (Toast) and Dinner (Pasta) list no vegetables or fruit. On hand: a, b, c.');
  });

  it('stops at the gap when nothing is on hand', () => {
    expect(describeProduceGaps([{ slot: 'dinner', recipeName: 'Pasta' }], [])).toBe('Dinner (Pasta) lists no vegetables or fruit.');
  });
});
