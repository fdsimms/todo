import {
  rankGrocerySuggestions,
  buyAgainItems,
  buildGrocerySections,
  buildGroceryRecipeSections,
  catalogPruneCandidates,
  estimatedPurchaseCadenceDays,
  probablyHaveReason,
  correctableHaveReason,
  defaultOnHandUntil,
  pantryGuessLapsedDays,
  OUT_OF_IT_UNTIL,
  pantryEntries,
} from '../utils/grocerySuggest';
import { groceryNameKey } from '../utils/groceryParse';
import { FROZEN_REASON, RUNNING_LOW_REASON, type GroceryItem } from '../types';

const NOW = new Date('2026-08-07T12:00:00.000Z');

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}

let seq = 0;
function makeItem(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  const name = overrides.name;
  return {
    id: `id-${++seq}`,
    nameKey: groceryNameKey(name),
    preferredProductId: null,
    productStrict: false,
    aisle: 'Other',
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    checked: false,
    inCatalog: true,
    sortOrder: seq,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: daysAgo(365),
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
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  };
}

// ─── rankGrocerySuggestions ──────────────────────────────────────────────────

describe('rankGrocerySuggestions', () => {
  it('returns nothing for an empty query', () => {
    const items = [makeItem({ name: 'Milk' })];
    expect(rankGrocerySuggestions('', items, NOW)).toEqual([]);
    expect(rankGrocerySuggestions('   ', items, NOW)).toEqual([]);
  });

  it('does not match everything on a bare "s"', () => {
    // The plural stem of "s" is the empty string, which every name starts
    // with — so this used to offer the whole catalog, ranked by familiarity.
    const items = [
      makeItem({ name: 'Bread', purchaseCount: 20, lastPurchasedAt: daysAgo(1) }),
      makeItem({ name: 'Spinach', purchaseCount: 1, lastPurchasedAt: daysAgo(40) }),
    ];
    expect(rankGrocerySuggestions('s', items, NOW).map(s => s.item.name)).toEqual(['Spinach']);
  });

  it('still tolerates a plural query past one character', () => {
    const items = [makeItem({ name: 'Banana' })];
    expect(rankGrocerySuggestions('bananas', items, NOW).map(s => s.item.name)).toEqual(['Banana']);
  });

  it('prefers a prefix match over a substring one', () => {
    const items = [
      makeItem({ name: 'Buttermilk', purchaseCount: 5, lastPurchasedAt: daysAgo(1) }),
      makeItem({ name: 'Milk', purchaseCount: 5, lastPurchasedAt: daysAgo(1) }),
    ];
    expect(rankGrocerySuggestions('mil', items, NOW)[0].item.name).toBe('Milk');
  });

  it('prefers the frequently bought at equal recency', () => {
    const items = [
      makeItem({ name: 'Mustard', purchaseCount: 1, lastPurchasedAt: daysAgo(3) }),
      makeItem({ name: 'Muesli', purchaseCount: 20, lastPurchasedAt: daysAgo(3) }),
    ];
    expect(rankGrocerySuggestions('mu', items, NOW)[0].item.name).toBe('Muesli');
  });

  it('prefers the recently bought at equal frequency', () => {
    const items = [
      makeItem({ name: 'Mustard', purchaseCount: 4, lastPurchasedAt: daysAgo(200) }),
      makeItem({ name: 'Muesli', purchaseCount: 4, lastPurchasedAt: daysAgo(2) }),
    ];
    expect(rankGrocerySuggestions('mu', items, NOW)[0].item.name).toBe('Muesli');
  });

  it('lets frequency beat a weaker match once the gap is big enough', () => {
    // The mustard bought once in March must not outrank the milk bought weekly.
    const items = [
      makeItem({ name: 'Mustard', purchaseCount: 1, lastPurchasedAt: daysAgo(150) }),
      makeItem({ name: 'Whole milk', purchaseCount: 40, lastPurchasedAt: daysAgo(2) }),
    ];
    const ranked = rankGrocerySuggestions('m', items, NOW);
    expect(ranked[0].item.name).toBe('Whole milk');
  });

  it('tolerates a plural in the query, where a wrong guess only costs a keystroke', () => {
    const items = [makeItem({ name: 'Banana', purchaseCount: 3 })];
    expect(rankGrocerySuggestions('bananas', items, NOW)).toHaveLength(1);
  });

  it('flags items already on the list rather than hiding them', () => {
    const items = [makeItem({ name: 'Milk', onList: true })];
    const ranked = rankGrocerySuggestions('milk', items, NOW);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].onList).toBe(true);
  });

  it('respects the limit', () => {
    const items = Array.from({ length: 20 }, (_, i) => makeItem({ name: `Milk ${i}` }));
    expect(rankGrocerySuggestions('milk', items, NOW, 3)).toHaveLength(3);
  });

  it('drops non-matches', () => {
    const items = [makeItem({ name: 'Bread' })];
    expect(rankGrocerySuggestions('milk', items, NOW)).toEqual([]);
  });
});

