import type { GroceryItem, MealPlanEntry, Recipe, RecipeIngredient, Task } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import { NO_STANDING_SWAPS } from '../utils/standingSwaps';
import {
  MAX_MEAL_SHORTFALL_TASKS,
  isWithinShopWindow,
  mealShortfallEntryId,
  mealShortfallLinkUrl,
  mealShortfallRows,
  mealShortfallTitle,
  staleMealShortfallTasks,
  wantedMealShortfalls,
} from '../utils/mealShortfallTasks';

// Reaches mealPlan.ts for shiftDayKey/slotRank, which reaches dateUtils and so
// the settings store — which nothing here needs, since a day key is a calendar
// day and carries no time. Same mock mealPlanGroceries.test.ts uses.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

let seq = 0;
beforeEach(() => { seq = 0; });

// Saturday 22 Aug 2026 is the logical today throughout; the meals below sit on
// the days around it so the window cases read as weekdays rather than offsets.
const TODAY = '2026-08-22';
const NOW = new Date('2026-08-22T12:00:00.000Z');

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
    ...overrides,
  };
}

function entry(date: string, recipeId: string | null, overrides: Partial<MealPlanEntry> = {}): MealPlanEntry {
  return {
    id: `m-${++seq}`,
    date,
    slot: 'dinner',
    recipeId,
    title: 'Leftovers',
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
    varietyOfKey: null, backfillDismissedFields: [],
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    priceHistory: [],
    ...overrides,
  };
}

function task(overrides: Partial<Task> & { generatedSourceId: string | null }): Pick<
  Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'
> {
  return {
    generatedKind: 'mealShortfall',
    completed: false,
    archived: false,
    ...overrides,
  } as Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>;
}

/** A recipe wanting one thing, and the meal that plans it — the common fixture. */
function ragu() {
  return recipe('Ragù', [ing('Onions', { quantity: '2' })]);
}

const rows = (r: Recipe) => new Map([[r.id, r]]);

const shortfalls = (
  entries: MealPlanEntry[],
  recipesById: Map<string, Recipe>,
  items: GroceryItem[] = [],
  leadDays = 2,
  cap = MAX_MEAL_SHORTFALL_TASKS
) => wantedMealShortfalls(entries, recipesById, items, [], NO_STANDING_SWAPS, TODAY, NOW, leadDays, cap);

const stale = (
  tasks: ReturnType<typeof task>[],
  entries: MealPlanEntry[],
  recipesById: Map<string, Recipe>,
  items: GroceryItem[] = [],
  leadDays = 2
) => staleMealShortfallTasks(tasks, entries, recipesById, items, [], NO_STANDING_SWAPS, TODAY, NOW, leadDays);

describe('mealShortfallTitle', () => {
  it('names the verb and the night, so the row is not read as a task to cook', () => {
    expect(mealShortfallTitle('2026-08-25', 'Ragù')).toBe('Shop for Tue Ragù');
  });

  it('distinguishes two nights planning the same dish', () => {
    expect(mealShortfallTitle('2026-08-25', 'Ragù')).not.toBe(mealShortfallTitle('2026-08-27', 'Ragù'));
  });
});

describe('mealShortfallEntryId', () => {
  it('reads its own kind and no other', () => {
    expect(mealShortfallEntryId(task({ generatedSourceId: 'm-1' }))).toBe('m-1');
    // One column holds seven generators' source ids; a project id read as an
    // entry id would name a meal that doesn't exist.
    expect(mealShortfallEntryId(
      task({ generatedSourceId: 'p-1', generatedKind: 'projectReview' } as Partial<Task> & { generatedSourceId: string })
    )).toBeNull();
  });
});

describe('mealShortfallLinkUrl', () => {
  it('opens the meal plan on the day the meal is on, and asks for its sheet by entry id', () => {
    expect(mealShortfallLinkUrl('2026-08-25', 'entry-1')).toBe('dundundun://mealplan?date=2026-08-25&shop=entry-1');
  });

  it('encodes an id that could otherwise be read as another query param', () => {
    expect(mealShortfallLinkUrl('2026-08-25', 'a&b=c')).toBe('dundundun://mealplan?date=2026-08-25&shop=a%26b%3Dc');
  });
});

