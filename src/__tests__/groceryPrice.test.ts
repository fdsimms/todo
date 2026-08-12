import {
  cheapestShopFor,
  describeListEstimate,
  describePriceAge,
  describePriceContext,
  describeShopPrices,
  estimateListTotal,
  formatPrice,
  lastPriceFor,
  parsePriceInput,
  priceToInput,
  shopPricesFor,
} from '../utils/groceryPrice';
import type { GroceryItem, ItemShopLink, Shop } from '../types';

function makeItem(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: 'i1',
    name: 'Milk',
    nameKey: 'milk',
    aisle: 'Dairy',
    quantity: null,
    note: '',
    onList: true,
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
    useUpTask: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    ...overrides,
  };
}

function makeShop(name: string, sortOrder: number): Shop {
  return {
    id: `s-${name.toLowerCase()}`,
    name,
    nameKey: name.toLowerCase(),
    sortOrder,
    createdAt: '2026-01-01T00:00:00.000Z',
    excludeFromSuggestions: false,
  };
}

function link(overrides: Partial<ItemShopLink> & Pick<ItemShopLink, 'itemId' | 'shopId'>): ItemShopLink {
  return {
    purchaseCount: 1,
    lastPurchasedAt: null,
    unavailableAt: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    ...overrides,
  };
}

const costco = makeShop('Costco', 1);
const safeway = makeShop('Safeway', 2);
const SHOPS = [costco, safeway];

describe('parsePriceInput', () => {
  it('reads the shapes a person types at a checkout', () => {
    expect(parsePriceInput('4.29')).toBe(429);
    expect(parsePriceInput('4')).toBe(400);
    expect(parsePriceInput('4.5')).toBe(450);
    expect(parsePriceInput('0.99')).toBe(99);
    expect(parsePriceInput(' 12.00 ')).toBe(1200);
  });

  it('ignores a leading symbol and takes either decimal separator', () => {
    expect(parsePriceInput('$4.29')).toBe(429);
    expect(parsePriceInput('£4.29')).toBe(429);
    expect(parsePriceInput('4,50')).toBe(450);
  });

  it('refuses rather than guesses', () => {
    expect(parsePriceInput('')).toBeNull();
    expect(parsePriceInput('a fiver')).toBeNull();
    expect(parsePriceInput('4.99 each')).toBeNull();
    expect(parsePriceInput('-4.99')).toBeNull();
    expect(parsePriceInput('0')).toBeNull();
    // Rounding this would put a number nobody checked into a total.
    expect(parsePriceInput('4.999')).toBeNull();
  });

  it('refuses a price past the ceiling', () => {
    expect(parsePriceInput('10000')).toBe(1_000_000);
    expect(parsePriceInput('10000.01')).toBeNull();
  });

  it('round-trips through the field value it seeds', () => {
    expect(parsePriceInput(priceToInput(429))).toBe(429);
    expect(parsePriceInput(priceToInput(400))).toBe(400);
  });
});

describe('formatPrice', () => {
  it('always shows both decimal places', () => {
    expect(formatPrice(429, '$')).toBe('$4.29');
    expect(formatPrice(400, '$')).toBe('$4.00');
    expect(formatPrice(9, '£')).toBe('£0.09');
    expect(formatPrice(90, '£')).toBe('£0.90');
  });

  it('sums exactly, which is the reason these are integers', () => {
    const cents = [319, 429, 1099];
    expect(formatPrice(cents.reduce((a, b) => a + b, 0), '$')).toBe('$18.47');
  });
});

describe('describePriceAge', () => {
  const now = new Date('2026-08-12T00:00:00.000Z');

  it('says "this month" rather than a date for a fresh price', () => {
    expect(describePriceAge('2026-08-02T00:00:00.000Z', now)).toBe('this month');
  });

  it('names the month within the year, and adds the year outside it', () => {
    expect(describePriceAge('2026-03-04T00:00:00.000Z', now)).toBe('Mar');
    expect(describePriceAge('2024-03-04T00:00:00.000Z', now)).toBe('Mar 2024');
  });
});