// ─── buyAgainItems ───────────────────────────────────────────────────────────

describe('buyAgainItems', () => {
  it('never offers something already on the list', () => {
    const items = [
      makeItem({ name: 'Milk', onList: true, purchaseCount: 30 }),
      makeItem({ name: 'Bread', purchaseCount: 1 }),
    ];
    expect(buyAgainItems(items, NOW).map(i => i.name)).toEqual(['Bread']);
  });

  it('ranks staples ahead of one-offs', () => {
    const items = [
      makeItem({ name: 'Anchovy paste', purchaseCount: 1, lastPurchasedAt: daysAgo(120) }),
      makeItem({ name: 'Milk', purchaseCount: 30, lastPurchasedAt: daysAgo(4) }),
    ];
    expect(buyAgainItems(items, NOW)[0].name).toBe('Milk');
  });
});

// ─── buildGrocerySections ────────────────────────────────────────────────────

describe('buildGrocerySections', () => {
  const order = ['Produce', 'Dairy & Eggs', 'Other'];

  it('ignores anything not on the list', () => {
    const items = [makeItem({ name: 'Milk', aisle: 'Dairy & Eggs', onList: false })];
    const { sections, remaining } = buildGrocerySections(items, order);
    expect(sections).toEqual([]);
    expect(remaining).toBe(0);
  });

  it('groups into aisles in walk order and drops the empty ones', () => {
    const items = [
      makeItem({ name: 'Milk', aisle: 'Dairy & Eggs', onList: true }),
      makeItem({ name: 'Apples', aisle: 'Produce', onList: true }),
    ];
    const { sections } = buildGrocerySections(items, order);
    expect(sections.map(s => s.aisle)).toEqual(['Produce', 'Dairy & Eggs']);
  });

  it('still renders an aisle the order has never heard of', () => {
    // Dropping it would make its items invisible rather than merely misplaced.
    const items = [makeItem({ name: 'Steak', aisle: 'Butcher', onList: true })];
    const { sections } = buildGrocerySections(items, order);
    expect(sections.map(s => s.aisle)).toEqual(['Butcher']);
  });

  it('keeps a just-checked row in its own aisle while the hold is live', () => {
    const milk = makeItem({ name: 'Milk', aisle: 'Dairy & Eggs', onList: true, checked: true });
    const { sections, inCart } = buildGrocerySections([milk], order, [milk.id]);
    expect(sections[0].data.map(i => i.name)).toEqual(['Milk']);
    expect(inCart).toEqual([]);
  });

  it('sinks it into the cart once the hold clears', () => {
    const milk = makeItem({ name: 'Milk', aisle: 'Dairy & Eggs', onList: true, checked: true });
    const { sections, inCart } = buildGrocerySections([milk], order, []);
    expect(sections).toEqual([]);
    expect(inCart.map(i => i.name)).toEqual(['Milk']);
  });

  it('counts only what is still to buy', () => {
    const items = [
      makeItem({ name: 'Milk', aisle: 'Dairy & Eggs', onList: true, checked: true }),
      makeItem({ name: 'Apples', aisle: 'Produce', onList: true }),
      makeItem({ name: 'Bread', aisle: 'Other', onList: false }),
    ];
    expect(buildGrocerySections(items, order).remaining).toBe(1);
  });

  it('orders rows within an aisle by sortOrder', () => {
    const items = [
      makeItem({ name: 'Zucchini', aisle: 'Produce', onList: true, sortOrder: 9 }),
      makeItem({ name: 'Apples', aisle: 'Produce', onList: true, sortOrder: 2 }),
    ];
    const { sections } = buildGrocerySections(items, order);
    expect(sections[0].data.map(i => i.name)).toEqual(['Apples', 'Zucchini']);
  });
});