describe('isWithinShopWindow', () => {
  it('includes today and the last day of the lead, and excludes the day after', () => {
    expect(isWithinShopWindow('2026-08-22', TODAY, 2)).toBe(true);
    expect(isWithinShopWindow('2026-08-24', TODAY, 2)).toBe(true);
    expect(isWithinShopWindow('2026-08-25', TODAY, 2)).toBe(false);
  });

  it('excludes a day already gone — you cannot shop for a meal that happened', () => {
    expect(isWithinShopWindow('2026-08-21', TODAY, 2)).toBe(false);
  });

  it('with a zero lead, asks only about today', () => {
    expect(isWithinShopWindow(TODAY, TODAY, 0)).toBe(true);
    expect(isWithinShopWindow('2026-08-23', TODAY, 0)).toBe(false);
  });
});

describe('mealShortfallRows', () => {
  const call = (e: MealPlanEntry, r: Map<string, Recipe>, items: GroceryItem[] = []) =>
    mealShortfallRows(e, r, items, [], NO_STANDING_SWAPS, NOW);

  it('returns the lines still to buy', () => {
    const r = ragu();
    expect(call(entry(TODAY, r.id), rows(r))?.map(x => x.name)).toEqual(['Onions']);
  });

  it('returns null for a free-text night, which has no ingredient list', () => {
    expect(call(entry(TODAY, null), new Map())).toBeNull();
  });

  it('returns null for a recipe that no longer resolves', () => {
    // Resolve-or-shrug, like every other cross-row pointer here.
    expect(call(entry(TODAY, 'gone'), new Map())).toBeNull();
  });

  it('returns null once the meal is cooked — the ingredients are bought or moot', () => {
    const r = ragu();
    expect(call(entry(TODAY, r.id, { cookedAt: '2026-08-22T18:00:00.000Z' }), rows(r))).toBeNull();
  });

  it('distinguishes "nothing to shop for" from "not a shoppable meal"', () => {
    // [] and null are different answers and both callers rely on it.
    const r = ragu();
    expect(call(entry(TODAY, r.id), rows(r), [item({ name: 'Onions', onList: true })])).toEqual([]);
    expect(call(entry(TODAY, null), new Map())).toBeNull();
  });

  it('counts an item the app has never seen, unlike restockRows', () => {
    // needToBuy conflates "no catalog row" with "known but off the list", and
    // shopping ahead of a meal wants both halves — an item never bought is
    // exactly what will be missing. It is also what the add-to-list sheet this
    // task opens offers pre-ticked, so narrowing here would let the row
    // disagree with the sheet.
    const r = ragu();
    expect(call(entry(TODAY, r.id), rows(r), [])?.map(x => x.known)).toEqual([false]);
  });

  it('leaves out a garnish or serving suggestion, same as the sheet it opens', () => {
    // Missing only the mint sprigs must not spawn "shop for this meal" — the
    // sheet this task sends you to starts that line unticked, so being
    // missing can't be what triggers the task.
    const r = recipe('Iced tea', [ing('Tea bags'), ing('Mint sprigs', { optional: true })]);
    expect(call(entry(TODAY, r.id), rows(r), [item({ name: 'Tea bags', onList: true })])).toEqual([]);
  });

  it('ignores a staple, and something the pantry still vouches for', () => {
    const r = recipe('Ragù', [ing('Onions'), ing('Salt')]);
    const result = call(entry(TODAY, r.id), rows(r), [
      item({ name: 'Salt', isStaple: true }),
      item({ name: 'Onions', onHandUntil: '2026-09-30T00:00:00.000Z' }),
    ]);
    expect(result).toEqual([]);
  });

  it('applies the meal\'s own scale, so a doubled Sunday shops for double', () => {
    const r = ragu();
    const doubled = call(entry(TODAY, r.id, { recipeScale: 2 }), rows(r));
    expect(doubled?.[0].quantity).toBe('4');
  });
});

