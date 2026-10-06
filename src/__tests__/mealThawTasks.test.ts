import type { GroceryItem, ItemProduct, Leftover, MealPlanEntry, Recipe, RecipeIngredient, Task } from '../types';
import { PORTION_PRODUCT_KEY } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import { NO_STANDING_SWAPS } from '../utils/standingSwaps';
import {
  MAX_MEAL_THAW_TASKS,
  frozenForMeal,
  isWithinThawWindow,
  mealThawEntryId,
  mealThawLinkUrl,
  mealThawTitle,
  staleMealThawTasks,
  wantedMealThaws,
} from '../utils/mealThawTasks';

// mealPlan.ts reaches dateUtils and so the settings store, which nothing here
// needs: a day key is a calendar day. Same mock mealShortfallTasks.test.ts uses.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;
beforeEach(() => { seq = 0; });

// Saturday 22 Aug 2026 is the logical today throughout.
const TODAY = '2026-08-22';
const TOMORROW = '2026-08-23';
const NOW = new Date('2026-08-22T12:00:00.000Z');

function ing(name: string, overrides: Partial<RecipeIngredient> = {}): RecipeIngredient {
  return {
    id: `ing-${++seq}`, name, nameKey: groceryNameKey(name), quantity: '', aisle: null, prep: null,
    purpose: null, section: null, choiceGroup: null, ...overrides,
  };
}

function recipe(name: string, ingredients: RecipeIngredient[]): Recipe {
  return {
    backfillDismissedFields: [], id: `r-${++seq}`, name, nameKey: name.toLowerCase(), notes: '',
    sourceUrl: null, sourceName: null, author: null, source: null, servings: null, servingsMax: null,
    recipeYield: null, cookedWeightG: null, leftoverKeepDays: null, imagePath: null, mealType: null,
    tags: [], ingredients, emptySections: [], emptyStepSections: [], components: [], prepTasks: [],
    steps: [], sortOrder: seq, createdAt: '2026-01-01T00:00:00.000Z', cookCount: 0, lastCookedAt: null,
    vote: null, upNext: false, upNextOrder: 0, estimatedMinutes: null, timerStartedAt: null,
    timerElapsedSeconds: 0, lastCookMinutes: null, cookTimeCount: 0, totalCookMinutes: 0,
    sourceType: null, sourcePage: null, cookbookId: null, prepMinutes: null, prepTimerStartedAt: null,
    prepTimerElapsedSeconds: 0, lastPrepMinutes: null, prepTimeCount: 0, totalPrepMinutes: 0,
  };
}

function entry(date: string, recipeId: string | null, overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: `m-${++seq}`, date, slot: 'dinner', recipeId, title: 'Stir-fry', sortOrder: 1,
    createdAt: '2026-01-01T00:00:00.000Z', cookedAt: null, leftoverId: null, recipeChoices: [],
    recipeScale: 1, cookTask: null, shopTask: null, logMeal: null, calendarEventId: null,
    ...overrides,
  };
}

function item(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  return {
    nameFromScan: false, id: `gi-${++seq}`, nameKey: groceryNameKey(overrides.name),
    preferredProductId: null, productStrict: false, aisle: 'Other', quantity: null,
    quantityFromRecipe: false, note: '', onList: false, checked: false, sortOrder: seq,
    purchaseCount: 0, lastAddedAt: null, lastPurchasedAt: null, purchaseIntervalDays: null, createdAt: '2026-01-01T00:00:00.000Z',
    onHandUntil: null, sourceRecipeId: null, sourceRecipeTitle: null, choiceGroup: null,
    isStaple: false, expiresAt: null, frozenAt: null, openedAt: null, runningLowAt: null,
    shelfLifeDays: null, useUpTask: null, pantryCheckDeclinedAt: null, pantryReviewedAt: null,
    usedUpCount: 0, spoiledCount: 0, lastSpoiledAt: null, varietyOfKey: null, nutrition: null,
    backfillDismissedFields: [], lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null,
    priceHistory: [], ...overrides,
  };
}

function leftover(overrides: Partial<Leftover> = {}): Leftover {
  return {
    id: `lo-${++seq}`, title: 'Chili', recipeId: null, sourceEntryId: null,
    storedAt: '2026-08-01T18:00:00.000Z', keepUntil: '2026-08-05', finishedAt: null, outcome: null,
    frozenAt: '2026-08-02T09:00:00.000Z', weightG: null, createdAt: '2026-08-01T18:00:00.000Z',
    useUpTask: null, ...overrides,
  };
}

