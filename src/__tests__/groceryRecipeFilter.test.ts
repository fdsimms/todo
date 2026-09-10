import type { GroceryItem, MealPlanEntry, Recipe, RecipeComponent, RecipeIngredient } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import {
  filterRowsByRecipes,
  pruneRecipeSelection,
  shoppedRecipes,
  type ShoppedRecipe,
} from '../utils/groceryRecipeFilter';

// Same mock and the same reason as mealPlanGroceries.test.ts: the chain down to
// dateUtils wants a dayResetTime, and nothing here needs one — a day key is a
// calendar day and carries no time.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;
beforeEach(() => { seq = 0; });

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

function recipe(name: string, ingredients: RecipeIngredient[], components: RecipeComponent[] = []): Recipe {
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
    components,
    prepTasks: [],
    steps: [],
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
    cookbookId: null,
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
    personIds: [],
    recipeScale: 1,
    cookTask: null,
    shopTask: null,
    logMeal: null,
    calendarEventId: null,
    ...overrides,
  };
}

/** A row already in the trolley — `itemsOnList`' own projection sets onList. */
function row(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  return {
    nameFromScan: false,
    id: `gi-${++seq}`,
    nameKey: groceryNameKey(overrides.name),
    preferredProductId: null,
    productStrict: false,
    aisle: 'Other',
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: true,
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
    frozenAt: null,
    openedAt: null,
    runningLowAt: null,
    shelfLifeDays: null,
    useUpTask: null,
    pantryCheckDeclinedAt: null,
    pantryReviewedAt: null,
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    varietyOfKey: null,
    nutrition: null,
    backfillDismissedFields: [],
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    priceHistory: [],
    ...overrides,
  };
}

const TODAY = '2026-08-12';
const LEAD = 2;

function index(...recipes: Recipe[]): Map<string, Recipe> {
  return new Map(recipes.map(r => [r.id, r]));
}