describe('wantedMealShortfalls', () => {
  it('wants a meal in range that is missing something', () => {
    const r = ragu();
    const e = entry('2026-08-23', r.id);
    expect(shortfalls([e], rows(r))).toEqual([
      { entryId: e.id, title: 'Shop for Sun Ragù', dayKey: '2026-08-23', missingCount: 1 },
    ]);
  });

  it('ignores a meal beyond the lead window, and one already gone', () => {
    const r = ragu();
    expect(shortfalls([entry('2026-08-26', r.id)], rows(r))).toEqual([]);
    expect(shortfalls([entry('2026-08-20', r.id)], rows(r))).toEqual([]);
  });

  it('widens with the lead setting', () => {
    const r = ragu();
    const far = entry('2026-08-26', r.id);
    expect(shortfalls([far], rows(r), [], 2)).toEqual([]);
    expect(shortfalls([far], rows(r), [], 4)).toHaveLength(1);
  });

  it('ignores a meal it has everything for', () => {
    const r = ragu();
    expect(shortfalls([entry(TODAY, r.id)], rows(r), [item({ name: 'Onions', onList: true })])).toEqual([]);
  });

  it('ranks the soonest meal first, not the one missing most', () => {
    // A row is a prompt to make one trip, and the trip that matters is the one
    // for tonight — ranking by size would put Monday's long list above the
    // dinner you are actually about to be blindsided by.
    const big = recipe('Curry', [ing('Rice'), ing('Peas'), ing('Cream')]);
    const small = recipe('Ragù', [ing('Onions')]);
    const by = new Map([[big.id, big], [small.id, small]]);
    const result = shortfalls([entry('2026-08-24', big.id), entry(TODAY, small.id)], by);
    expect(result.map(w => w.title)).toEqual(['Shop for Sat Ragù', 'Shop for Mon Curry']);
  });

  it('orders two meals on one day the way the day reads', () => {
    const r = ragu();
    const dinner = entry(TODAY, r.id, { slot: 'dinner' });
    const breakfast = entry(TODAY, r.id, { slot: 'breakfast' });
    expect(shortfalls([dinner, breakfast], rows(r)).map(w => w.entryId))
      .toEqual([breakfast.id, dinner.id]);
  });

  it('caps the set', () => {
    const r = ragu();
    const entries = ['2026-08-22', '2026-08-23', '2026-08-24'].flatMap(d => [
      entry(d, r.id, { slot: 'breakfast' }),
      entry(d, r.id, { slot: 'dinner' }),
    ]);
    expect(shortfalls(entries, rows(r))).toHaveLength(MAX_MEAL_SHORTFALL_TASKS);
  });

  it('skips a meal that has been told not to ask', () => {
    // MealPlanEntry.shopTask, stamped false by deleting the row. This is the
    // only generator whose source the user re-plans freely, so without the
    // tombstone a swiped-away row would come back on the very next sweep.
    const r = ragu();
    expect(shortfalls([entry(TODAY, r.id, { shopTask: false })], rows(r))).toEqual([]);
  });

  it('does not let an explicit yes conjure a shop for a meal with nothing missing', () => {
    // Deliberately narrower than wantsGeneratedTask's tri-state: an explicit
    // true that ignored the shortfall would thrash against the stale pass,
    // which judges on the shortfall alone.
    const r = ragu();
    const e = entry(TODAY, r.id, { shopTask: true });
    expect(shortfalls([e], rows(r), [item({ name: 'Onions', onList: true })])).toEqual([]);
  });

  it('answers "who should have one", not "who lacks one"', () => {
    // The caller runs every want through reconcileGeneratedTask, which turns
    // "wanted, one exists" into a drift check rather than a second row.
    const r = ragu();
    const e = entry(TODAY, r.id);
    expect(shortfalls([e], rows(r))).toHaveLength(1);
  });
});