function frozenBox(itemId: string): ItemProduct {
  return {
    id: `p-${++seq}`, itemId, brand: 'Store brand', variant: null, productKey: 'store brand|',
    rating: null, nutrition: null, note: '', purchaseCount: 0, lastPurchasedAt: null,
    gtin: null, onHandUntil: null, expiresAt: null, frozenAt: '2026-07-28T12:00:00.000Z', openedAt: null,
    isPortion: false, createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function task(sourceId: string, overrides: Partial<Task> = {}) {
  return {
    generatedKind: 'mealThaw', generatedSourceId: sourceId, completed: false, archived: false, ...overrides,
  } as Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>;
}

const frozenChicken = () => item({ name: 'Chicken thighs', frozenAt: '2026-08-01T09:00:00.000Z' });
const stirFry = () => recipe('Stir-fry', [ing('Chicken thighs'), ing('Rice'), ing('Scallions', { optional: true })]);
const byId = (...rs: Recipe[]) => new Map(rs.map(r => [r.id, r]));

const frozen = (e: MealPlanEntry, recipes: Map<string, Recipe>, items: GroceryItem[], leftovers: Leftover[] = [], products: ItemProduct[] = []) =>
  frozenForMeal(e, recipes, leftovers, items, [], NO_STANDING_SWAPS, NOW, products);

describe('the window', () => {
  it('is today and tomorrow, and nothing either side', () => {
    expect(isWithinThawWindow(TODAY, TODAY)).toBe(true);
    expect(isWithinThawWindow(TOMORROW, TODAY)).toBe(true);
    expect(isWithinThawWindow('2026-08-21', TODAY)).toBe(false);
    expect(isWithinThawWindow('2026-08-24', TODAY)).toBe(false);
  });
});

describe('mealThawTitle', () => {
  it('says what to take out and which meal it is for', () => {
    expect(mealThawTitle(TOMORROW, 'dinner', ['chicken thighs'])).toBe('Take chicken thighs out of the freezer (Sunday Dinner)');
    expect(mealThawTitle(TOMORROW, 'lunch', ['chicken thighs', 'peas'])).toBe('Take chicken thighs and peas out of the freezer (Sunday Lunch)');
  });
});

describe('frozenForMeal', () => {
  it('names an ingredient the kitchen has only in the freezer, and links to its Pantry row', () => {
    const r = stirFry();
    const chicken = frozenChicken();
    const result = frozen(entry(TOMORROW, r.id), byId(r), [chicken, item({ name: 'Rice', isStaple: true })]);
    expect(result).toEqual({ names: ['chicken thighs'], kitchenEntryId: `grocery-${chicken.id}` });
    expect(mealThawLinkUrl(result!)).toBe(`dundundun://kitchen?item=grocery-${encodeURIComponent(chicken.id)}`);
  });

  it('counts a frozen box of an item too', () => {
    const r = stirFry();
    const chicken = item({ name: 'Chicken thighs' });
    expect(frozen(entry(TOMORROW, r.id), byId(r), [chicken], [], [frozenBox(chicken.id)])!.names)
      .toEqual(['chicken thighs']);
  });

  it('says nothing about fresh food, food to buy, or an optional garnish', () => {
    const r = stirFry();
    const scallions = item({ name: 'Scallions', frozenAt: '2026-08-01T09:00:00.000Z' });
    // Chicken bought yesterday, rice not in the kitchen at all, frozen scallions only garnish.
    const fresh = item({ name: 'Chicken thighs', purchaseCount: 1, lastPurchasedAt: '2026-08-21T12:00:00.000Z' });
    expect(frozen(entry(TOMORROW, r.id), byId(r), [fresh, scallions])).toEqual({ names: [], kitchenEntryId: null });
  });

  it('believes "Out of it" over the freezer, the way the Pantry does', () => {
    const r = stirFry();
    const chicken = item({ name: 'Chicken thighs', frozenAt: '2026-08-01T09:00:00.000Z', onHandUntil: '1970-01-01T00:00:00.000Z' });
    expect(frozen(entry(TOMORROW, r.id), byId(r), [chicken])!.names).toEqual([]);
  });

  // "Freeze some" (#2925): half a pack in the freezer and half out. The half
  // that's out covers the meal; once it's used up, the frozen half is what's
  // left, and that's the thaw.
  it('asks about a frozen portion only once the rest of the pack is gone', () => {
    const r = stirFry();
    const portion = { ...frozenBox('x'), brand: null, productKey: PORTION_PRODUCT_KEY, isPortion: true };
    const fresh = item({ name: 'Chicken thighs', purchaseCount: 1, lastPurchasedAt: '2026-08-21T12:00:00.000Z' });
    expect(frozen(entry(TOMORROW, r.id), byId(r), [fresh], [], [{ ...portion, itemId: fresh.id }])!.names)
      .toEqual([]);

    const usedUp = { ...fresh, onHandUntil: '1970-01-01T00:00:00.000Z' };
    expect(frozen(entry(TOMORROW, r.id), byId(r), [usedUp], [], [{ ...portion, itemId: usedUp.id }])!.names)
      .toEqual(['chicken thighs']);
  });

  it('names a frozen leftover planned for the meal', () => {
    const chili = leftover();
    expect(frozen(entry(TOMORROW, null, { leftoverId: chili.id }), byId(), [], [chili]))
      .toEqual({ names: ['Chili'], kitchenEntryId: `leftover-${chili.id}` });
    // Thawed already, or finished: nothing to take out.
    expect(frozen(entry(TOMORROW, null, { leftoverId: chili.id }), byId(), [], [{ ...chili, frozenAt: null }])!.names).toEqual([]);
    expect(frozen(entry(TOMORROW, null, { leftoverId: chili.id }), byId(), [], [{ ...chili, finishedAt: NOW.toISOString(), outcome: 'eaten' }])).toBeNull();
  });

  it('has nothing to ask about a cooked meal, a typed one, or a recipe that has gone', () => {
    const r = stirFry();
    expect(frozen(entry(TOMORROW, r.id, { cookedAt: NOW.toISOString() }), byId(r), [frozenChicken()])).toBeNull();
    expect(frozen(entry(TOMORROW, null), byId(r), [frozenChicken()])).toBeNull();
    expect(frozen(entry(TOMORROW, 'r-gone'), byId(r), [frozenChicken()])).toBeNull();
  });
});

describe('wantedMealThaws', () => {
  const wanted = (entries: MealPlanEntry[], recipes: Map<string, Recipe>, items: GroceryItem[], cap = MAX_MEAL_THAW_TASKS) =>
    wantedMealThaws(entries, recipes, [], items, [], NO_STANDING_SWAPS, TODAY, NOW, cap);

  it('raises one row per meal in the window, soonest first', () => {
    const r = stirFry();
    const sunday = entry(TOMORROW, r.id);
    const tonight = entry(TODAY, r.id);
    const later = entry('2026-08-25', r.id);
    const wants = wanted([sunday, later, tonight], byId(r), [frozenChicken()]);
    expect(wants.map(w => w.entryId)).toEqual([tonight.id, sunday.id]);
    expect(wants[1].title).toBe('Take chicken thighs out of the freezer (Sunday Dinner)');
  });

  it('respects a meal told not to ask, and the cap', () => {
    const r = stirFry();
    const declined = entry(TOMORROW, r.id, { thawTask: false });
    expect(wanted([declined], byId(r), [frozenChicken()])).toEqual([]);
    const meals = ['breakfast', 'lunch', 'dinner', 'snack'].map(slot => entry(TOMORROW, r.id, { slot: slot as MealPlanEntry['slot'] }));
    expect(wanted(meals, byId(r), [frozenChicken()], 2)).toHaveLength(2);
  });
});

describe('staleMealThawTasks', () => {
  const stale = (tasks: ReturnType<typeof task>[], entries: MealPlanEntry[], recipes: Map<string, Recipe>, items: GroceryItem[], todayKey = TODAY) =>
    staleMealThawTasks(tasks, entries, recipes, [], items, [], NO_STANDING_SWAPS, todayKey, NOW);

  it('keeps a row whose meal still needs something from the freezer', () => {
    const r = stirFry();
    const meal = entry(TOMORROW, r.id);
    expect(stale([task(meal.id)], [meal], byId(r), [frozenChicken()])).toEqual([]);
  });

  it('clears one whose meal went, was cooked, moved away, was declined, or whose food came out', () => {
    const r = stirFry();
    const meal = entry(TOMORROW, r.id);
    const t = task(meal.id);
    expect(stale([t], [], byId(r), [frozenChicken()])).toEqual([t]);
    expect(stale([t], [{ ...meal, cookedAt: NOW.toISOString() }], byId(r), [frozenChicken()])).toEqual([t]);
    expect(stale([t], [{ ...meal, date: '2026-08-26' }], byId(r), [frozenChicken()])).toEqual([t]);
    expect(stale([t], [{ ...meal, thawTask: false }], byId(r), [frozenChicken()])).toEqual([t]);
    expect(stale([t], [meal], byId(r), [{ ...frozenChicken(), frozenAt: null }])).toEqual([t]);
    // Its day has passed.
    expect(stale([t], [meal], byId(r), [frozenChicken()], '2026-08-24')).toEqual([t]);
  });

  it('leaves completed rows and other kinds alone', () => {
    const r = stirFry();
    expect(stale([task('m-x', { completed: true }), task('m-y', { generatedKind: 'mealShortfall' })], [], byId(r), [])).toEqual([]);
    expect(mealThawEntryId(task('m-1'))).toBe('m-1');
    expect(mealThawEntryId(task('m-1', { generatedKind: 'mealShortfall' }))).toBeNull();
  });
});