describe('shoppedRecipes', () => {
  it('names a planned recipe and the trolley rows it calls for', () => {
    const ragu = recipe('Ragù', [ing('Onions'), ing('Garlic')]);
    const onions = row({ name: 'Onions' });
    const garlic = row({ name: 'Garlic' });
    const soap = row({ name: 'Dish soap' });

    const shopped = shoppedRecipes(
      [entry(TODAY, ragu.id)],
      index(ragu),
      [onions, garlic, soap],
      TODAY,
      LEAD
    );

    expect(shopped).toHaveLength(1);
    expect(shopped[0].title).toBe('Ragù');
    expect([...shopped[0].itemIds].sort()).toEqual([onions.id, garlic.id].sort());
    // The row nothing planned asked for is not claimed by the recipe.
    expect(shopped[0].itemIds).not.toContain(soap.id);
  });

  it('claims a row that carries no sourceRecipeId — the case the stored column cannot answer', () => {
    const ragu = recipe('Ragù', [ing('Garlic')]);
    // A staple that was already in the catalog, so addFromPlan never stamped it.
    const garlic = row({ name: 'Garlic', sourceRecipeId: null, isStaple: true });

    const shopped = shoppedRecipes([entry(TODAY, ragu.id)], index(ragu), [garlic], TODAY, LEAD);

    expect(shopped[0].itemIds).toEqual([garlic.id]);
  });

  it('ignores a stale sourceRecipeId pointing at a recipe nobody is cooking', () => {
    const ragu = recipe('Ragù', [ing('Garlic')]);
    // Stamped months ago by a recipe that is not in this window at all.
    const garlic = row({ name: 'Garlic', sourceRecipeId: 'r-long-gone', sourceRecipeTitle: 'Old soup' });

    const shopped = shoppedRecipes([entry(TODAY, ragu.id)], index(ragu), [garlic], TODAY, LEAD);

    expect(shopped).toHaveLength(1);
    expect(shopped[0].recipeId).toBe(ragu.id);
    expect(shopped[0].itemIds).toEqual([garlic.id]);
  });

  it('lets two recipes both claim an ingredient they share', () => {
    const ragu = recipe('Ragù', [ing('Garlic')]);
    const curry = recipe('Curry', [ing('Garlic')]);
    const garlic = row({ name: 'Garlic' });

    const shopped = shoppedRecipes(
      [entry(TODAY, ragu.id), entry(TODAY, curry.id)],
      index(ragu, curry),
      [garlic],
      TODAY,
      LEAD
    );

    expect(shopped.map(s => s.title)).toEqual(['Curry', 'Ragù']);
    expect(shopped.every(s => s.itemIds.includes(garlic.id))).toBe(true);
  });

  it('resolves a singular line to the plural row already in the trolley', () => {
    const salsa = recipe('Salsa', [ing('Serrano pepper')]);
    const peppers = row({ name: 'Serrano peppers' });

    const shopped = shoppedRecipes([entry(TODAY, salsa.id)], index(salsa), [peppers], TODAY, LEAD);

    expect(shopped[0].itemIds).toEqual([peppers.id]);
  });

  it('resolves a generic line to the declared varieties in the trolley', () => {
    const soup = recipe('Soup', [ing('Onion')]);
    const white = row({ name: 'White onion', varietyOfKey: groceryNameKey('Onion') });
    const red = row({ name: 'Red onion', varietyOfKey: groceryNameKey('Onion') });

    const shopped = shoppedRecipes([entry(TODAY, soup.id)], index(soup), [white, red], TODAY, LEAD);

    // Both, not the first: either could be the one meant, and hiding a row the
    // shopper needs is the worse mistake.
    expect([...shopped[0].itemIds].sort()).toEqual([white.id, red.id].sort());
  });

  it('does not offer a fuzzy near-match', () => {
    const drinks = recipe('Margaritas', [ing('Lime')]);
    // One edit away, and a real and different grocery.
    const line = row({ name: 'Line' });

    const shopped = shoppedRecipes([entry(TODAY, drinks.id)], index(drinks), [line], TODAY, LEAD);

    expect(shopped).toEqual([]);
  });

  it('attributes a component\'s ingredient to the planned recipe, not the component', () => {
    const mash = recipe('Mash', [ing('Potatoes')]);
    const dinner = recipe('Steak dinner', [ing('Steak')], [
      { id: 'c-1', recipeId: mash.id, name: 'Mash', choiceGroup: null },
    ]);
    const potatoes = row({ name: 'Potatoes' });
    const steak = row({ name: 'Steak' });

    const shopped = shoppedRecipes(
      [entry(TODAY, dinner.id)],
      index(dinner, mash),
      [potatoes, steak],
      TODAY,
      LEAD
    );

    expect(shopped).toHaveLength(1);
    expect(shopped[0].title).toBe('Steak dinner');
    expect([...shopped[0].itemIds].sort()).toEqual([potatoes.id, steak.id].sort());
  });

  it('collapses two nights of one recipe into a single pill', () => {
    const chili = recipe('Chili', [ing('Beans')]);
    const beans = row({ name: 'Beans' });

    const shopped = shoppedRecipes(
      [entry(TODAY, chili.id), entry('2026-08-13', chili.id)],
      index(chili),
      [beans],
      TODAY,
      LEAD
    );

    expect(shopped).toHaveLength(1);
    expect(shopped[0].itemIds).toEqual([beans.id]);
  });

  it('skips a cooked meal, a free-text night, and a recipe that no longer resolves', () => {
    const ragu = recipe('Ragù', [ing('Garlic')]);
    const garlic = row({ name: 'Garlic' });

    expect(
      shoppedRecipes([entry(TODAY, ragu.id, { cookedAt: '2026-08-12T18:00:00.000Z' })], index(ragu), [garlic], TODAY, LEAD)
    ).toEqual([]);
    expect(shoppedRecipes([entry(TODAY, null)], index(ragu), [garlic], TODAY, LEAD)).toEqual([]);
    expect(shoppedRecipes([entry(TODAY, 'r-gone')], index(ragu), [garlic], TODAY, LEAD)).toEqual([]);
  });

  it('skips meals outside the shop window, in both directions', () => {
    const ragu = recipe('Ragù', [ing('Garlic')]);
    const garlic = row({ name: 'Garlic' });
    const entries = [entry('2026-08-11', ragu.id), entry('2026-08-16', ragu.id)];

    expect(shoppedRecipes(entries, index(ragu), [garlic], TODAY, LEAD)).toEqual([]);
    // The far end is inclusive at today + leadDays.
    expect(shoppedRecipes([entry('2026-08-14', ragu.id)], index(ragu), [garlic], TODAY, LEAD)).toHaveLength(1);
  });

  it('omits a planned recipe with nothing of its own in the trolley', () => {
    const ragu = recipe('Ragù', [ing('Garlic')]);
    const tart = recipe('Tart', [ing('Puff pastry')]);
    const garlic = row({ name: 'Garlic' });

    const shopped = shoppedRecipes(
      [entry(TODAY, ragu.id), entry(TODAY, tart.id)],
      index(ragu, tart),
      [garlic],
      TODAY,
      LEAD
    );

    expect(shopped.map(s => s.title)).toEqual(['Ragù']);
  });

  it('counts only the unchecked rows as remaining, and keeps the checked ones as members', () => {
    const ragu = recipe('Ragù', [ing('Onions'), ing('Garlic')]);
    const onions = row({ name: 'Onions', checked: true });
    const garlic = row({ name: 'Garlic' });

    const shopped = shoppedRecipes([entry(TODAY, ragu.id)], index(ragu), [onions, garlic], TODAY, LEAD);

    expect(shopped[0].remaining).toBe(1);
    expect(shopped[0].itemIds).toHaveLength(2);
  });

  it('returns nothing for an empty trolley', () => {
    const ragu = recipe('Ragù', [ing('Garlic')]);
    expect(shoppedRecipes([entry(TODAY, ragu.id)], index(ragu), [], TODAY, LEAD)).toEqual([]);
  });

  describe('a recipe added straight to the list, with no meal planned', () => {
    it('is found by the rows it stamped', () => {
      const tart = recipe('Tart', [ing('Puff pastry'), ing('Apples')]);
      const pastry = row({ name: 'Puff pastry', sourceRecipeId: tart.id, sourceRecipeTitle: 'Tart' });
      const apples = row({ name: 'Apples' });

      const shopped = shoppedRecipes([], index(tart), [pastry, apples], TODAY, LEAD);

      expect(shopped).toHaveLength(1);
      expect(shopped[0].title).toBe('Tart');
      // Both lines, not just the stamped one: the stamp only says the recipe put
      // something here, and membership is still derived from the ingredients.
      expect([...shopped[0].itemIds].sort()).toEqual([pastry.id, apples.id].sort());
    });

    it('claims the staples the stamp never credited', () => {
      const tart = recipe('Tart', [ing('Puff pastry'), ing('Butter')]);
      const pastry = row({ name: 'Puff pastry', sourceRecipeId: tart.id });
      // Already in the catalog, so addFromPlan stamped nothing on it.
      const butter = row({ name: 'Butter', isStaple: true });

      const shopped = shoppedRecipes([], index(tart), [pastry, butter], TODAY, LEAD);

      expect(shopped[0].itemIds).toContain(butter.id);
    });

    it('is not offered once its rows have left the trolley', () => {
      const tart = recipe('Tart', [ing('Puff pastry')]);
      const unrelated = row({ name: 'Dish soap' });

      expect(shoppedRecipes([], index(tart), [unrelated], TODAY, LEAD)).toEqual([]);
    });

    it('does not resurface a meal already cooked in the window', () => {
      const salmon = recipe('Salmon', [ing('Salmon fillets')]);
      const fillets = row({ name: 'Salmon fillets', sourceRecipeId: salmon.id });

      const shopped = shoppedRecipes(
        [entry(TODAY, salmon.id, { cookedAt: '2026-08-12T18:00:00.000Z' })],
        index(salmon),
        [fillets],
        TODAY,
        LEAD
      );

      // The stamped row would otherwise hand back the pill the cooked rule just
      // declined to give.
      expect(shopped).toEqual([]);
    });

    it('is one pill, not two, when the same recipe is also planned', () => {
      const chili = recipe('Chili', [ing('Beans')]);
      const beans = row({ name: 'Beans', sourceRecipeId: chili.id });

      const shopped = shoppedRecipes([entry(TODAY, chili.id)], index(chili), [beans], TODAY, LEAD);

      expect(shopped).toHaveLength(1);
      expect(shopped[0].itemIds).toEqual([beans.id]);
    });

    it('ignores a stamp pointing at a recipe that no longer exists', () => {
      const tart = recipe('Tart', [ing('Puff pastry')]);
      const orphan = row({ name: 'Puff pastry', sourceRecipeId: 'r-deleted', sourceRecipeTitle: 'Gone' });

      expect(shoppedRecipes([], index(tart), [orphan], TODAY, LEAD)).toEqual([]);
    });
  });
});