describe('staleMealShortfallTasks', () => {
  it('leaves a task whose meal still wants shopping for', () => {
    const r = ragu();
    const e = entry(TODAY, r.id);
    expect(stale([task({ generatedSourceId: e.id })], [e], rows(r))).toEqual([]);
  });

  it('clears a task whose meal was deleted', () => {
    const live = task({ generatedSourceId: 'gone' });
    expect(stale([live], [], new Map())).toEqual([live]);
  });

  it('clears a task whose meal was swapped for something free-text', () => {
    const r = ragu();
    const e = entry(TODAY, null);
    const live = task({ generatedSourceId: e.id });
    expect(stale([live], [e], rows(r))).toEqual([live]);
  });

  it('clears a task once the ingredients are on the list', () => {
    const r = ragu();
    const e = entry(TODAY, r.id);
    const live = task({ generatedSourceId: e.id });
    expect(stale([live], [e], rows(r), [item({ name: 'Onions', onList: true })])).toEqual([live]);
  });

  it('clears a task once the meal is marked cooked', () => {
    const r = ragu();
    const e = entry(TODAY, r.id, { cookedAt: '2026-08-22T18:00:00.000Z' });
    const live = task({ generatedSourceId: e.id });
    expect(stale([live], [e], rows(r))).toEqual([live]);
  });

  it('clears a task whose meal moved out of range in either direction', () => {
    // The window is this generator's whole reason rather than a grace period,
    // so unlike stalePantryCheckTasks it does judge a live row on it: pushed to
    // next week the shop is premature, and once the day has passed it is moot.
    const r = ragu();
    const pushed = entry('2026-08-30', r.id);
    const past = entry('2026-08-19', r.id);
    expect(stale([task({ generatedSourceId: pushed.id })], [pushed], rows(r))).toHaveLength(1);
    expect(stale([task({ generatedSourceId: past.id })], [past], rows(r))).toHaveLength(1);
  });

  it('clears a task whose meal has been told not to ask', () => {
    // Both passes read the per-meal "no", so a live row can't outlast the
    // answer that would stop it being written.
    const r = ragu();
    const e = entry(TODAY, r.id, { shopTask: false });
    const live = task({ generatedSourceId: e.id });
    expect(stale([live], [e], rows(r))).toEqual([live]);
  });

  it('does not clear a task merely because its recipe was renamed', () => {
    // A rename is chased by drift instead — deleting and rewriting the row
    // would cost the user their deferral to buy exactly nothing.
    const r = recipe('Ragù alla bolognese', [ing('Onions')]);
    const e = entry(TODAY, r.id);
    expect(stale([task({ generatedSourceId: e.id })], [e], rows(r))).toEqual([]);
  });

  it('is judged on the predicate alone, never on the cap', () => {
    // Losing a contest for one of three slots must not delete a row the user
    // already deferred. Same split staleProjectReviewTasks makes.
    const r = ragu();
    const entries = ['2026-08-22', '2026-08-23', '2026-08-24'].flatMap(d => [
      entry(d, r.id, { slot: 'breakfast' }),
      entry(d, r.id, { slot: 'dinner' }),
    ]);
    expect(shortfalls(entries, rows(r))).toHaveLength(MAX_MEAL_SHORTFALL_TASKS);
    const live = entries.map(e => task({ generatedSourceId: e.id }));
    expect(stale(live, entries, rows(r))).toEqual([]);
  });

  it('ignores completed and archived rows, and other generators', () => {
    const done = task({ generatedSourceId: 'gone', completed: true });
    const filed = task({ generatedSourceId: 'gone', archived: true });
    const other = task({ generatedSourceId: 'gone', generatedKind: 'pantryCheck' } as Partial<Task> & { generatedSourceId: string });
    expect(stale([done, filed, other], [], new Map())).toEqual([]);
  });
});
