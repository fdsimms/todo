import {
  planTrip,
  summarizeTrip,
  describeShopCoverage,
  joinNames,
  MAX_TRIP_STOPS,
} from '../utils/shoppingTrip';
import { groceryNameKey } from '../utils/groceryParse';
import { OTHER_AISLE } from '../utils/groceryAisles';
import type { GroceryItem, ItemShopLink, Shop } from '../types';

function makeShop(name: string, sortOrder = 0, overrides: Partial<Shop> = {}): Shop {
  return {
    id: `shop-${groceryNameKey(name).replace(/\s/g, '-')}`,
    name,
    nameKey: groceryNameKey(name),
    sortOrder,
    createdAt: '2026-01-01T00:00:00.000Z',
    excludeFromSuggestions: false,
    ...overrides,
  };
}

function makeItem(name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: `item-${groceryNameKey(name).replace(/\s/g, '-')}`,
    name,
    nameKey: groceryNameKey(name),
    aisle: OTHER_AISLE,
    quantity: null,
    note: '',
    onList: true,
    checked: false,
    inCatalog: true,
    sortOrder: 1,
    favorite: false,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    onHandUntil: null,
    sourceRecipeId: null,
    sourceRecipeTitle: null,
    ...overrides,
  };
}

function link(itemId: string, shopId: string, purchaseCount = 1): ItemShopLink {
  return { itemId, shopId, purchaseCount, lastPurchasedAt: null };
}

const tj = makeShop("Trader Joe's", 1);
const union = makeShop('Union Market', 2);
const pharmacy = makeShop('Ballard Pharmacy', 3);

const milk = makeItem('milk');
const bread = makeItem('bread');
const eggs = makeItem('eggs');
const shampoo = makeItem('shampoo');
const saffron = makeItem('saffron');

const LIST = [milk, bread, eggs, shampoo, saffron];

// Trader Joe's has milk/bread/eggs, the pharmacy has shampoo, nobody has
// saffron. Union Market overlaps Trader Joe's on milk only.
const LINKS = [
  link(milk.id, tj.id, 4),
  link(bread.id, tj.id, 2),
  link(eggs.id, tj.id, 1),
  link(shampoo.id, pharmacy.id, 3),
  link(milk.id, union.id, 1),
];

const SHOPS = [tj, union, pharmacy];

describe('planTrip', () => {
  it('ranks stores by how much of the list they carry', () => {
    const plan = planTrip(LIST, LINKS, SHOPS);
    expect(plan.itemIds).toEqual([milk.id, bread.id, eggs.id, shampoo.id, saffron.id]);
    expect(plan.coverage.map(c => [c.shop.name, c.itemIds.length])).toEqual([
      ["Trader Joe's", 3],
      ['Ballard Pharmacy', 1],
      ['Union Market', 1],
    ]);
  });

  it('keeps a store with no coverage in the list', () => {
    const aldi = makeShop('Aldi', 9);
    const plan = planTrip(LIST, LINKS, [...SHOPS, aldi]);
    const last = plan.coverage[plan.coverage.length - 1];
    expect(last.shop.name).toBe('Aldi');
    expect(last.itemIds).toEqual([]);
  });

  it('counts only what is on the list', () => {
    const offList = makeItem('paprika', { onList: false });
    const plan = planTrip([...LIST, offList], [...LINKS, link(offList.id, tj.id, 5)], SHOPS);
    expect(plan.itemIds).not.toContain(offList.id);
    expect(plan.coverage[0].itemIds).toEqual([milk.id, bread.id, eggs.id]);
  });

  it('counts a checked item — the trip has not happened yet', () => {
    const plan = planTrip(
      LIST.map(i => (i.id === milk.id ? { ...i, checked: true } : i)),
      LINKS,
      SHOPS
    );
    expect(plan.coverage[0].itemIds).toContain(milk.id);
  });

  it('counts a hand-asserted link, and says how many were asserted', () => {
    const plan = planTrip(LIST, [...LINKS, link(saffron.id, union.id, 0)], SHOPS);
    const unionCoverage = plan.coverage.find(c => c.shop.id === union.id)!;
    expect(unionCoverage.itemIds).toEqual([milk.id, saffron.id]);
    expect(unionCoverage.assertedCount).toBe(1);
  });

  it('drops a store flagged excludeFromSuggestions entirely', () => {
    const amazon = makeShop('Amazon', 0, { excludeFromSuggestions: true });
    const links = [...LINKS, ...LIST.map(i => link(i.id, amazon.id, 2))];
    const plan = planTrip(LIST, links, [...SHOPS, amazon]);
    expect(plan.coverage.map(c => c.shop.name)).not.toContain('Amazon');
    expect(plan.coverage[0].shop.name).toBe("Trader Joe's");
  });

  it('ignores a link naming a store that no longer exists', () => {
    const plan = planTrip(LIST, [...LINKS, link(saffron.id, 'shop-gone', 3)], SHOPS);
    expect(plan.coverage.reduce((n, c) => n + c.itemIds.length, 0)).toBe(LINKS.length);
  });

  it('breaks a coverage tie on purchases, then on the store order', () => {
    const a = makeShop('A store', 1);
    const b = makeShop('B store', 2);
    const c = makeShop('C store', 3);
    const plan = planTrip(
      [milk],
      [link(milk.id, a.id, 1), link(milk.id, b.id, 6), link(milk.id, c.id, 1)],
      [a, b, c]
    );
    expect(plan.coverage.map(x => x.shop.name)).toEqual(['B store', 'A store', 'C store']);
  });

  it('returns an empty plan for an empty list', () => {
    const plan = planTrip([], LINKS, SHOPS);
    expect(plan.itemIds).toEqual([]);
    expect(plan.coverage.every(c => c.itemIds.length === 0)).toBe(true);
  });
});