describe('filterRowsByRecipes', () => {
  const a: ShoppedRecipe = { recipeId: 'r-a', title: 'A', itemIds: ['1', '2'], remaining: 2 };
  const b: ShoppedRecipe = { recipeId: 'r-b', title: 'B', itemIds: ['2', '3'], remaining: 2 };
  const rows = [row({ name: 'One' }), row({ name: 'Two' }), row({ name: 'Three' })];
  const withIds = rows.map((r, i) => ({ ...r, id: String(i + 1) }));

  it('returns the whole trolley when nothing is selected', () => {
    expect(filterRowsByRecipes(withIds, [a, b], [])).toEqual(withIds);
  });

  it('narrows to one recipe\'s rows', () => {
    expect(filterRowsByRecipes(withIds, [a, b], ['r-a']).map(r => r.id)).toEqual(['1', '2']);
  });

  it('unions the rows of several selected recipes without duplicating the shared one', () => {
    expect(filterRowsByRecipes(withIds, [a, b], ['r-a', 'r-b']).map(r => r.id)).toEqual(['1', '2', '3']);
  });

  it('treats a selected recipe it has never heard of as contributing nothing', () => {
    expect(filterRowsByRecipes(withIds, [a, b], ['r-gone'])).toEqual([]);
  });

  it('preserves the order it was given rather than the selection order', () => {
    expect(filterRowsByRecipes(withIds, [a, b], ['r-b', 'r-a']).map(r => r.id)).toEqual(['1', '2', '3']);
  });
});

describe('pruneRecipeSelection', () => {
  const a: ShoppedRecipe = { recipeId: 'r-a', title: 'A', itemIds: ['1'], remaining: 1 };

  it('drops a selected recipe that is no longer being shopped for', () => {
    expect(pruneRecipeSelection(['r-a', 'r-cooked'], [a])).toEqual(['r-a']);
  });

  it('leaves a live selection alone', () => {
    expect(pruneRecipeSelection(['r-a'], [a])).toEqual(['r-a']);
  });

  it('is a no-op on an empty selection', () => {
    expect(pruneRecipeSelection([], [a])).toEqual([]);
  });
});
