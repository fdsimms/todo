import {
  cheapestShopFor,
  describeListEstimate,
  describePriceAge,
  describePriceContext,
  describePriceStanding,
  describeShopPrices,
  estimateListTotal,
  formatPrice,
  formatPriceInput,
  lastPriceFor,
  lastPricedAmountFor,
  parsePriceInput,
  priceStandingFor,
  priceToInput,
  shopPricesFor,
  typicalPriceFor,
  unitPricesFor,
} from '../utils/groceryPrice';
import type { GroceryItem, ItemShopLink, Shop } from '../types';

function makeItem(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: 'i1',
    name: 'Milk',
    nameKey: 'milk',
    preferredProductId: null,
    productStrict: false,
    aisle: 'Dairy',
    quantity: null,
    quantityFromRecipe: false,
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
    shelfLifeDays: null,
    useUpTask: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null, priceHistory: [],
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
    lastPriceQuantity: null, priceHistory: [],
    productId: null,
    unavailableProductIds: {},
    ...overrides,
  };
}

function obs(
  minor: number,
  quantity: string | null = null,
  at = '2026-08-01T00:00:00.000Z',
  productId: string | null = null,
) {
  return { minor, quantity, at, productId };
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

  it('reads a bare decimal under $1, with no leading zero required', () => {
    // A decimal-pad keyboard doesn't insert the leading zero, so this is what
    // typing "75 cents" actually produces.
    expect(parsePriceInput('.75')).toBe(75);
    expect(parsePriceInput('.5')).toBe(50);
    expect(parsePriceInput('$.99')).toBe(99);
    expect(parsePriceInput(',50')).toBe(50);
    // Still refused: a bare separator names no amount at all.
    expect(parsePriceInput('.')).toBeNull();
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

describe('formatPriceInput', () => {
  it('treats the last two digits typed as cents, YNAB-style', () => {
    expect(formatPriceInput('4')).toBe('0.04');
    expect(formatPriceInput('49')).toBe('0.49');
    expect(formatPriceInput('499')).toBe('4.99');
    expect(formatPriceInput('1200')).toBe('12.00');
  });

  it('rebuilds from whatever digits are in the field, so backspacing drops the last one', () => {
    // "4.9" is what the field holds mid-backspace from "4.99" — the trailing
    // "9" is gone, leaving "49" cents.
    expect(formatPriceInput('4.9')).toBe('0.49');
    expect(formatPriceInput('0.0')).toBe('');
  });

  it('ignores a manually-typed decimal point — there is nothing to type it for', () => {
    expect(formatPriceInput('4.')).toBe('0.04');
    expect(formatPriceInput('4.9.9')).toBe('4.99');
  });

  it('is empty rather than "$0.00" once every digit is gone, same as the clear button', () => {
    expect(formatPriceInput('')).toBe('');
    expect(formatPriceInput('0')).toBe('');
    expect(formatPriceInput('00')).toBe('');
  });

  it('clamps at the ceiling instead of growing past it', () => {
    expect(formatPriceInput('1000000')).toBe('10000.00');
    expect(formatPriceInput('99999999')).toBe('10000.00');
  });

  it('round-trips through parsePriceInput', () => {
    expect(parsePriceInput(formatPriceInput('499'))).toBe(499);
    expect(parsePriceInput(formatPriceInput('1200'))).toBe(1200);
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

describe('describePriceStanding', () => {
  it('never shows the baseline number, only the verdict', () => {
    expect(describePriceStanding('lowest')).toBe("The lowest you've paid");
    expect(describePriceStanding('low')).toBe('Less than you usually pay');
    expect(describePriceStanding('usual')).toBe('About what you usually pay');
    expect(describePriceStanding('high')).toBe('More than usual');
    expect(describePriceStanding(null)).toBeNull();
  });
});

describe('priceStandingFor', () => {
  it('is null when nothing has been priced', () => {
    expect(priceStandingFor(makeItem(), null, [])).toBeNull();
  });

  it('reads the item-level run when no store is targeted', () => {
    const item = makeItem({
      lastPriceMinor: 900,
      lastPriceQuantity: null,
      priceHistory: [obs(900), obs(400), obs(450)],
    });
    expect(priceStandingFor(item, null, [])).toBe('high');
  });

  it('judges a targeted store against its own run, not the item’s', () => {
    const item = makeItem({ lastPriceMinor: 900, priceHistory: [obs(900), obs(400)] });
    const l = link({
      itemId: item.id,
      shopId: costco.id,
      lastPriceMinor: 399,
      priceHistory: [obs(399)],
    });
    // Costco's own run says this is the only, and so the lowest, price seen
    // there — the item-level run above would have called it 'high'.
    expect(priceStandingFor(item, costco.id, [l])).toBe('lowest');
  });

  it('is null for a targeted store with no run of its own', () => {
    const item = makeItem({ lastPriceMinor: 900, priceHistory: [obs(900), obs(400)] });
    const l = link({ itemId: item.id, shopId: costco.id, lastPriceMinor: 399, priceHistory: [] });
    expect(priceStandingFor(item, costco.id, [l])).toBeNull();
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

  it('compares different quantities per unit', () => {
    // $4.29 for 2 lb is the better deal, and saying "cheapest at Safeway"
    // because 3.19 < 4.29 would be exactly backwards.
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 429, lastPriceQuantity: '2 lb' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 319, lastPriceQuantity: '1 lb' }),
    ];
    expect(cheapestShopFor('i1', links, SHOPS)?.shop.name).toBe('Costco');
  });

  it('compares across systems, and answers in the winner’s units', () => {
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 400, lastPriceQuantity: '500 g' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 900, lastPriceQuantity: '1 lb' }),
    ];
    expect(cheapestShopFor('i1', links, SHOPS)?.shop.name).toBe('Costco');
    // $8.00/kg against $19.84/kg — metric, because the metric price won.
    expect(unitPricesFor(shopPricesFor('i1', links, SHOPS))).toEqual([
      expect.objectContaining({ minorPerUnit: 800, unit: 'kg' }),
      expect.objectContaining({ minorPerUnit: 1984, unit: 'kg' }),
    ]);
  });

  it('compares counts of the same thing', () => {
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 480, lastPriceQuantity: '12' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 300, lastPriceQuantity: '6' }),
    ];
    // 40c an egg against 50c an egg.
    expect(cheapestShopFor('i1', links, SHOPS)?.shop.name).toBe('Costco');
  });

  it('compares counts sharing a unit word', () => {
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 900, lastPriceQuantity: '3 cans' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 250, lastPriceQuantity: '1 can' }),
    ];
    expect(cheapestShopFor('i1', links, SHOPS)?.shop.name).toBe('Safeway');
  });

  it('refuses to compare a count against a measurement', () => {
    // Nothing in the app knows how much is in the bag.
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 429, lastPriceQuantity: '1 bag' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 319, lastPriceQuantity: '500 g' }),
    ];
    expect(cheapestShopFor('i1', links, SHOPS)).toBeNull();
  });

  it('refuses to compare across dimensions', () => {
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 429, lastPriceQuantity: '500 ml' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 319, lastPriceQuantity: '500 g' }),
    ];
    expect(cheapestShopFor('i1', links, SHOPS)).toBeNull();
  });

  it('refuses the whole set when one quantity cannot be measured', () => {
    // The refusal is all-or-nothing on purpose: ranking the two that parsed
    // would silently drop the third and still call itself "cheapest".
    const wholeFoods = makeShop('WholeFoods', 3);
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 429, lastPriceQuantity: '2 lb' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 319, lastPriceQuantity: '1 lb' }),
      link({ itemId: 'i1', shopId: wholeFoods.id, lastPriceMinor: 275, lastPriceQuantity: 'a bunch' }),
    ];
    expect(cheapestShopFor('i1', links, [...SHOPS, wholeFoods])).toBeNull();
    // …but all three are still shown, where the quantities explain themselves.
    expect(shopPricesFor('i1', links, [...SHOPS, wholeFoods])).toHaveLength(3);
  });

  it('refuses when one price has no quantity at all', () => {
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 429, lastPriceQuantity: '2 lb' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 319 }),
    ];
    expect(cheapestShopFor('i1', links, SHOPS)).toBeNull();
  });

  it('refuses a per-unit tie, judged on the figures it would show', () => {
    // $4.30/2 lb is $2.15/lb and $6.44/3 lb is $2.1466…/lb — a hundredth of a
    // penny apart, and both render "≈$2.15/lb".
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 430, lastPriceQuantity: '2 lb' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 644, lastPriceQuantity: '3 lb' }),
    ];
    expect(cheapestShopFor('i1', links, SHOPS)).toBeNull();
  });

  it('measures a sized container, but not a count of them', () => {
    const sized = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 300, lastPriceQuantity: '28 oz can' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 200, lastPriceQuantity: '14 oz can' }),
    ];
    // Fourteen ounces really is how much is in the tin.
    expect(cheapestShopFor('i1', sized, SHOPS)?.shop.name).toBe('Costco');

    const counted = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 300, lastPriceQuantity: '2 14 oz cans' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 200, lastPriceQuantity: '14 oz can' }),
    ];
    // Two of them is not fourteen ounces, and nothing here will pretend it is.
    expect(cheapestShopFor('i1', counted, SHOPS)).toBeNull();
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

  it('shows its working when the ranking is per unit', () => {
    // A tag on the *larger* number is only readable with the rate beside it.
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 429, lastPriceQuantity: '2 lb' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 319, lastPriceQuantity: '1 lb' }),
    ];
    const prices = shopPricesFor('i1', links, SHOPS);
    // Safeway's 1 lb is one display unit, so its rate is the price already
    // printed and isn't repeated.
    expect(describeShopPrices(prices, '$', cheapestShopFor('i1', links, SHOPS)?.shop.id)).toBe(
      'Safeway $3.19 for 1 lb · Costco $4.29 for 2 lb (≈$2.15/lb, cheapest)'
    );
  });

  it('states a rate for every store when none of them is one unit', () => {
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 900, lastPriceQuantity: '3 lb' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 700, lastPriceQuantity: '2 lb' }),
    ];
    const prices = shopPricesFor('i1', links, SHOPS);
    expect(describeShopPrices(prices, '$', cheapestShopFor('i1', links, SHOPS)?.shop.id)).toBe(
      'Safeway $7.00 for 2 lb (≈$3.50/lb) · Costco $9.00 for 3 lb (≈$3.00/lb, cheapest)'
    );
  });

  it('says "each" where a count has no unit word to hang a rate on', () => {
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 480, lastPriceQuantity: '12' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 300, lastPriceQuantity: '6' }),
    ];
    const prices = shopPricesFor('i1', links, SHOPS);
    expect(describeShopPrices(prices, '$', cheapestShopFor('i1', links, SHOPS)?.shop.id)).toBe(
      'Safeway $3.00 for 6 (≈$0.50 each) · Costco $4.80 for 12 (≈$0.40 each, cheapest)'
    );
  });

  it('claims nothing when the comparison was refused', () => {
    // One unmeasurable quantity: no tag, no rates, just the prices.
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 429, lastPriceQuantity: '2 lb' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 319, lastPriceQuantity: 'a bunch' }),
    ];
    const prices = shopPricesFor('i1', links, SHOPS);
    const line = describeShopPrices(prices, '$', cheapestShopFor('i1', links, SHOPS)?.shop.id);
    expect(line).toBe('Safeway $3.19 for a bunch · Costco $4.29 for 2 lb');
    expect(line).not.toContain('cheapest');
  });

  it('leaves a matched-quantity line exactly as it was', () => {
    // Directly comparable, so no rate is added — "$4.29 for 2 lb (≈$2.15/lb)"
    // beside an identical quantity is the same number twice.
    const links = [
      link({ itemId: 'i1', shopId: costco.id, lastPriceMinor: 429, lastPriceQuantity: '2 lb' }),
      link({ itemId: 'i1', shopId: safeway.id, lastPriceMinor: 519, lastPriceQuantity: '2 lb' }),
    ];
    const prices = shopPricesFor('i1', links, SHOPS);
    expect(describeShopPrices(prices, '$', cheapestShopFor('i1', links, SHOPS)?.shop.id)).toBe(
      'Costco $4.29 for 2 lb (cheapest) · Safeway $5.19 for 2 lb'
    );
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

// ─── prices scoped to the preferred product ─────────────────────────────────

describe('a preferred product scopes the run', () => {
  const arnolds = (minor: number) => obs(minor, '1 loaf', '2026-08-01T00:00:00.000Z', 'p-arnolds');
  const store = (minor: number) => obs(minor, '1 loaf', '2026-08-01T00:00:00.000Z', 'p-store');
  const mixed = [arnolds(499), store(299), arnolds(529), store(279)];

  it('answers "what does the one I buy cost", not "what does bread cost"', () => {
    const bread = makeItem({ id: 'bread', preferredProductId: 'p-arnolds', priceHistory: mixed });
    expect(typicalPriceFor(bread, null, [])?.minor).toBe(514);

    // The same run, asked about the other box.
    const cheap = makeItem({ id: 'bread', preferredProductId: 'p-store', priceHistory: mixed });
    expect(typicalPriceFor(cheap, null, [])?.minor).toBe(289);
  });

  it('scopes the store-level run the same way', () => {
    const bread = makeItem({ id: 'bread', preferredProductId: 'p-arnolds' });
    const links = [link({ itemId: 'bread', shopId: costco.id, priceHistory: mixed })];
    expect(typicalPriceFor(bread, costco.id, links)?.minor).toBe(514);
  });

  it('falls back to the whole run rather than answering with less', () => {
    // One Arnold's observation is below the floor, so the unfiltered median
    // stands — this can never return less than it did before products.
    const thin = [arnolds(499), store(299), store(279)];
    const bread = makeItem({ id: 'bread', preferredProductId: 'p-arnolds', priceHistory: thin });
    expect(typicalPriceFor(bread, null, [])?.minor).toBe(299);
  });

  it('changes nothing for an item with no preference', () => {
    const bread = makeItem({ id: 'bread', priceHistory: mixed });
    expect(typicalPriceFor(bread, null, [])?.minor).toBe(399);
  });

  // "More than usual" measured against a run that mixed in a cheaper box is a
  // verdict about the wrong thing.
  it('judges a price against its own box', () => {
    const dear = makeItem({
      id: 'bread',
      preferredProductId: 'p-arnolds',
      lastPriceMinor: 519,
      lastPriceQuantity: '1 loaf',
      priceHistory: mixed,
    });
    // 519 against Arnold's own 499/529 is ordinary; against the mixed run
    // (median 399) it would have read as "more than usual".
    expect(priceStandingFor(dear, null, [])).toBe('usual');
  });

  // The scalar is a single fact about the row, and setItemPrice writes it
  // without touching the run — deriving it from the filtered run would discard
  // a correction made by hand.
  it('leaves the last recorded price alone', () => {
    const bread = makeItem({
      id: 'bread',
      preferredProductId: 'p-arnolds',
      lastPriceMinor: 349,
      lastPriceQuantity: '1 loaf',
      priceHistory: mixed,
    });
    expect(lastPricedAmountFor(bread, null, [])).toEqual({ minor: 349, quantity: '1 loaf' });
  });
});