describe('summarizeTrip', () => {
  const plan = planTrip(LIST, LINKS, SHOPS);

  it('recommends the best store first when nothing is picked', () => {
    const summary = summarizeTrip([], plan);
    expect(summary.covered).toEqual([]);
    expect(summary.suggestion[0].shop.name).toBe("Trader Joe's");
  });

  it('follows the best store with whatever closes the gap', () => {
    const summary = summarizeTrip([], plan);
    // Union Market carries more of the list than the pharmacy overall, but
    // its only item is one Trader Joe's already covers — so the second stop
    // is the pharmacy, which adds something.
    expect(summary.suggestion.map(s => s.shop.name)).toEqual([
      "Trader Joe's",
      'Ballard Pharmacy',
    ]);
  });

  it('separates the gap from what no store carries', () => {
    const summary = summarizeTrip([tj.id], plan);
    expect(summary.covered).toEqual([milk.id, bread.id, eggs.id]);
    expect(summary.gap).toEqual([shampoo.id]);
    expect(summary.unknown).toEqual([saffron.id]);
    expect(summary.suggestion.map(s => s.shop.name)).toEqual(['Ballard Pharmacy']);
  });

  it('stops suggesting once the selection covers everything it can', () => {
    const summary = summarizeTrip([tj.id, pharmacy.id], plan);
    expect(summary.gap).toEqual([]);
    expect(summary.unknown).toEqual([saffron.id]);
    expect(summary.suggestion).toEqual([]);
  });

  it('never suggests a store that adds nothing', () => {
    // Union Market's milk is already covered, so it is not worth a stop.
    const summary = summarizeTrip([tj.id, pharmacy.id], plan);
    expect(summary.suggestion).toEqual([]);
  });

  it('caps the whole trip at three stops', () => {
    const items = Array.from({ length: 6 }, (_, i) => makeItem(`thing ${i}`));
    const shops = Array.from({ length: 6 }, (_, i) => makeShop(`Shop ${i}`, i));
    // One store per item, so a full cover would need six stops.
    const links = items.map((item, i) => link(item.id, shops[i].id, 1));
    const summary = summarizeTrip([], planTrip(items, links, shops));
    expect(summary.suggestion).toHaveLength(MAX_TRIP_STOPS);
  });

  it('leaves room for what is already picked when capping', () => {
    const items = Array.from({ length: 6 }, (_, i) => makeItem(`thing ${i}`));
    const shops = Array.from({ length: 6 }, (_, i) => makeShop(`Shop ${i}`, i));
    const links = items.map((item, i) => link(item.id, shops[i].id, 1));
    const built = planTrip(items, links, shops);
    const summary = summarizeTrip([shops[0].id, shops[1].id], built);
    expect(summary.suggestion).toHaveLength(1);
  });

  it('ignores a selected store that carries none of the list', () => {
    const aldi = makeShop('Aldi', 9);
    const built = planTrip(LIST, LINKS, [...SHOPS, aldi]);
    const summary = summarizeTrip([aldi.id], built);
    expect(summary.covered).toEqual([]);
    expect(summary.suggestion[0].shop.name).toBe("Trader Joe's");
  });

  it('has nothing to suggest when no store carries anything on the list', () => {
    const built = planTrip([saffron], LINKS, SHOPS);
    const summary = summarizeTrip([], built);
    expect(summary.unknown).toEqual([saffron.id]);
    expect(summary.suggestion).toEqual([]);
  });
});

describe('describeShopCoverage', () => {
  it('says nothing when the list is empty', () => {
    expect(describeShopCoverage(0, 0)).toBeNull();
  });

  it('names a full cover rather than counting it out', () => {
    expect(describeShopCoverage(12, 12)).toBe('All 12 items');
    expect(describeShopCoverage(1, 1)).toBe('The 1 item on your list');
  });

  it('counts a partial cover', () => {
    expect(describeShopCoverage(9, 12)).toBe('9 of 12 items');
  });

  it('is explicit about a store with none of it', () => {
    expect(describeShopCoverage(0, 12)).toBe('Nothing on your list');
  });
});

describe('joinNames', () => {
  it('joins up to the cap in prose', () => {
    expect(joinNames([])).toBe('');
    expect(joinNames(['bagels'])).toBe('bagels');
    expect(joinNames(['bagels', 'cilantro'])).toBe('bagels and cilantro');
    expect(joinNames(['bagels', 'cilantro', 'tofu'])).toBe('bagels, cilantro and tofu');
  });

  it('counts the overflow', () => {
    expect(joinNames(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more');
    expect(joinNames(['a', 'b', 'c', 'd'], 2)).toBe('a, b and 2 more');
  });
});
