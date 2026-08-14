import {
  TRIP_MAX_MS,
  TRIP_STALE_MS,
  isTripLive,
  isTripStale,
  describeTripElapsed,
  resolveActiveTrip,
  tripMarkerFor,
  describeTripMarker,
} from '../utils/activeTrip';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem, ItemShopLink, ItemSubLink, Shop } from '../types';

function makeShop(name: string, overrides: Partial<Shop> = {}): Shop {
  return {
    id: `shop-${groceryNameKey(name).replace(/\s/g, '-')}`,
    name,
    nameKey: groceryNameKey(name),
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    excludeFromSuggestions: false,
    ...overrides,
  };
}

function link(
  itemId: string,
  shopId: string,
  purchaseCount: number,
  overrides: Partial<ItemShopLink> = {}
): ItemShopLink {
  return {
    itemId,
    shopId,
    purchaseCount,
    lastPurchasedAt: purchaseCount > 0 ? '2026-08-01T00:00:00.000Z' : null,
    unavailableAt: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    brand: null,
    brandUnavailableAt: null,
    ...overrides,
  };
}

function subLink(itemId: string, subItemId: string, createdAt: string): ItemSubLink {
  return { itemId, subItemId, note: null, createdAt, ratioFrom: null, ratioTo: null };
}

/**
 * The marker rules are a fact about the item as well as the link — a brand rule
 * lives on the row — so the reads take one. Plain and unbranded unless a test
 * says otherwise, which is the shape every case here predating brands wants.
 */
function item(id: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id,
    name: id,
    nameKey: id,
    brand: null,
    brandStrict: false,
    variant: null,
    aisle: 'Other',
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: true,
    checked: false,
    inCatalog: true,
    sortOrder: 0,
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
    useUpTask: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    ...overrides,
  };
}

const safeway = makeShop('Safeway');
const traderJoes = makeShop("Trader Joe's");
const costco = makeShop('Costco');
const NOW = new Date('2026-08-12T18:00:00.000Z');

describe('isTripLive', () => {
  it('is false with no stamp', () => {
    expect(isTripLive(null, NOW)).toBe(false);
  });

  it('is false for an unparseable stamp', () => {
    expect(isTripLive('not a date', NOW)).toBe(false);
  });

  it('is true just after starting', () => {
    expect(isTripLive('2026-08-12T17:59:00.000Z', NOW)).toBe(true);
  });

  it('is true right up to the window', () => {
    const started = new Date(NOW.getTime() - TRIP_MAX_MS + 1000).toISOString();
    expect(isTripLive(started, NOW)).toBe(true);
  });

  it('is false once the window has passed', () => {
    const started = new Date(NOW.getTime() - TRIP_MAX_MS - 1000).toISOString();
    expect(isTripLive(started, NOW)).toBe(false);
  });

  // The case the whole design exists for: a Saturday-evening trip must not
  // still be marking rows up on Sunday morning.
  it('is false the next morning', () => {
    expect(isTripLive('2026-08-11T19:00:00.000Z', NOW)).toBe(false);
  });

  it('treats a future stamp as live rather than expired', () => {
    expect(isTripLive('2026-08-12T19:00:00.000Z', NOW)).toBe(true);
  });
});

describe('isTripStale', () => {
  it('is false with no stamp', () => {
    expect(isTripStale(null, NOW)).toBe(false);
  });

  it('is false for an unparseable stamp', () => {
    expect(isTripStale('not a date', NOW)).toBe(false);
  });

  it('is false just under the threshold', () => {
    const started = new Date(NOW.getTime() - TRIP_STALE_MS + 1000).toISOString();
    expect(isTripStale(started, NOW)).toBe(false);
  });

  it('is true right at the threshold', () => {
    const started = new Date(NOW.getTime() - TRIP_STALE_MS).toISOString();
    expect(isTripStale(started, NOW)).toBe(true);
  });

  it('is true well past the threshold', () => {
    const started = new Date(NOW.getTime() - TRIP_STALE_MS - 60 * 60 * 1000).toISOString();
    expect(isTripStale(started, NOW)).toBe(true);
  });
});

