import {
  TRIP_MAX_MS,
  isTripLive,
  resolveActiveTrip,
  tripMarkerFor,
  describeTripMarker,
} from '../utils/activeTrip';
import { groceryNameKey } from '../utils/groceryParse';
import type { ItemShopLink, Shop } from '../types';

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
    expect(tripMarkerFor('milk', links, shops, safeway)).toBeNull();
  });

  it('says nothing about an item merely asserted to be at this store', () => {
    const links = [link('milk', safeway.id, 0)];
    expect(tripMarkerFor('milk', links, shops, safeway)).toBeNull();
  });

  // Ignorance is not evidence — the reason most of a first-ever trip is silent.
  it('says nothing about an item nothing is known about', () => {
    expect(tripMarkerFor('tahini', [], shops, safeway)).toBeNull();
  });

  it('reports a store the user marked as not stocking it', () => {
    const links = [link('tahini', safeway.id, 0, { unavailableAt: '2026-08-01T00:00:00.000Z' })];
    expect(tripMarkerFor('tahini', links, shops, safeway)).toEqual({
      kind: 'unavailable',
      shop: safeway,
    });
  });

  // The negative is the current state and the count is history.
  it('reports unavailable even when it was bought here before', () => {
    const links = [link('tahini', safeway.id, 11, { unavailableAt: '2026-08-01T00:00:00.000Z' })];
    expect(tripMarkerFor('tahini', links, shops, safeway)).toEqual({
      kind: 'unavailable',
      shop: safeway,
    });
  });

  it('reports the one other store on record', () => {
    const links = [link('tahini', traderJoes.id, 3)];
    expect(tripMarkerFor('tahini', links, shops, safeway)).toEqual({
      kind: 'only',
      shop: traderJoes,
    });
  });

  it('counts a hand-assertion as "only"', () => {
    const links = [link('tahini', traderJoes.id, 0)];
    expect(tripMarkerFor('tahini', links, shops, safeway)).toEqual({
      kind: 'only',
      shop: traderJoes,
    });
  });

  it('falls back to "usually" when several other stores are on record', () => {
    const links = [link('tahini', traderJoes.id, 5), link('tahini', costco.id, 1)];
    expect(tripMarkerFor('tahini', links, shops, safeway)).toEqual({
      kind: 'usually',
      shop: traderJoes,
    });
  });

  // "usually" needs an observation; an assertion alone can't invent a habit.
  it('says nothing when the other stores are all assertions and there are several', () => {
    const links = [link('tahini', traderJoes.id, 0), link('tahini', costco.id, 0)];
    expect(tripMarkerFor('tahini', links, shops, safeway)).toBeNull();
  });

  it('ignores a store marked unavailable when naming where else to go', () => {
    const links = [
      link('tahini', traderJoes.id, 3),
      link('tahini', costco.id, 9, { unavailableAt: '2026-08-01T00:00:00.000Z' }),
    ];
    expect(tripMarkerFor('tahini', links, shops, safeway)).toEqual({
      kind: 'only',
      shop: traderJoes,
    });
  });

  it('never points at a store excluded from suggestions', () => {
    const amazon = makeShop('Amazon', { excludeFromSuggestions: true });
    const links = [link('tahini', amazon.id, 6)];
    expect(tripMarkerFor('tahini', links, [...shops, amazon], safeway)).toBeNull();
  });

  it('drops a link whose shop no longer exists', () => {
    const links = [link('tahini', 'shop-gone', 3)];
    expect(tripMarkerFor('tahini', links, shops, safeway)).toBeNull();
  });

  it('is silent about other items on the list', () => {
    const links = [link('tahini', traderJoes.id, 3)];
    expect(tripMarkerFor('milk', links, shops, safeway)).toBeNull();
  });
});

describe('describeTripMarker', () => {
  it('words each kind plainly', () => {
    expect(describeTripMarker({ kind: 'unavailable', shop: safeway })).toBe('Not at Safeway');
    expect(describeTripMarker({ kind: 'only', shop: traderJoes })).toBe("Only at Trader Joe's");
    expect(describeTripMarker({ kind: 'usually', shop: traderJoes })).toBe("Usually Trader Joe's");
  });
});
