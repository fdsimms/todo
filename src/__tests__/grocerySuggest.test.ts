import {
  rankGrocerySuggestions,
  buyAgainItems,
  buildGrocerySections,
  catalogPruneCandidates,
  estimatedPurchaseCadenceDays,
  probablyHaveReason,
  defaultOnHandUntil,
  pantryEntries,
  buildPantrySections,
  distinctGroceryValues,
  filterGrocerySuggestions,
} from '../utils/grocerySuggest';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem } from '../types';

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
    brand: null,
    brandStrict: false,
    variant: null,
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
    shelfLifeDays: null,
    useUpTask: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
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
  it('is null without enough purchases to trust a cadence, even if bought recently', () => {
    const item = makeItem({
      name: 'Truffle salt', purchaseCount: 2, createdAt: daysAgo(60), lastPurchasedAt: daysAgo(1),
    });
    expect(probablyHaveReason(item, NOW)).toBeNull();
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

  it('a future onHandUntil wins regardless of purchase history', () => {
    const item = makeItem({ name: 'Saffron', purchaseCount: 0, onHandUntil: daysAgo(-5) });
    expect(probablyHaveReason(item, NOW)).toBe('marked as on hand');
  });

  it('a past onHandUntil suppresses what would otherwise be a true guess', () => {
    const item = makeItem({
      name: 'Milk', purchaseCount: 3, createdAt: daysAgo(90), lastPurchasedAt: daysAgo(10),
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

// ─── pantryEntries / buildPantrySections ─────────────────────────────────────

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

describe('buildPantrySections', () => {
  const marked = (name: string, aisle: string) =>
    makeItem({ name, aisle, onHandUntil: daysAgo(-5) });

  it('cuts the pantry into aisles in walk order', () => {
    const items = [marked('Rice', 'Pantry'), marked('Milk', 'Dairy & Eggs')];
    const sections = buildPantrySections(items, ['Dairy & Eggs', 'Pantry'], NOW);
    expect(sections.map(s => s.aisle)).toEqual(['Dairy & Eggs', 'Pantry']);
    expect(sections[0].data.map(e => e.item.name)).toEqual(['Milk']);
  });

  it('still renders an aisle the order has never heard of', () => {
    const sections = buildPantrySections([marked('Steak', 'Butcher')], ['Produce'], NOW);
    expect(sections.map(s => s.aisle)).toEqual(['Butcher']);
  });

  it('drops an aisle with nothing on hand in it', () => {
    const items = [marked('Rice', 'Pantry')];
    const sections = buildPantrySections(items, ['Produce', 'Pantry'], NOW);
    expect(sections.map(s => s.aisle)).toEqual(['Pantry']);
  });

  it('sorts within an aisle by name', () => {
    const items = [marked('Rice', 'Pantry'), marked('Flour', 'Pantry')];
    const sections = buildPantrySections(items, ['Pantry'], NOW);
    expect(sections[0].data.map(e => e.item.name)).toEqual(['Flour', 'Rice']);
  });

  it('filters by name, so "do I have flour" is one field away', () => {
    const items = [marked('Rice', 'Pantry'), marked('Flour', 'Pantry')];
    const sections = buildPantrySections(items, ['Pantry'], NOW, 'flo');
    expect(sections[0].data.map(e => e.item.name)).toEqual(['Flour']);
  });

  it('is empty rather than unfiltered when nothing matches', () => {
    const items = [marked('Rice', 'Pantry')];
    expect(buildPantrySections(items, ['Pantry'], NOW, 'saffron')).toEqual([]);
  });
});

// ─── distinctGroceryValues / filterGrocerySuggestions ───────────────────────

describe('distinctGroceryValues', () => {
  it('dedupes and sorts the values already typed on other items', () => {
    const items = [
      makeItem({ name: 'Milk', brand: 'Organic Valley' }),
      makeItem({ name: 'Cheese', brand: 'Kirkland' }),
      makeItem({ name: 'Yogurt', brand: 'Organic Valley' }),
    ];
    expect(distinctGroceryValues(items, undefined, i => i.brand)).toEqual([
      'Kirkland',
      'Organic Valley',
    ]);
  });

  it('drops items with no value set', () => {
    const items = [makeItem({ name: 'Milk', brand: 'Kirkland' }), makeItem({ name: 'Bread' })];
    expect(distinctGroceryValues(items, undefined, i => i.brand)).toEqual(['Kirkland']);
  });

  it('excludes the item being edited, so it never suggests only its own value', () => {
    const edited = makeItem({ name: 'Milk', brand: 'Kirkland' });
    const items = [edited, makeItem({ name: 'Cheese', brand: 'Organic Valley' })];
    expect(distinctGroceryValues(items, edited.id, i => i.brand)).toEqual(['Organic Valley']);
  });
});

describe('filterGrocerySuggestions', () => {
  const values = ['Kirkland', 'Organic Valley', "Trader Joe's"];

  it('returns everything for an empty query', () => {
    expect(filterGrocerySuggestions(values, '')).toEqual(values);
  });

  it('matches by substring, case-insensitively', () => {
    expect(filterGrocerySuggestions(values, 'organic')).toEqual(['Organic Valley']);
  });

  it('excludes an exact match — nothing to suggest over what is already typed', () => {
    expect(filterGrocerySuggestions(values, 'Kirkland')).toEqual([]);
  });

  it('caps at 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => `Brand ${i}`);
    expect(filterGrocerySuggestions(many, '')).toHaveLength(8);
  });
});
