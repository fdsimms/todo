import {
  planTrip,
  summarizeTrip,
  describeShopCoverage,
  joinNames,
  MAX_TRIP_STOPS,
  SHOP_RECORD_MIN,
  AISLE_EVIDENCE_MIN,
  type ShopCoverage,
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
    choiceGroup: null,
    ...overrides,
  };
}

function link(itemId: string, shopId: string, purchaseCount = 1): ItemShopLink {
  return { itemId, shopId, purchaseCount, lastPurchasedAt: null, unavailableAt: null };
}

/** The user's own "they don't have it", which no aisle guess may overrule. */
function notAt(itemId: string, shopId: string, purchaseCount = 0): ItemShopLink {
  return {
    itemId,
    shopId,
    purchaseCount,
    lastPurchasedAt: null,
    unavailableAt: '2026-03-04T00:00:00.000Z',
  };
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

describe('planTrip — the aisle guess', () => {
  // A store with a broad record in one aisle, and one on-list item from that
  // aisle it has never been seen with.
  const bagels = makeItem('bagels', { aisle: 'Bakery' });
  const rye = makeItem('rye', { aisle: 'Bakery' });
  const baguette = makeItem('baguette', { aisle: 'Bakery' });
  const apples = makeItem('apples', { aisle: 'Produce' });

  function bakeryRecord(shop: Shop, count: number): ItemShopLink[] {
    return [rye, baguette, apples].slice(0, count).map(i => link(i.id, shop.id, 1));
  }

  it('credits an item it has never seen, when the store stocks that aisle', () => {
    const catalog = [bagels, rye, baguette, apples].map(i => ({ ...i, onList: i.id === bagels.id }));
    const plan = planTrip(catalog, bakeryRecord(union, 3), [union]);
    const entry = plan.coverage[0];
    expect(entry.itemIds).toEqual([]);
    expect(entry.likelyItemIds).toEqual([bagels.id]);
  });

  it('needs more than one item from the aisle before it claims one', () => {
    const catalog = [bagels, rye, baguette, apples].map(i => ({ ...i, onList: i.id === bagels.id }));
    // Three items on record, but only one of them from Bakery.
    const thin = [link(rye.id, union.id, 1), link(apples.id, union.id, 1), link(milk.id, union.id, 1)];
    const plan = planTrip([...catalog, milk], thin, [union]);
    expect(plan.coverage[0].likelyItemIds).toEqual([]);
    expect(AISLE_EVIDENCE_MIN).toBe(2);
  });

  it('stays quiet about a store the app has barely seen', () => {
    const catalog = [bagels, rye, baguette].map(i => ({ ...i, onList: i.id === bagels.id }));
    const plan = planTrip(catalog, bakeryRecord(union, SHOP_RECORD_MIN - 1), [union]);
    expect(plan.coverage[0].likelyItemIds).toEqual([]);
  });

  it('never guesses from Other, which is the bucket every unknown name lands in', () => {
    const odds = [makeItem('a'), makeItem('b'), makeItem('c')];
    const target = makeItem('something odd');
    const catalog = [...odds.map(i => ({ ...i, onList: false })), target];
    const plan = planTrip(
      catalog,
      odds.map(i => link(i.id, union.id, 1)),
      [union]
    );
    expect(plan.coverage[0].likelyItemIds).toEqual([]);
  });

  it('never folds the guess into what was seen', () => {
    const catalog = [bagels, rye, baguette, apples].map(i => ({ ...i, onList: true }));
    const plan = planTrip(catalog, bakeryRecord(union, 3), [union]);
    const entry = plan.coverage[0];
    expect(entry.itemIds).toEqual([rye.id, baguette.id, apples.id]);
    expect(entry.likelyItemIds).toEqual([bagels.id]);
  });

  it('never guesses an item the user said the store does not have', () => {
    const catalog = [bagels, rye, baguette, apples].map(i => ({ ...i, onList: i.id === bagels.id }));
    const plan = planTrip(
      catalog,
      [...bakeryRecord(union, 3), notAt(bagels.id, union.id)],
      [union]
    );
    const entry = plan.coverage[0];
    expect(entry.likelyItemIds).toEqual([]);
    expect(entry.unavailableItemIds).toEqual([bagels.id]);
  });

  it('does not let negatives alone earn a store the right to guess', () => {
    const catalog = [bagels, rye, baguette, apples].map(i => ({ ...i, onList: i.id === bagels.id }));
    // Three Bakery items on record, all of them "they don't have it" — which is
    // knowledge about the shop but not about its range.
    const plan = planTrip(
      catalog,
      [rye, baguette, apples].map(i => notAt(i.id, union.id)),
      [union]
    );
    expect(plan.coverage[0].recordedItems).toBe(0);
    expect(plan.coverage[0].likelyItemIds).toEqual([]);
  });

  it('ranks a known item over a guessed one', () => {
    const guesser = makeShop('Big Market', 1);
    const knower = makeShop('Corner Shop', 2);
    const catalog = [bagels, rye, baguette, apples].map(i => ({ ...i, onList: i.id === bagels.id }));
    const plan = planTrip(
      catalog,
      [...bakeryRecord(guesser, 3), link(bagels.id, knower.id, 1)],
      [guesser, knower]
    );
    expect(plan.coverage.map(c => c.shop.name)).toEqual(['Corner Shop', 'Big Market']);
  });

  it('lets the aisle guess break a tie between two stores with nothing seen', () => {
    const stocks = makeShop('Bakery-ish', 1);
    const doesnt = makeShop('Hardware-ish', 2);
    const catalog = [bagels, rye, baguette, apples].map(i => ({ ...i, onList: i.id === bagels.id }));
    const plan = planTrip(
      catalog,
      [...bakeryRecord(stocks, 3), ...[rye, apples, milk].map(i => link(i.id, doesnt.id, 1))],
      [stocks, doesnt]
    );
    // Neither has ever sold the user a bagel; only one of them sells bakery.
    expect(plan.coverage[0].shop.name).toBe('Bakery-ish');
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

  it('puts what the picked store was said not to stock in its own bucket', () => {
    // Trader Joe's carries milk/bread/eggs; the user has said it doesn't have
    // saffron, which nothing else carries either.
    const built = planTrip(LIST, [...LINKS, notAt(saffron.id, tj.id)], SHOPS);
    const summary = summarizeTrip([tj.id], built);
    expect(summary.covered).toEqual([milk.id, bread.id, eggs.id]);
    expect(summary.missing).toEqual([saffron.id]);
    expect(summary.gap).toEqual([shampoo.id]);
    expect(summary.unknown).toEqual([]);
  });

  it('leaves an unpicked store’s negatives out of it', () => {
    const built = planTrip(LIST, [...LINKS, notAt(saffron.id, union.id)], SHOPS);
    const summary = summarizeTrip([tj.id], built);
    expect(summary.missing).toEqual([]);
    expect(summary.unknown).toEqual([saffron.id]);
  });

  it('sends you to a second stop for something the first was said not to have', () => {
    // Shampoo is at the pharmacy, and the user has said Trader Joe's lacks it —
    // which is a stronger reason for the second stop, not a weaker one.
    const built = planTrip(LIST, [...LINKS, notAt(shampoo.id, tj.id)], SHOPS);
    const summary = summarizeTrip([tj.id], built);
    expect(summary.missing).toEqual([shampoo.id]);
    expect(summary.suggestion.map(s => s.shop.name)).toEqual(['Ballard Pharmacy']);
  });

  it('prefers "probably" from one picked store over "not there" at another', () => {
    const bagels = makeItem('bagels', { aisle: 'Bakery' });
    const rye = makeItem('rye', { aisle: 'Bakery', onList: false });
    const baguette = makeItem('baguette', { aisle: 'Bakery', onList: false });
    const apples = makeItem('apples', { aisle: 'Produce', onList: false });
    const built = planTrip(
      [bagels, rye, baguette, apples],
      [...[rye, baguette, apples].map(i => link(i.id, union.id, 1)), notAt(bagels.id, tj.id)],
      [union, tj]
    );
    const summary = summarizeTrip([union.id, tj.id], built);
    expect(summary.likely).toEqual([bagels.id]);
    expect(summary.missing).toEqual([]);
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

  it('keeps a guessed item out of the covered count and in its own bucket', () => {
    const bagels = makeItem('bagels', { aisle: 'Bakery' });
    const rye = makeItem('rye', { aisle: 'Bakery', onList: false });
    const baguette = makeItem('baguette', { aisle: 'Bakery', onList: false });
    const apples = makeItem('apples', { aisle: 'Produce', onList: false });
    const built = planTrip(
      [bagels, rye, baguette, apples],
      [rye, baguette, apples].map(i => link(i.id, union.id, 1)),
      [union]
    );
    const summary = summarizeTrip([union.id], built);
    expect(summary.covered).toEqual([]);
    expect(summary.likely).toEqual([bagels.id]);
    expect(summary.unknown).toEqual([]);
  });

  it('calls an item unknown only when nothing anywhere speaks to it', () => {
    const bagels = makeItem('bagels', { aisle: 'Bakery' });
    const rye = makeItem('rye', { aisle: 'Bakery', onList: false });
    const baguette = makeItem('baguette', { aisle: 'Bakery', onList: false });
    const apples = makeItem('apples', { aisle: 'Produce', onList: false });
    const built = planTrip(
      [bagels, rye, baguette, apples, saffron],
      [rye, baguette, apples].map(i => link(i.id, union.id, 1)),
      [union, tj]
    );
    const summary = summarizeTrip([tj.id], built);
    // The bakery-stocking store hasn't been picked, so bagels is a maybe
    // rather than an unknown — the app has *something* to say about it.
    expect(summary.maybe).toEqual([bagels.id]);
    expect(summary.unknown).toEqual([saffron.id]);
    expect(summary.suggestion.map(s => s.shop.name)).toEqual(['Union Market']);
  });

  it('has nothing to suggest when no store carries anything on the list', () => {
    const built = planTrip([saffron], LINKS, SHOPS);
    const summary = summarizeTrip([], built);
    expect(summary.unknown).toEqual([saffron.id]);
    expect(summary.suggestion).toEqual([]);
  });
});

describe('describeShopCoverage', () => {
  function entry(known: number, likely = 0, recordedItems = 20, absent = 0): ShopCoverage {
    return {
      shop: tj,
      itemIds: Array.from({ length: known }, (_, i) => `k${i}`),
      likelyItemIds: Array.from({ length: likely }, (_, i) => `l${i}`),
      unavailableItemIds: Array.from({ length: absent }, (_, i) => `n${i}`),
      assertedCount: 0,
      observedPurchases: 0,
      recordedItems,
    };
  }

  it('says nothing when the list is empty', () => {
    expect(describeShopCoverage(entry(0), 0)).toBeNull();
  });

  it('names a full cover rather than counting it out', () => {
    expect(describeShopCoverage(entry(12), 12)).toBe('All 12 seen here');
  });

  it('counts a partial cover as what has been seen, not what is stocked', () => {
    expect(describeShopCoverage(entry(9), 12)).toBe('9 of 12 seen here');
  });

  it('keeps the guess in its own clause', () => {
    expect(describeShopCoverage(entry(9, 2), 12)).toBe('9 of 12 seen here · 2 more likely');
  });

  it('never claims a store lacks the list — only that nothing was seen', () => {
    expect(describeShopCoverage(entry(0), 12)).toBe('None of your list seen here');
  });

  it('distinguishes a store the app knows nothing about', () => {
    expect(describeShopCoverage(entry(0, 0, 0), 12)).toBe('Nothing on record here yet');
  });

  it('states the stated absences last, as their own clause', () => {
    expect(describeShopCoverage(entry(9, 2, 20, 1), 12)).toBe(
      '9 of 12 seen here · 2 more likely · 1 they don’t have'
    );
    expect(describeShopCoverage(entry(9, 0, 20, 3), 12)).toBe(
      '9 of 12 seen here · 3 they don’t have'
    );
  });

  it('does not say "nothing on record yet" about a store you have answered for', () => {
    expect(describeShopCoverage(entry(0, 0, 0, 2), 12)).toBe(
      'Nothing on record here to go on · 2 they don’t have'
    );
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