// ─── buildGroceryRecipeSections ──────────────────────────────────────────────

describe('buildGroceryRecipeSections', () => {
  it('ignores anything not on the list', () => {
    const items = [makeItem({ name: 'Milk', sourceRecipeId: 'r1', sourceRecipeTitle: 'Chili', onList: false })];
    const { sections, remaining } = buildGroceryRecipeSections(items);
    expect(sections).toEqual([]);
    expect(remaining).toBe(0);
  });

  it('groups by recipe, sorted by title', () => {
    const items = [
      makeItem({ name: 'Chicken', sourceRecipeId: 'r2', sourceRecipeTitle: 'Stir-fry', onList: true }),
      makeItem({ name: 'Beans', sourceRecipeId: 'r1', sourceRecipeTitle: 'Chili', onList: true }),
    ];
    const { sections } = buildGroceryRecipeSections(items);
    expect(sections.map(s => s.recipeTitle)).toEqual(['Chili', 'Stir-fry']);
    expect(sections.map(s => s.recipeId)).toEqual(['r1', 'r2']);
  });

  it('sinks unattributed items into "No recipe", always last', () => {
    const items = [
      makeItem({ name: 'Paper towels', sourceRecipeId: null, sourceRecipeTitle: null, onList: true }),
      makeItem({ name: 'Beans', sourceRecipeId: 'r1', sourceRecipeTitle: 'Chili', onList: true }),
    ];
    const { sections } = buildGroceryRecipeSections(items);
    expect(sections.map(s => s.recipeTitle)).toEqual(['Chili', 'No recipe']);
    expect(sections[1].recipeId).toBeNull();
  });

  it('keeps a just-checked row in its own recipe section while the hold is live', () => {
    const beans = makeItem({ name: 'Beans', sourceRecipeId: 'r1', sourceRecipeTitle: 'Chili', onList: true, checked: true });
    const { sections, inCart } = buildGroceryRecipeSections([beans], [beans.id]);
    expect(sections[0].data.map(i => i.name)).toEqual(['Beans']);
    expect(inCart).toEqual([]);
  });

  it('sinks it into the cart once the hold clears', () => {
    const beans = makeItem({ name: 'Beans', sourceRecipeId: 'r1', sourceRecipeTitle: 'Chili', onList: true, checked: true });
    const { sections, inCart } = buildGroceryRecipeSections([beans], []);
    expect(sections).toEqual([]);
    expect(inCart.map(i => i.name)).toEqual(['Beans']);
  });

  it('orders rows within a recipe section by sortOrder', () => {
    const items = [
      makeItem({ name: 'Zucchini', sourceRecipeId: 'r1', sourceRecipeTitle: 'Chili', onList: true, sortOrder: 9 }),
      makeItem({ name: 'Beans', sourceRecipeId: 'r1', sourceRecipeTitle: 'Chili', onList: true, sortOrder: 2 }),
    ];
    const { sections } = buildGroceryRecipeSections(items);
    expect(sections[0].data.map(i => i.name)).toEqual(['Beans', 'Zucchini']);
  });
});

// ─── catalogPruneCandidates ──────────────────────────────────────────────────

describe('catalogPruneCandidates', () => {
  it('names a stale never-bought row', () => {
    const items = [makeItem({ name: 'Mlik', lastAddedAt: daysAgo(200) })];
    expect(catalogPruneCandidates(items, NOW).map(i => i.name)).toEqual(['Mlik']);
  });

  it('never names something that has been bought', () => {
    const items = [makeItem({ name: 'Milk', purchaseCount: 1, lastAddedAt: daysAgo(200) })];
    expect(catalogPruneCandidates(items, NOW)).toEqual([]);
  });

  it('names a stale never-bought row even with a long-ago add date', () => {
    const items = [makeItem({ name: 'Truffle oil', lastAddedAt: daysAgo(200) })];
    expect(catalogPruneCandidates(items, NOW).map(i => i.name)).toEqual(['Truffle oil']);
  });

  it('never names something currently on the list', () => {
    const items = [makeItem({ name: 'Mlik', onList: true, lastAddedAt: daysAgo(200) })];
    expect(catalogPruneCandidates(items, NOW)).toEqual([]);
  });

  it('leaves a recent typo alone — it might still be wanted', () => {
    const items = [makeItem({ name: 'Mlik', lastAddedAt: daysAgo(2) })];
    expect(catalogPruneCandidates(items, NOW)).toEqual([]);
  });
});

