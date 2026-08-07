import {
  rankGrocerySuggestions,
  buyAgainItems,
  buildGrocerySections,
  catalogPruneCandidates,
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
    aisle: 'Other',
    quantity: null,
    note: '',
    onList: false,
    checked: false,
    sortOrder: seq,
    favorite: false,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: daysAgo(365),
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

  it('floats a favourite up', () => {
    const items = [
      makeItem({ name: 'Plain', purchaseCount: 3, lastPurchasedAt: daysAgo(5) }),
      makeItem({ name: 'Starred', purchaseCount: 3, lastPurchasedAt: daysAgo(5), favorite: true }),
    ];
    expect(buyAgainItems(items, NOW)[0].name).toBe('Starred');
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

  it('never names a favourite', () => {
    const items = [makeItem({ name: 'Truffle oil', favorite: true, lastAddedAt: daysAgo(200) })];
    expect(catalogPruneCandidates(items, NOW)).toEqual([]);
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