describe('describePriceContext', () => {
  const now = new Date('2026-08-12T00:00:00.000Z');

  it('is null when nothing has been priced', () => {
    expect(describePriceContext(makeItem(), now)).toBeNull();
  });

  it('never repeats the number the field beside it is showing', () => {
    const line = describePriceContext(
      makeItem({ lastPriceMinor: 429, lastPricedAt: '2026-03-04T00:00:00.000Z', lastPriceQuantity: '2 lb' }),
      now
    );
    expect(line).toBe('Last paid for 2 lb · Mar');
    expect(line).not.toContain('4.29');
  });

  it('drops the quantity clause when there was none', () => {
    expect(
      describePriceContext(
        makeItem({ lastPriceMinor: 429, lastPricedAt: '2026-03-04T00:00:00.000Z' }),
        now
      )
    ).toBe('Last paid · Mar');
  });
});

describe('shopPricesFor', () => {
  it('lists only priced stores, cheapest first', () => {
    const links = [
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 429 }),
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 319 }),
    ];
    expect(shopPricesFor('i1', links, SHOPS).map(p => p.shop.name)).toEqual(['Costco', 'Safeway']);
  });

  it('drops a store with no price — an unpriced store is not a cheap one', () => {
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 319 }),
      link({ itemId: 'i1', shopId: safeway.id }),
    ];
    expect(shopPricesFor('i1', links, SHOPS).map(p => p.shop.name)).toEqual(['Costco']);
  });

  it('drops a store told it does not stock the item, price or no price', () => {
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 319 }),
      link({
        itemId: 'i1',
        shopId: safeway.id,
        lastPriceMinor: 199,
        unavailableAt: '2026-03-04T00:00:00.000Z',
      }),
    ];
    expect(shopPricesFor('i1', links, SHOPS).map(p => p.shop.name)).toEqual(['Costco']);
  });

  it('shrugs off a link whose store is gone', () => {
    const links = [link({ itemId: 'i1', shopId: 'deleted', lastPriceMinor: 319 })];
    expect(shopPricesFor('i1', links, SHOPS)).toEqual([]);
  });
});

describe('cheapestShopFor', () => {
  it('names the cheaper of two priced stores', () => {
    const links = [
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 429 }),
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 319 }),
    ];
    expect(cheapestShopFor('i1', links, SHOPS)?.shop.name).toBe('Costco');
  });

  it('refuses on one priced store — a single observation is not a comparison', () => {
    const links = [link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 319 })];
    expect(cheapestShopFor('i1', links, SHOPS)).toBeNull();
  });

  it('refuses on a tie', () => {
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 319 }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 319 }),
    ];
    expect(cheapestShopFor('i1', links, SHOPS)).toBeNull();
  });

  it('refuses when the prices were for different quantities', () => {
    // $4.29 for 2 lb is the better deal, and saying "cheapest at Safeway"
    // because 3.19 < 4.29 would be exactly backwards.
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 429, lastPriceQuantity: '2 lb' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 319, lastPriceQuantity: '1 lb' }),
    ];
    expect(cheapestShopFor('i1', links, SHOPS)).toBeNull();
    // …but both are still shown, where the quantities explain themselves.
    expect(shopPricesFor('i1', links, SHOPS)).toHaveLength(2);
  });

  it('compares happily when the quantities match', () => {
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 429, lastPriceQuantity: '2 lb' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 519, lastPriceQuantity: '2 lb' }),
    ];
    expect(cheapestShopFor('i1', links, SHOPS)?.shop.name).toBe('Costco');
  });

  it('ignores a store that is only excluded from suggestions', () => {
    const amazon = { ...makeShop('Amazon', 3), excludeFromSuggestions: true };
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 429 }),
      link({ itemId: 'i1', shopId: amazon.id, lastPriceMinor: 319 }),
    ];
    // A comparison the user asked to see, not a recommendation the app makes.
    expect(cheapestShopFor('i1', links, [...SHOPS, amazon])?.shop.name).toBe('Amazon');
  });
});