describe('describeTripElapsed', () => {
  it('renders minutes under an hour', () => {
    const started = new Date(NOW.getTime() - 24 * 60 * 1000).toISOString();
    expect(describeTripElapsed(started, NOW)).toBe('24 min');
  });

  it('renders an exact hour with no minutes clause', () => {
    const started = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
    expect(describeTripElapsed(started, NOW)).toBe('1h');
  });

  it('renders hours and minutes together', () => {
    const started = new Date(NOW.getTime() - (60 + 42) * 60 * 1000).toISOString();
    expect(describeTripElapsed(started, NOW)).toBe('1h 42m');
  });

  it('floors at 0 minutes for a future stamp', () => {
    const started = new Date(NOW.getTime() + 60 * 1000).toISOString();
    expect(describeTripElapsed(started, NOW)).toBe('0 min');
  });
});

describe('resolveActiveTrip', () => {
  const shops = [safeway, traderJoes];
  const fresh = '2026-08-12T17:30:00.000Z';

  it('resolves a live trip to its shop', () => {
    expect(resolveActiveTrip(safeway.id, fresh, shops, NOW)).toEqual(safeway);
  });

  it('is null with no shop id', () => {
    expect(resolveActiveTrip(null, fresh, shops, NOW)).toBeNull();
  });

  it('is null once the trip has aged out', () => {
    expect(resolveActiveTrip(safeway.id, '2026-08-11T19:00:00.000Z', shops, NOW)).toBeNull();
  });

  // Same resolve-or-shrug initialize() applies to lastShopId: the setting
  // outlives the store it names.
  it('is null when the shop has been deleted since', () => {
    expect(resolveActiveTrip(costco.id, fresh, shops, NOW)).toBeNull();
  });

  it('is null when the stamp is missing but the id is not', () => {
    expect(resolveActiveTrip(safeway.id, null, shops, NOW)).toBeNull();
  });
});