// ─── estimatedPurchaseCadenceDays ────────────────────────────────────────────

describe('estimatedPurchaseCadenceDays', () => {
  it('divides the row\'s age by how many times it has been bought', () => {
    const item = makeItem({ name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90) });
    expect(estimatedPurchaseCadenceDays(item, NOW)).toBe(30);
  });

  it('is null when it has never been bought', () => {
    expect(estimatedPurchaseCadenceDays(makeItem({ name: 'Saffron', purchaseCount: 0 }), NOW)).toBeNull();
  });

  it('is null for a row created this instant — nothing to divide by yet', () => {
    const item = makeItem({ name: 'Milk', purchaseCount: 3, createdAt: NOW.toISOString() });
    expect(estimatedPurchaseCadenceDays(item, NOW)).toBeNull();
  });
});

// ─── probablyHaveReason ──────────────────────────────────────────────────────

describe('probablyHaveReason', () => {
  // #1770 — under the cadence floor the flat two-week window applies instead
  // of the item's own (2 purchases on a 60-day row divides out to 30 days,
  // which is not a number to believe from two data points).
  it('falls back to the flat window without enough purchases to trust a cadence', () => {
    const item = makeItem({
      name: 'Truffle salt', purchaseCount: 2, createdAt: daysAgo(60), lastPurchasedAt: daysAgo(1),
    });
    expect(probablyHaveReason(item, NOW)).toBe('bought 2× · last on 6 Aug');
  });

  it('is null once the flat window has run out, below the cadence floor', () => {
    const item = makeItem({
      name: 'Truffle salt', purchaseCount: 2, createdAt: daysAgo(60), lastPurchasedAt: daysAgo(20),
    });
    expect(probablyHaveReason(item, NOW)).toBeNull();
  });

  // "once" rather than "1×", mirroring describeCookHistory.
  it('names a single purchase as "once"', () => {
    const item = makeItem({ name: 'Tahini', purchaseCount: 1, createdAt: daysAgo(3), lastPurchasedAt: daysAgo(3) });
    expect(probablyHaveReason(item, NOW)).toBe('bought once · last on 4 Aug');
  });

  it('gives a reason when the last purchase is still inside the item\'s own cadence', () => {
    // Bought every 30 days on average; last one was 10 days ago.
    const item = makeItem({
      name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
    });
    expect(probablyHaveReason(item, NOW)).toBe('bought 3× · last on 28 Jul');
  });

  it('is null once the item is overdue by its own cadence — that is a guess it is gone', () => {
    // Same 30-day cadence, but the last purchase was 40 days ago.
    const item = makeItem({
      name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(40),
    });
    expect(probablyHaveReason(item, NOW)).toBeNull();
  });

  it('is null with no purchase recorded at all', () => {
    const item = makeItem({ name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: null });
    expect(probablyHaveReason(item, NOW)).toBeNull();
  });

  // The invariant #1770 was about: a purchase must be readable *as* a
  // purchase. Nothing writes onHandUntil on the way through any more, so this
  // is the shape every bought row now has.
  it('reads a bought row with no assertion on it at all', () => {
    const item = makeItem({
      name: 'Milk', purchaseCount: 4, createdAt: daysAgo(120), lastPurchasedAt: daysAgo(5), onHandUntil: null,
    });
    expect(probablyHaveReason(item, NOW)).toBe('bought 4× · last on 2 Aug');
  });

  it('a future onHandUntil wins regardless of purchase history', () => {
    const item = makeItem({ name: 'Saffron', purchaseCount: 0, onHandUntil: daysAgo(-5) });
    expect(probablyHaveReason(item, NOW)).toBe('marked as on hand');
  });

  it('an "Out of it" suppresses what would otherwise be a true reading', () => {
    const item = makeItem({
      name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
      onHandUntil: OUT_OF_IT_UNTIL,
    });
    expect(probablyHaveReason(item, NOW)).toBeNull();
  });

  // #1770 — the distinction the old "any past stamp is a negative" rule
  // couldn't draw. A "Got it" that has simply run out is not a claim to be
  // out of something; it hands the question back to the purchase reading.
  // Legacy rows carry exactly this shape, from when a trip stamped a window.
  it('a lapsed "Got it" falls through to the purchase reading rather than suppressing it', () => {
    const item = makeItem({
      name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
      onHandUntil: daysAgo(1),
    });
    expect(probablyHaveReason(item, NOW)).toBe('bought 3× · last on 28 Jul');
  });

  it('a lapsed "Got it" still reads as nothing when the purchase is stale too', () => {
    const item = makeItem({
      name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(40),
      onHandUntil: daysAgo(1),
    });
    expect(probablyHaveReason(item, NOW)).toBeNull();
  });

  it('a staple reads as on hand with no purchases and no onHandUntil at all', () => {
    const item = makeItem({ name: 'Salt', purchaseCount: 0, isStaple: true });
    expect(probablyHaveReason(item, NOW)).toBe('always have it');
  });

  it('a staple outranks even a past onHandUntil', () => {
    const item = makeItem({ name: 'Salt', isStaple: true, onHandUntil: daysAgo(1) });
    expect(probablyHaveReason(item, NOW)).toBe('always have it');
  });
});