describe('describeShopPrices', () => {
  it('names every priced store with what it charged', () => {
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 319 }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 429, lastPriceQuantity: '2 lb' }),
    ];
    expect(describeShopPrices(shopPricesFor('i1', links, SHOPS), '$')).toBe(
      'Costco $3.19 · Safeway $4.29 for 2 lb'
    );
  });

  it('tags the winner when there is one', () => {
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 319 }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 429 }),
    ];
    const prices = shopPricesFor('i1', links, SHOPS);
    const cheapest = cheapestShopFor('i1', links, SHOPS);
    expect(describeShopPrices(prices, '$', cheapest?.shop.id)).toBe(
      'Costco $3.19 (cheapest) · Safeway $4.29'
    );
  });

  it('claims nothing when the comparison was refused', () => {
    // Different quantities: cheapestShopFor returns null, so no tag is passed
    // and the line states two prices without ranking them.
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 429, lastPriceQuantity: '2 lb' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 319, lastPriceQuantity: '1 lb' }),
    ];
    const prices = shopPricesFor('i1', links, SHOPS);
    const line = describeShopPrices(prices, '$', cheapestShopFor('i1', links, SHOPS)?.shop.id);
    expect(line).toBe('Safeway $3.19 for 1 lb · Costco $4.29 for 2 lb');
    expect(line).not.toContain('cheapest');
  });

  it('is null with nothing priced', () => {
    expect(describeShopPrices([], '$')).toBeNull();
  });
});

describe('estimateListTotal', () => {
  it('counts only what is on the list', () => {
    const items = [
      makeItem({ id: 'a', onList: true, lastPriceMinor: 429 }),
      makeItem({ id: 'b', onList: false, lastPriceMinor: 999 }),
    ];
    expect(estimateListTotal(items)).toEqual({ totalMinor: 429, priced: 1, total: 1 });
  });

  it('leaves a staple out of both halves of the fraction', () => {
    const items = [
      makeItem({ id: 'a', onList: true, lastPriceMinor: 429 }),
      makeItem({ id: 'salt', onList: true, isStaple: true, lastPriceMinor: 199 }),
    ];
    // Not 1 of 2, and not $6.28: nobody is buying salt today.
    expect(estimateListTotal(items)).toEqual({ totalMinor: 429, priced: 1, total: 1 });
  });

  it('reports how much of the list it could not price', () => {
    const items = [
      makeItem({ id: 'a', onList: true, lastPriceMinor: 429 }),
      makeItem({ id: 'b', onList: true }),
      makeItem({ id: 'c', onList: true }),
    ];
    expect(estimateListTotal(items)).toEqual({ totalMinor: 429, priced: 1, total: 3 });
  });
});

describe('describeListEstimate', () => {
  it('says how partial a partial total is', () => {
    expect(describeListEstimate({ totalMinor: 4730, priced: 9, total: 14 }, '$')).toBe(
      '≈ $47.30 · 9 of 14 priced'
    );
  });

  it('drops the fraction once every row is priced', () => {
    expect(describeListEstimate({ totalMinor: 4730, priced: 14, total: 14 }, '$')).toBe('≈ $47.30');
  });

  it('is silent rather than showing a zero total', () => {
    expect(describeListEstimate({ totalMinor: 0, priced: 0, total: 14 }, '$')).toBeNull();
  });
});

describe('lastPriceFor', () => {
  const item = makeItem({ lastPriceMinor: 429 });

  it('prefers what this store charged', () => {
    const links = [link({ itemId: item.id, shopId: costco.id, lastPriceMinor: 319 })];
    expect(lastPriceFor(item, costco.id, links)).toBe(319);
  });

  it('falls back to the item price when the store has none', () => {
    const links = [link({ itemId: item.id, shopId: costco.id })];
    expect(lastPriceFor(item, costco.id, links)).toBe(429);
    expect(lastPriceFor(item, null, links)).toBe(429);
  });

  it('is null when nothing has ever been priced', () => {
    expect(lastPriceFor(makeItem(), costco.id, [])).toBeNull();
  });
});