describe('tripMarkerFor', () => {
  const shops = [safeway, traderJoes, costco];

  it('says nothing about an item bought at this store', () => {
    const links = [link('milk', safeway.id, 4)];
    expect(tripMarkerFor(item('milk'), links, shops, safeway)).toBeNull();
  });

  it('says nothing about an item merely asserted to be at this store', () => {
    const links = [link('milk', safeway.id, 0)];
    expect(tripMarkerFor(item('milk'), links, shops, safeway)).toBeNull();
  });

  // Ignorance is not evidence — the reason most of a first-ever trip is silent.
  it('says nothing about an item nothing is known about', () => {
    expect(tripMarkerFor(item('tahini'), [], shops, safeway)).toBeNull();
  });

  it('reports a store the user marked as not stocking it', () => {
    const links = [link('tahini', safeway.id, 0, { unavailableAt: '2026-08-01T00:00:00.000Z' })];
    expect(tripMarkerFor(item('tahini'), links, shops, safeway)).toEqual({
      kind: 'unavailable',
      shop: safeway,
    });
  });

  // The negative is the current state and the count is history.
  it('reports unavailable even when it was bought here before', () => {
    const links = [link('tahini', safeway.id, 11, { unavailableAt: '2026-08-01T00:00:00.000Z' })];
    expect(tripMarkerFor(item('tahini'), links, shops, safeway)).toEqual({
      kind: 'unavailable',
      shop: safeway,
    });
  });

  it('reports the one other store on record', () => {
    const links = [link('tahini', traderJoes.id, 3)];
    expect(tripMarkerFor(item('tahini'), links, shops, safeway)).toEqual({
      kind: 'only',
      shop: traderJoes,
    });
  });

  it('counts a hand-assertion as "only"', () => {
    const links = [link('tahini', traderJoes.id, 0)];
    expect(tripMarkerFor(item('tahini'), links, shops, safeway)).toEqual({
      kind: 'only',
      shop: traderJoes,
    });
  });

  it('falls back to "usually" when several other stores are on record', () => {
    const links = [link('tahini', traderJoes.id, 5), link('tahini', costco.id, 1)];
    expect(tripMarkerFor(item('tahini'), links, shops, safeway)).toEqual({
      kind: 'usually',
      shop: traderJoes,
    });
  });

  // "usually" needs an observation; an assertion alone can't invent a habit.
  it('says nothing when the other stores are all assertions and there are several', () => {
    const links = [link('tahini', traderJoes.id, 0), link('tahini', costco.id, 0)];
    expect(tripMarkerFor(item('tahini'), links, shops, safeway)).toBeNull();
  });

  it('ignores a store marked unavailable when naming where else to go', () => {
    const links = [
      link('tahini', traderJoes.id, 3),
      link('tahini', costco.id, 9, { unavailableAt: '2026-08-01T00:00:00.000Z' }),
    ];
    expect(tripMarkerFor(item('tahini'), links, shops, safeway)).toEqual({
      kind: 'only',
      shop: traderJoes,
    });
  });

  it('never points at a store excluded from suggestions', () => {
    const amazon = makeShop('Amazon', { excludeFromSuggestions: true });
    const links = [link('tahini', amazon.id, 6)];
    expect(tripMarkerFor(item('tahini'), links, [...shops, amazon], safeway)).toBeNull();
  });

  it('drops a link whose shop no longer exists', () => {
    const links = [link('tahini', 'shop-gone', 3)];
    expect(tripMarkerFor(item('tahini'), links, shops, safeway)).toBeNull();
  });

  it('is silent about other items on the list', () => {
    const links = [link('tahini', traderJoes.id, 3)];
    expect(tripMarkerFor(item('milk'), links, shops, safeway)).toBeNull();
  });
  describe('a brand rule', () => {
    const strict = item('milk', { brand: 'Good Culture', brandStrict: true });
    const NO_BRAND = { brandUnavailableAt: '2026-08-01T00:00:00.000Z' };

    // The case the feature exists for: this store has a link, so before brands
    // it said nothing at all — which is exactly the silence being complained
    // about while standing in front of the wrong tub.
    it('speaks up about a store the user has said hasn’t got their brand', () => {
      const links = [link('milk', safeway.id, 3, NO_BRAND)];
      expect(tripMarkerFor(strict, links, shops, safeway)).toEqual({
        kind: 'withoutBrand',
        shop: safeway,
        wantedBrand: 'Good Culture',
      });
    });

    // A shelf holds several brands, so getting Lucerne here once says nothing
    // about whether Good Culture is beside it. Silence is the honest answer.
    it('says nothing about a store merely observed with a different brand', () => {
      const links = [link('milk', safeway.id, 3, { brand: 'Lucerne' })];
      expect(tripMarkerFor(strict, links, shops, safeway)).toBeNull();
    });

    it('says nothing when this store’s brand was never recorded', () => {
      expect(tripMarkerFor(strict, [link('milk', safeway.id, 3)], shops, safeway)).toBeNull();
    });

    it('says nothing at all when the item is not strict', () => {
      const loose = item('milk', { brand: 'Good Culture', brandStrict: false });
      const links = [link('milk', safeway.id, 3, NO_BRAND)];
      expect(tripMarkerFor(loose, links, shops, safeway)).toBeNull();
    });

    it('lets "they do not stock it" outrank it — the stronger claim wins', () => {
      const links = [
        link('milk', safeway.id, 3, { ...NO_BRAND, unavailableAt: '2026-03-04T00:00:00.000Z' }),
      ];
      expect(tripMarkerFor(strict, links, shops, safeway)?.kind).toBe('unavailable');
    });

    // Marked stores are dropped from every "where can I get this" read, so
    // "only at" now means "only at, of the places you haven't ruled out".
    it('reads "only at" past a store that has been ruled out', () => {
      const links = [
        link('milk', costco.id, 2),
        link('milk', traderJoes.id, 4, NO_BRAND),
      ];
      expect(tripMarkerFor(strict, links, shops, safeway)).toEqual({ kind: 'only', shop: costco });
    });
  });

  // The highest-value moment for a substitute link (#1567): standing in
  // front of the empty shelf. `subLinks`/`items` default to empty, so every
  // call above this block — none of which passes them — still gets exactly
  // the marker it always did; toEqual ignores an undefined `substitute`.
  describe('a substitute clause', () => {
    const margarine = item('margarine', { name: 'Margarine' });
    const ghee = item('ghee', { name: 'Ghee' });
    const butter = item('butter', { name: 'Butter' });
    const unavailableHere = [
      link('butter', safeway.id, 0, { unavailableAt: '2026-08-01T00:00:00.000Z' }),
    ];

    it('names the substitute on record', () => {
      const subs = [subLink('butter', 'margarine', '2026-01-01T00:00:00.000Z')];
      const marker = tripMarkerFor(butter, unavailableHere, shops, safeway, subs, [butter, margarine]);
      expect(marker).toEqual({ kind: 'unavailable', shop: safeway, substitute: margarine });
    });

    it('says nothing extra when no substitute is on record', () => {
      const marker = tripMarkerFor(butter, unavailableHere, shops, safeway);
      expect(marker).toEqual({ kind: 'unavailable', shop: safeway });
      expect(marker?.substitute).toBeUndefined();
    });

    it('picks the oldest link when more than one substitute is on record', () => {
      const subs = [
        subLink('butter', 'ghee', '2026-02-01T00:00:00.000Z'),
        subLink('butter', 'margarine', '2026-01-01T00:00:00.000Z'),
      ];
      const marker = tripMarkerFor(butter, unavailableHere, shops, safeway, subs, [butter, ghee, margarine]);
      expect(marker?.substitute?.id).toBe('margarine');
    });

    // Silence carries: a substitute on record for an item this store is *not*
    // marked unavailable for must not leak the clause onto some other kind.
    it('never carries a substitute on a marker that is not "unavailable"', () => {
      const links = [link('milk', traderJoes.id, 3)];
      const subs = [subLink('milk', 'oat-milk', '2026-01-01T00:00:00.000Z')];
      const oatMilk = item('oat-milk', { name: 'Oat milk' });
      const marker = tripMarkerFor(item('milk'), links, shops, safeway, subs, [item('milk'), oatMilk]);
      expect(marker).toEqual({ kind: 'only', shop: traderJoes });
    });

    // A link naming a *different* item's substitute must not bleed onto this
    // row just because both happen to be unavailable at the same store.
    it('ignores a substitute link for a different item', () => {
      const subs = [subLink('tahini', 'margarine', '2026-01-01T00:00:00.000Z')];
      const marker = tripMarkerFor(butter, unavailableHere, shops, safeway, subs, [butter, margarine]);
      expect(marker?.substitute).toBeUndefined();
    });
  });
});

describe('describeTripMarker', () => {
  it('words each kind plainly', () => {
    expect(describeTripMarker({ kind: 'unavailable', shop: safeway })).toBe('Not at Safeway');
    expect(describeTripMarker({ kind: 'only', shop: traderJoes })).toBe("Only at Trader Joe's");
    expect(describeTripMarker({ kind: 'usually', shop: traderJoes })).toBe("Usually Trader Joe's");
  });

  // Rides inside the marker that's already there, rather than a fourth line.
  it('appends the substitute to an unavailable marker that carries one', () => {
    const margarine = item('margarine', { name: 'Margarine' });
    expect(
      describeTripMarker({ kind: 'unavailable', shop: safeway, substitute: margarine })
    ).toBe('Not at Safeway · or Margarine');
  });

  // Names the brand and not the store: you're standing in the shop. And not
  // what it *does* carry either — the app only knows one past purchase.
  it('names the brand you wanted, not the shop you are in', () => {
    expect(
      describeTripMarker({ kind: 'withoutBrand', shop: safeway, wantedBrand: 'Good Culture' })
    ).toBe('No Good Culture here');
  });
});