// ─── correctableHaveReason ───────────────────────────────────────────────────

describe('correctableHaveReason', () => {
  // The two rungs that say "you have this" and nothing more. Both get offered,
  // and they share one wording, because nothing may assume the user said either.
  it('offers the purchase reading, in probablyHaveReason\'s own words', () => {
    const item = makeItem({
      name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
    });
    expect(correctableHaveReason(item, NOW)).toBe('bought 3× · last on 28 Jul');
  });

  it('offers a live "Got it" in the same breath as the purchase reading', () => {
    const item = makeItem({ name: 'Rice', onHandUntil: daysAgo(-5) });
    expect(correctableHaveReason(item, NOW)).toBe('marked as on hand');
  });

  it('says nothing when the pantry does not claim the item at all', () => {
    const item = makeItem({
      name: 'Tahini', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(40),
    });
    expect(correctableHaveReason(item, NOW)).toBeNull();
  });

  it('says nothing about an "Out of it" row — there is no claim left to correct', () => {
    const item = makeItem({ name: 'Milk', onHandUntil: OUT_OF_IT_UNTIL });
    expect(correctableHaveReason(item, NOW)).toBeNull();
  });

  // The three exclusions. None of them turns on who made the claim — two of
  // the three are hand-typed — only on whether listing the item contradicts it.
  it('stays quiet for a staple, which is true because it gets restocked', () => {
    const item = makeItem({ name: 'Salt', isStaple: true });
    expect(probablyHaveReason(item, NOW)).toBe('always have it');
    expect(correctableHaveReason(item, NOW)).toBeNull();
  });

  it('stays quiet for a staple that would otherwise have a purchase reading too', () => {
    const item = makeItem({
      name: 'Salt', isStaple: true, purchaseCount: 3,
      createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
    });
    expect(correctableHaveReason(item, NOW)).toBeNull();
  });

  it('stays quiet when the answer has already been given as "running low"', () => {
    const item = makeItem({ name: 'Milk', runningLowAt: daysAgo(1) });
    expect(probablyHaveReason(item, NOW)).toBe(RUNNING_LOW_REASON);
    expect(correctableHaveReason(item, NOW)).toBeNull();
  });

  it('stays quiet for a frozen row — buying more does not empty the freezer', () => {
    const item = makeItem({ name: 'Chicken', frozenAt: daysAgo(30) });
    expect(probablyHaveReason(item, NOW)).toBe(FROZEN_REASON);
    expect(correctableHaveReason(item, NOW)).toBeNull();
  });

  // The exclusions read the columns, not the reason string, so a row carrying
  // an excluded state *and* a purchase reading is still silent — the string
  // never mentions the freezer once probablyHaveReason has ranked past it.
  it('stays quiet for a frozen row with a live purchase reading underneath it', () => {
    const item = makeItem({
      name: 'Chicken', frozenAt: daysAgo(30), purchaseCount: 3,
      createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
    });
    expect(correctableHaveReason(item, NOW)).toBeNull();
  });

  it('is unmoved by the row already being on the list', () => {
    const item = makeItem({ name: 'Rice', onList: true, onHandUntil: daysAgo(-5) });
    expect(correctableHaveReason(item, NOW)).toBe('marked as on hand');
  });
});

