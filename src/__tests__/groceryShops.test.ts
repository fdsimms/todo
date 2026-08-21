import {
  isAsserted,
  isUnavailable,
  shopsForItem,
  unavailableShopsFor,
  primaryShopFor,
  exclusiveShopFor,
  itemIdsForShop,
  itemCountsByShop,
  describeShops,
  withoutProductShopsFor,
} from '../utils/groceryShops';
import { groceryNameKey } from '../utils/groceryParse';
import { OTHER_AISLE } from '../utils/groceryAisles';
import type { GroceryItem, ItemProduct, ItemShopLink, Shop } from '../types';

function makeShop(name: string, sortOrder = 0): Shop {
  return {
    id: `shop-${groceryNameKey(name).replace(/\s/g, '-')}`,
    name,
    nameKey: groceryNameKey(name),
    sortOrder,
    createdAt: '2026-01-01T00:00:00.000Z',
    excludeFromSuggestions: false,
  };
}

function product(id: string, itemId: string, brand: string | null, variant: string | null): ItemProduct {
  return {
    id,
    itemId: `item-${itemId}`,
    brand,
    variant,
    productKey: `${brand ?? ''}|${variant ?? ''}`.toLowerCase(),
    rating: null,
    note: '',
    purchaseCount: 0,
    lastPurchasedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeItem(name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: `item-${groceryNameKey(name).replace(/\s/g, '-')}`,
    name,
    nameKey: groceryNameKey(name),
    preferredProductId: null,
    productStrict: false,
    aisle: OTHER_AISLE,
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    checked: false,
    inCatalog: true,
    sortOrder: 1,
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
    lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  };
}

function link(
  itemId: string,
  shopId: string,
  purchaseCount: number,
  lastPurchasedAt: string | null = null
): ItemShopLink {
  return {
    itemId, shopId, purchaseCount, lastPurchasedAt, unavailableAt: null,
    lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, priceHistory: [],
    productId: null, unavailableProductIds: {},
  };
}

/** "They don't have it here", optionally on top of a purchase history. */
function notAt(itemId: string, shopId: string, purchaseCount = 0): ItemShopLink {
  return {
    itemId,
    shopId,
    purchaseCount,
    lastPurchasedAt: null,
    unavailableAt: '2026-03-04T00:00:00.000Z',
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null, priceHistory: [],
    productId: null,
    unavailableProductIds: {},
  };
}

const costco = makeShop('Costco', 1);
const safeway = makeShop('Safeway', 2);
const traderJoes = makeShop("Trader Joe's", 3);
const SHOPS = [costco, safeway, traderJoes];

describe('isAsserted', () => {
  it('is true only for a link no purchase is behind', () => {
    expect(isAsserted(link('i', costco.id, 0))).toBe(true);
    expect(isAsserted(link('i', costco.id, 1))).toBe(false);
  });

  it('is false for a negative link, which also has no purchase behind it', () => {
    expect(isAsserted(notAt('i', costco.id))).toBe(false);
    expect(isUnavailable(notAt('i', costco.id))).toBe(true);
    expect(isUnavailable(link('i', costco.id, 0))).toBe(false);
  });
});

describe('unavailableShopsFor', () => {
  it('names the stores marked as not stocking it, and only those', () => {
    const links = [link('milk', costco.id, 3), notAt('milk', safeway.id), notAt('eggs', traderJoes.id)];
    expect(unavailableShopsFor('milk', links, SHOPS)).toEqual([safeway]);
  });

  it('includes a store with purchase history that has since stopped stocking it', () => {
    expect(unavailableShopsFor('milk', [notAt('milk', costco.id, 11)], SHOPS)).toEqual([costco]);
  });

  it('drops a link whose shop is gone, same as every other reader', () => {
    expect(unavailableShopsFor('milk', [notAt('milk', 'shop-deleted')], SHOPS)).toEqual([]);
  });
});

/**
 * The links in this file key items by bare id ('milk'), and the reads now take
 * the row itself — the brand rule is a fact about the item, not the link. Plain
 * and unbranded unless a case says otherwise.
 */
const item = (id: string, overrides: Partial<GroceryItem> = {}): GroceryItem =>
  makeItem(id, { id, ...overrides });

/** Everything the itemIdsForShop cases link to, so a link can resolve its row. */
const CATALOG = [item('milk'), item('eggs'), item('bread')];

describe('shopsForItem', () => {
  it('ranks by purchase count, most bought first', () => {
    const links = [
      link('milk', safeway.id, 2),
      link('milk', costco.id, 9),
      link('milk', traderJoes.id, 5),
    ];
    expect(shopsForItem(item('milk'), links, SHOPS).map(s => s.shop.name)).toEqual([
      'Costco',
      "Trader Joe's",
      'Safeway',
    ]);
  });

  it('breaks a tie on count with the more recent purchase', () => {
    const links = [
      link('milk', safeway.id, 3, '2026-01-10T00:00:00.000Z'),
      link('milk', costco.id, 3, '2026-06-01T00:00:00.000Z'),
    ];
    expect(shopsForItem(item('milk'), links, SHOPS).map(s => s.shop.name)).toEqual(['Costco', 'Safeway']);
  });

  it('ignores links belonging to other items', () => {
    const links = [link('milk', costco.id, 1), link('eggs', safeway.id, 4)];
    expect(shopsForItem(item('milk'), links, SHOPS).map(s => s.shop.name)).toEqual(['Costco']);
  });

  it('drops a link whose shop no longer exists rather than rendering a blank', () => {
    const links = [link('milk', costco.id, 2), link('milk', 'shop-deleted', 99)];
    expect(shopsForItem(item('milk'), links, SHOPS).map(s => s.shop.name)).toEqual(['Costco']);
  });

  it('carries the counts and dates through', () => {
    const links = [link('milk', costco.id, 4, '2026-05-05T00:00:00.000Z')];
    expect(shopsForItem(item('milk'), links, SHOPS)).toEqual([
      { shop: costco, purchaseCount: 4, lastPurchasedAt: '2026-05-05T00:00:00.000Z' },
    ]);
  });

  it('drops a store marked as not stocking it — this is the "where can I get it" read', () => {
    const links = [link('milk', costco.id, 2), notAt('milk', safeway.id)];
    expect(shopsForItem(item('milk'), links, SHOPS).map(s => s.shop.name)).toEqual(['Costco']);
  });

  it('drops it however many purchases it has behind it — the claim is about now', () => {
    expect(shopsForItem(item('milk'), [notAt('milk', costco.id, 11)], SHOPS)).toEqual([]);
  });
});

describe('product strictness', () => {
  // The item points at a product; the claim on a link names that same product.
  // Both halves have to line up for a store to be dropped — see
  // lacksPreferredProduct.
  const GOOD_CULTURE = 'p-good-culture';
  const strict = (productId: string | null = GOOD_CULTURE) =>
    item('milk', { preferredProductId: productId, productStrict: true });
  const gotHere = (shopId: string, productId: string | null, purchaseCount = 2) =>
    ({ ...link('milk', shopId, purchaseCount), productId });
  const noneHere = (shopId: string, purchaseCount = 2, productId = GOOD_CULTURE) => ({
    ...link('milk', shopId, purchaseCount),
    unavailableProductIds: { [productId]: '2026-03-04T00:00:00.000Z' },
  });

  it('drops a store the user has said hasn’t got their brand', () => {
    const links = [gotHere(costco.id, 'Good Culture'), noneHere(safeway.id)];
    expect(shopsForItem(strict(), links, SHOPS).map(s => s.shop.name)).toEqual(['Costco']);
  });

  // **The rule a store carrying several brands forces.** Having got Lucerne at
  // Safeway is a fact about one purchase, not about the shelf — Safeway may
  // stock Good Culture perfectly well. Reading the mismatch as an absence would
  // drop a store that has exactly what you want.
  it('keeps a store whose last brand was a different one', () => {
    const links = [gotHere(costco.id, 'Good Culture'), gotHere(safeway.id, 'Lucerne')];
    expect(shopsForItem(strict(), links, SHOPS).map(s => s.shop.name))
      .toEqual(['Costco', 'Safeway']);
  });

  // The other half of the same principle: never watched is never evidence.
  it('keeps a store whose brand was never recorded', () => {
    const links = [gotHere(costco.id, null), gotHere(safeway.id, null)];
    expect(shopsForItem(strict(), links, SHOPS).map(s => s.shop.name))
      .toEqual(['Costco', 'Safeway']);
  });

  it('changes nothing while the item is not strict', () => {
    const loose = item('milk', { preferredProductId: GOOD_CULTURE, productStrict: false });
    const links = [gotHere(costco.id, GOOD_CULTURE), noneHere(safeway.id)];
    expect(shopsForItem(loose, links, SHOPS).map(s => s.shop.name)).toEqual(['Costco', 'Safeway']);
  });

  it('changes nothing when the item is strict but names no product', () => {
    const none = item('milk', { preferredProductId: null, productStrict: true });
    expect(shopsForItem(none, [noneHere(safeway.id)], SHOPS).map(s => s.shop.name))
      .toEqual(['Safeway']);
  });

  it('carries through primaryShopFor and exclusiveShopFor', () => {
    const links = [gotHere(costco.id, GOOD_CULTURE, 1), noneHere(safeway.id, 9)];
    // Safeway is bought at far more often and still loses — it isn't a place
    // you can get this at all now.
    expect(primaryShopFor(strict(), links, SHOPS)).toEqual(costco);
    expect(exclusiveShopFor(strict(), links, SHOPS)).toEqual(costco);
  });

  it('leaves the store out of the Buy again filter and its count', () => {
    const milk = strict();
    const links = [noneHere(safeway.id)];
    expect(itemIdsForShop(safeway.id, links, [milk])).toEqual(new Set());
    expect(itemCountsByShop([milk], links).get(safeway.id)).toBeUndefined();
  });

  describe('withoutProductShopsFor', () => {
    it('names the stores the claim has been made about', () => {
      const links = [gotHere(costco.id, GOOD_CULTURE), noneHere(safeway.id)];
      expect(withoutProductShopsFor(strict(), links, SHOPS)).toEqual([safeway]);
    });

    it('never names a store merely observed with another product', () => {
      const links = [gotHere(safeway.id, 'p-lucerne')];
      expect(withoutProductShopsFor(strict(), links, SHOPS)).toEqual([]);
    });

    it('is empty when the item is not strict — no claim is in force', () => {
      const loose = item('milk', { preferredProductId: GOOD_CULTURE, productStrict: false });
      expect(withoutProductShopsFor(loose, [noneHere(safeway.id)], SHOPS)).toEqual([]);
    });

    // The whole reason the claims are keyed by product rather than stamped
    // once on the link: switching what you want must not inherit the evidence
    // you gathered about something else.
    it('ignores a claim about a product the item no longer prefers', () => {
      const switched = item('milk', { preferredProductId: 'p-lucerne', productStrict: true });
      expect(withoutProductShopsFor(switched, [noneHere(safeway.id)], SHOPS)).toEqual([]);
      expect(shopsForItem(switched, [noneHere(safeway.id)], SHOPS).map(s => s.shop.name))
        .toEqual(['Safeway']);
    });

    it('finds the claim again when the old preference comes back', () => {
      const links = [noneHere(safeway.id)];
      const switched = item('milk', { preferredProductId: 'p-lucerne', productStrict: true });
      expect(withoutProductShopsFor(switched, links, SHOPS)).toEqual([]);
      expect(withoutProductShopsFor(strict(), links, SHOPS)).toEqual([safeway]);
    });

    it('holds claims about several products of one item at one store', () => {
      const both = {
        ...link('milk', safeway.id, 2),
        unavailableProductIds: {
          [GOOD_CULTURE]: '2026-03-04T00:00:00.000Z',
          'p-lucerne': '2026-03-05T00:00:00.000Z',
        },
      };
      expect(withoutProductShopsFor(strict(), [both], SHOPS)).toEqual([safeway]);
      expect(withoutProductShopsFor(
        item('milk', { preferredProductId: 'p-lucerne', productStrict: true }), [both], SHOPS
      )).toEqual([safeway]);
    });
  });

  it('says so in the item sheet footnote, without calling it "not at"', () => {
    const milk = item('milk', { preferredProductId: GOOD_CULTURE, productStrict: true, purchaseCount: 7 });
    const links = [gotHere(costco.id, GOOD_CULTURE, 7), noneHere(safeway.id, 0)];
    const products = [product(GOOD_CULTURE, 'milk', 'Good Culture', null)];
    expect(describeShops(milk, links, SHOPS, products)).toBe(
      'Bought 7 times · only at Costco · no Good Culture at Safeway'
    );
  });
});

describe('primaryShopFor', () => {
  it('is the most-bought store', () => {
    const links = [link('milk', safeway.id, 1), link('milk', costco.id, 6)];
    expect(primaryShopFor(item('milk'), links, SHOPS)).toEqual(costco);
  });

  it('never promotes a hand-asserted link — that would invent a habit', () => {
    expect(primaryShopFor(item('milk'), [link('milk', costco.id, 0)], SHOPS)).toBeNull();
  });

  it('picks the observed store over an asserted one', () => {
    const links = [link('milk', costco.id, 0), link('milk', safeway.id, 1)];
    expect(primaryShopFor(item('milk'), links, SHOPS)).toEqual(safeway);
  });

  it('is null when nothing is linked', () => {
    expect(primaryShopFor(item('milk'), [], SHOPS)).toBeNull();
  });
});

describe('exclusiveShopFor', () => {
  it('is the store when exactly one is linked', () => {
    expect(exclusiveShopFor(item('milk'), [link('milk', costco.id, 3)], SHOPS)).toEqual(costco);
  });

  it('counts an assertion — "only here" is a claim about availability', () => {
    expect(exclusiveShopFor(item('milk'), [link('milk', costco.id, 0)], SHOPS)).toEqual(costco);
  });

  it('is null with two stores', () => {
    const links = [link('milk', costco.id, 3), link('milk', safeway.id, 1)];
    expect(exclusiveShopFor(item('milk'), links, SHOPS)).toBeNull();
  });

  it('is null with none', () => {
    expect(exclusiveShopFor(item('milk'), [], SHOPS)).toBeNull();
  });

  it('does not count a store marked as not stocking it', () => {
    const links = [link('milk', costco.id, 3), notAt('milk', safeway.id)];
    expect(exclusiveShopFor(item('milk'), links, SHOPS)).toEqual(costco);
  });
});

describe('itemIdsForShop', () => {
  it('collects the items linked to one store', () => {
    const links = [
      link('milk', costco.id, 2),
      link('eggs', costco.id, 0),
      link('bread', safeway.id, 5),
    ];
    expect(itemIdsForShop(costco.id, links, CATALOG)).toEqual(new Set(['milk', 'eggs']));
  });

  it('is empty for a store with nothing linked', () => {
    expect(itemIdsForShop(traderJoes.id, [link('milk', costco.id, 1)], CATALOG)).toEqual(new Set());
  });

  it('leaves out what the store was marked as not stocking', () => {
    const links = [link('milk', costco.id, 2), notAt('eggs', costco.id)];
    expect(itemIdsForShop(costco.id, links, CATALOG)).toEqual(new Set(['milk']));
  });
});

describe('itemCountsByShop', () => {
  it('counts links per store', () => {
    const items = [makeItem('Milk'), makeItem('Eggs')];
    const links = [
      link(items[0].id, costco.id, 3),
      link(items[1].id, costco.id, 1),
      link(items[1].id, safeway.id, 2),
    ];
    const counts = itemCountsByShop(items, links);
    expect(counts.get(costco.id)).toBe(2);
    expect(counts.get(safeway.id)).toBe(1);
    expect(counts.has(traderJoes.id)).toBe(false);
  });

  it('skips a link whose item is gone, so a chip cannot over-promise', () => {
    const items = [makeItem('Milk')];
    const links = [link(items[0].id, costco.id, 1), link('item-deleted', costco.id, 4)];
    expect(itemCountsByShop(items, links).get(costco.id)).toBe(1);
  });

  it('skips a negative link, so the chip agrees with what the filter shows', () => {
    const items = [makeItem('Milk'), makeItem('Eggs')];
    const links = [link(items[0].id, costco.id, 1), notAt(items[1].id, costco.id)];
    expect(itemCountsByShop(items, links).get(costco.id)).toBe(1);
  });
});

describe('describeShops', () => {
  const milk = makeItem('Milk', { id: 'milk', purchaseCount: 7 });

  it('says only the purchase count when no store is linked', () => {
    expect(describeShops(milk, [], SHOPS)).toBe('Bought 7 times');
  });

  it('is null for an item with no history at all', () => {
    expect(describeShops(makeItem('Milk', { id: 'milk' }), [], SHOPS)).toBeNull();
  });

  it('singularises one purchase', () => {
    const once = makeItem('Milk', { id: 'milk', purchaseCount: 1 });
    expect(describeShops(once, [], SHOPS)).toBe('Bought 1 time');
  });

  it('says "only at" when the single linked store is the whole story', () => {
    expect(describeShops(milk, [link('milk', costco.id, 7)], SHOPS)).toBe(
      'Bought 7 times · only at Costco'
    );
  });

  it('says "usually" once two stores are observed', () => {
    const links = [link('milk', costco.id, 6), link('milk', safeway.id, 1)];
    expect(describeShops(milk, links, SHOPS)).toBe('Bought 7 times · usually Costco');
  });

  // The invariant: the item's count is the total, per-store counts are partial.
  // 7 purchases with 6 recorded at Costco must not read as "6 of 7" or claim
  // anything about the seventh.
  it('does not reconcile the totals when a trip carried no store', () => {
    expect(describeShops(milk, [link('milk', costco.id, 6)], SHOPS)).toBe(
      'Bought 7 times · only at Costco'
    );
  });

  it('will not say "only at" when another store is asserted by hand', () => {
    const links = [link('milk', costco.id, 6), link('milk', safeway.id, 0)];
    expect(describeShops(milk, links, SHOPS)).toBe('Bought 7 times · usually Costco');
  });

  it('words a purely asserted item as the user’s claim, not as history', () => {
    const fresh = makeItem('Milk', { id: 'milk' });
    expect(describeShops(fresh, [link('milk', costco.id, 0)], SHOPS)).toBe('You get it at Costco');
  });

  it('lists several asserted stores', () => {
    const fresh = makeItem('Milk', { id: 'milk' });
    const links = [link('milk', costco.id, 0), link('milk', safeway.id, 0)];
    expect(describeShops(fresh, links, SHOPS)).toBe('You get it at Costco, Safeway');
  });

  it('keeps the count alongside a purely asserted store', () => {
    // Bought before stores existed, then tagged by hand.
    expect(describeShops(milk, [link('milk', costco.id, 0)], SHOPS)).toBe(
      'Bought 7 times · you get it at Costco'
    );
  });

  it('adds where it is not stocked as its own trailing clause', () => {
    const links = [link('milk', costco.id, 7), notAt('milk', safeway.id)];
    expect(describeShops(milk, links, SHOPS)).toBe(
      'Bought 7 times · only at Costco · not at Safeway'
    );
  });

  it('says only that, when a negative is all there is to say', () => {
    const fresh = makeItem('Milk', { id: 'milk' });
    expect(describeShops(fresh, [notAt('milk', safeway.id)], SHOPS)).toBe('Not at Safeway');
  });

  it('keeps the count when the only store on record has stopped stocking it', () => {
    expect(describeShops(milk, [notAt('milk', costco.id, 7)], SHOPS)).toBe(
      'Bought 7 times · not at Costco'
    );
  });

  it('lists several, in store order', () => {
    const links = [notAt('milk', safeway.id), notAt('milk', costco.id)];
    expect(describeShops(milk, links, SHOPS)).toBe('Bought 7 times · not at Costco, Safeway');
  });
});