// ─── defaultOnHandUntil ──────────────────────────────────────────────────────

describe('defaultOnHandUntil', () => {
  it('uses the item\'s own cadence once it has one', () => {
    const item = makeItem({ name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90) }); // 30-day cadence
    expect(defaultOnHandUntil(item, NOW)).toBe(daysAgo(-30));
  });

  it('falls back to a flat two weeks with no cadence to trust', () => {
    const item = makeItem({ name: 'Saffron', purchaseCount: 0 });
    expect(defaultOnHandUntil(item, NOW)).toBe(daysAgo(-14));
  });
});

// ─── pantryGuessLapsedDays ───────────────────────────────────────────────────

describe('pantryGuessLapsedDays', () => {
  it('is null while the purchase reading still vouches for the item', () => {
    // 30-day cadence, 10 days since: probablyHaveReason still answers.
    const item = makeItem({
      name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
    });
    expect(probablyHaveReason(item, NOW)).not.toBeNull();
    expect(pantryGuessLapsedDays(item, NOW)).toBeNull();
  });

  it('reports how long ago the window ran out', () => {
    const item = makeItem({
      name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(34),
    });
    // The exact moment probablyHaveReason goes quiet — the state change nobody
    // can see, which is what pantryCheckTasks offers to ask about.
    expect(probablyHaveReason(item, NOW)).toBeNull();
    expect(pantryGuessLapsedDays(item, NOW)).toBeCloseTo(4, 5);
  });

  it('is zero on the day the window closes', () => {
    const item = makeItem({
      name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(30),
    });
    expect(pantryGuessLapsedDays(item, NOW)).toBeCloseTo(0, 5);
  });

  it('stays null below the cadence gate, whatever the flat window says', () => {
    // Two purchases means the window is a made-up fortnight, and this is
    // deliberately gated harder than probablyHaveReason is: the reading is
    // happy to guess, but asking the user about a guess is a different bar.
    const item = makeItem({ name: 'Saffron', purchaseCount: 2, lastPurchasedAt: daysAgo(200) });
    expect(probablyHaveReason(item, NOW)).toBeNull();
    expect(pantryGuessLapsedDays(item, NOW)).toBeNull();
  });

  it('stays null for a row nothing was ever bought on', () => {
    const item = makeItem({ name: 'Tahini', purchaseCount: 0, lastPurchasedAt: null });
    expect(pantryGuessLapsedDays(item, NOW)).toBeNull();
  });
});

// ─── pantryEntries ──────────────────────────────────────────────────────────

describe('pantryEntries', () => {
  it('is exactly what probablyHaveReason answers for, and carries its wording', () => {
    const guessed = makeItem({
      name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
    });
    const marked = makeItem({ name: 'Rice', onHandUntil: daysAgo(-5) });
    const overdue = makeItem({
      name: 'Soy sauce', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(40),
    });
    const out = makeItem({ name: 'Olive oil', onHandUntil: daysAgo(1) });

    const entries = pantryEntries([guessed, marked, overdue, out], NOW);
    expect(entries.map(e => e.item.name)).toEqual(['Milk', 'Rice']);
    expect(entries.map(e => e.reason)).toEqual(['bought 3× · last on 28 Jul', 'marked as on hand']);
  });

  it('separates the user\'s own assertion from the cadence guess', () => {
    const guessed = makeItem({
      name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
    });
    const marked = makeItem({ name: 'Rice', onHandUntil: daysAgo(-5) });
    const entries = pantryEntries([guessed, marked], NOW);
    expect(entries.find(e => e.item.name === 'Milk')!.asserted).toBe(false);
    expect(entries.find(e => e.item.name === 'Rice')!.asserted).toBe(true);
  });

  it('keeps an item that is also on the list — the assertion outlives the add', () => {
    const item = makeItem({ name: 'Rice', onList: true, onHandUntil: daysAgo(-5) });
    expect(pantryEntries([item], NOW).map(e => e.item.name)).toEqual(['Rice']);
  });
});

