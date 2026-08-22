import {
  acceptedByDefault,
  isPlausibleReceiptDate,
  matchReceiptLines,
  matchReceiptShop,
  receiptCautionsFor,
  receiptMatchConfidence,
} from '../utils/receiptMatch';
import { groceryNameKey } from '../utils/groceryParse';
import type { ReceiptLine } from '../services/aiSuggestions';
import type { GroceryItem, ItemShopLink, Shop } from '../types';

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
    onList: true,
    checked: false,
    inCatalog: true,
    sortOrder: seq,
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
    frozenAt: null,
    openedAt: null,
    runningLowAt: null,
    shelfLifeDays: null,
    useUpTask: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  };
}

function makeShop(name: string): Shop {
  return {
    id: `shop-${++seq}`,
    name,
    nameKey: groceryNameKey(name),
    sortOrder: seq,
    createdAt: '2026-01-01T00:00:00.000Z',
    excludeFromSuggestions: false,
    receiptStyle: 'itemized' as const,
  };
}

function line(overrides: Partial<ReceiptLine> & { name: string }): ReceiptLine {
  return {
    label: overrides.name.toUpperCase(),
    quantity: '',
    priceMinor: 348,
    ...overrides,
  };
}

// ─── receiptMatchConfidence ──────────────────────────────────────────────────

describe('receiptMatchConfidence', () => {
  it('reads identical keys as exact', () => {
    expect(receiptMatchConfidence('milk', 'milk')).toBe('exact');
  });

  it('reads a plural against its singular as exact, either way round', () => {
    expect(receiptMatchConfidence('bananas', 'banana')).toBe('exact');
    expect(receiptMatchConfidence('banana', 'bananas')).toBe('exact');
  });

  it('reads a longer receipt name against a shorter row as likely', () => {
    expect(receiptMatchConfidence('chicken', 'chicken breast')).toBe('likely');
  });

  it('reads a shorter receipt name against a longer row as likely', () => {
    // The list says "chicken breast", the receipt just says "chicken" — the
    // one-way test the autocomplete uses would miss this direction.
    expect(receiptMatchConfidence('chicken breast', 'chicken')).toBe('likely');
  });

  it('reads a shared significant word as weak, not likely', () => {
    expect(receiptMatchConfidence('chicken thighs', 'chicken breast')).toBe('weak');
  });

  it('refuses two names that share nothing', () => {
    expect(receiptMatchConfidence('milk', 'batteries')).toBeNull();
  });

  it('refuses an empty key on either side', () => {
    expect(receiptMatchConfidence('', 'milk')).toBeNull();
    expect(receiptMatchConfidence('milk', '')).toBeNull();
  });

  it('does not marry two names on a common filler word', () => {
    // "whole" is exactly the word that would otherwise pair these.
    expect(receiptMatchConfidence('whole milk', 'whole wheat bread')).toBeNull();
  });
});

// ─── matchReceiptLines ───────────────────────────────────────────────────────

describe('matchReceiptLines', () => {
  it('matches a cryptic label through the name the model read off it', () => {
    const items = [makeItem({ name: 'Milk' })];
    const lines = [line({ label: 'GV MLK 2% GAL', name: 'milk', priceMinor: 348 })];

    const matches = matchReceiptLines(lines, items);
    const confidentIds = acceptedByDefault(matches, items, null, []);

    expect(matches[0].itemId).toBe(items[0].id);
    expect(matches[0].confidence).toBe('exact');
    expect(confidentIds).toEqual([items[0].id]);
  });

  it('leaves a weak match unclaimed by confidentIds so it cannot pre-check', () => {
    const items = [makeItem({ name: 'Chicken thighs' })];
    const lines = [line({ name: 'chicken breast' })];

    const matches = matchReceiptLines(lines, items);
    const confidentIds = acceptedByDefault(matches, items, null, []);

    // Still surfaced — the user may well have meant it — but never pre-ticked.
    expect(matches[0].itemId).toBe(items[0].id);
    expect(matches[0].confidence).toBe('weak');
    expect(confidentIds).toEqual([]);
  });

  it('ignores rows that are not on the list', () => {
    const items = [makeItem({ name: 'Milk', onList: false })];
    const lines = [line({ name: 'milk' })];

    const matches = matchReceiptLines(lines, items);
    const confidentIds = acceptedByDefault(matches, items, null, []);

    expect(matches[0].itemId).toBeNull();
    expect(confidentIds).toEqual([]);
  });

  it('reports an unmatched line rather than forcing it onto the nearest row', () => {
    const items = [makeItem({ name: 'Milk' })];
    const lines = [line({ name: 'AA batteries' })];

    const matches = matchReceiptLines(lines, items);

    expect(matches[0].itemId).toBeNull();
    expect(matches[0].confidence).toBeNull();
    expect(matches[0].duplicateOf).toBeNull();
  });

  it('lets only one line claim a row, and flags the other as a duplicate', () => {
    const items = [makeItem({ name: 'Milk' })];
    const lines = [
      line({ label: 'MILK GAL', name: 'milk', priceMinor: 348 }),
      line({ label: 'MILK GAL', name: 'milk', priceMinor: 348 }),
    ];

    const matches = matchReceiptLines(lines, items);
    const confidentIds = acceptedByDefault(matches, items, null, []);

    expect(matches[0].itemId).toBe(items[0].id);
    expect(matches[1].itemId).toBeNull();
    expect(matches[1].duplicateOf).toBe(items[0].id);
    // The row is checked off once, not twice, and its price is one line's.
    expect(confidentIds).toEqual([items[0].id]);
  });

  it('gives a contested row to the better read, not the earlier line', () => {
    const items = [makeItem({ name: 'Chicken breast' })];
    const lines = [
      line({ name: 'chicken thighs' }),  // weak
      line({ name: 'chicken breast' }),  // exact
    ];

    const matches = matchReceiptLines(lines, items);

    expect(matches[1].itemId).toBe(items[0].id);
    expect(matches[1].confidence).toBe('exact');
    expect(matches[0].itemId).toBeNull();
    expect(matches[0].duplicateOf).toBe(items[0].id);
  });

  it('prefers the closest row when several match at the same tier', () => {
    const items = [
      makeItem({ name: 'Chicken breast tenders' }),
      makeItem({ name: 'Chicken' }),
    ];
    const lines = [line({ name: 'chicken' })];

    const matches = matchReceiptLines(lines, items);

    expect(matches[0].itemId).toBe(items[1].id);
    expect(matches[0].confidence).toBe('exact');
  });

  it('is stable regardless of the order the list happens to be in', () => {
    const a = makeItem({ name: 'Chicken breast tenders' });
    const b = makeItem({ name: 'Chicken' });
    const lines = [line({ name: 'chicken' })];

    expect(matchReceiptLines(lines, [a, b])[0].itemId)
      .toBe(matchReceiptLines(lines, [b, a])[0].itemId);
  });

  it('returns nothing for an empty receipt', () => {
    expect(matchReceiptLines([], [makeItem({ name: 'Milk' })])).toEqual([]);
  });

  it('carries the line through untouched so the sheet can show what was printed', () => {
    const items = [makeItem({ name: 'Bananas' })];
    const lines = [line({ label: 'BANANAS 1.32 LB', name: 'bananas', quantity: '1.32 lb', priceMinor: 77 })];

    const matches = matchReceiptLines(lines, items);

    expect(matches[0].line.label).toBe('BANANAS 1.32 LB');
    expect(matches[0].line.quantity).toBe('1.32 lb');
    expect(matches[0].line.priceMinor).toBe(77);
  });

  // ─── offListMatchId ──────────────────────────────────────────────────────

  it('offers an off-list catalog row for a line nothing on the list claimed', () => {
    const onListItem = makeItem({ name: 'Milk' });
    const offListItem = makeItem({ name: 'Bananas', onList: false });
    const lines = [line({ name: 'bananas' })];

    const matches = matchReceiptLines(lines, [onListItem, offListItem]);

    expect(matches[0].itemId).toBeNull();
    expect(matches[0].offListMatchId).toBe(offListItem.id);
    expect(matches[0].offListConfidence).toBe('exact');
  });

  it('reports offListConfidence as weak for a single coincidental shared word', () => {
    const offListItem = makeItem({ name: 'Heavy Cream', onList: false });
    const lines = [line({ name: 'Boston Cream Pie Ice Cream' })];

    const matches = matchReceiptLines(lines, [offListItem]);

    expect(matches[0].offListMatchId).toBe(offListItem.id);
    expect(matches[0].offListConfidence).toBe('weak');
  });

  it('never offers a catalog match for a line the list already claimed', () => {
    const items = [makeItem({ name: 'Milk' })];
    const lines = [line({ name: 'milk' })];

    const matches = matchReceiptLines(lines, items);

    expect(matches[0].itemId).toBe(items[0].id);
    expect(matches[0].offListMatchId).toBeNull();
  });

  it('leaves offListMatchId null when nothing off-list matches either', () => {
    const items = [
      makeItem({ name: 'Milk' }),
      makeItem({ name: 'Bananas', onList: false }),
    ];
    const lines = [line({ name: 'AA batteries' })];

    const matches = matchReceiptLines(lines, items);

    expect(matches[0].itemId).toBeNull();
    expect(matches[0].offListMatchId).toBeNull();
  });

  it('only lets one line claim a contested off-list row', () => {
    const offListItem = makeItem({ name: 'Milk', onList: false });
    const lines = [
      line({ label: 'MILK GAL', name: 'milk', priceMinor: 348 }),
      line({ label: 'MILK GAL', name: 'milk', priceMinor: 348 }),
    ];

    const matches = matchReceiptLines(lines, [offListItem]);

    const withMatch = matches.filter(m => m.offListMatchId === offListItem.id);
    expect(withMatch).toHaveLength(1);
  });
});

// ─── isPlausibleReceiptDate ──────────────────────────────────────────────────

describe('isPlausibleReceiptDate', () => {
  // No 'Z' — local time, matching how the function itself parses the date
  // key, so the comparison can't drift a day depending on the test runner's
  // timezone.
  const now = new Date('2026-08-20T10:00:00');

  it('accepts today', () => {
    expect(isPlausibleReceiptDate('2026-08-20', now)).toBe(true);
  });

  it('accepts a date in the past within the stale window', () => {
    expect(isPlausibleReceiptDate('2026-08-01', now)).toBe(true);
  });

  it('accepts exactly the stale boundary', () => {
    expect(isPlausibleReceiptDate('2026-05-22', now)).toBe(true); // 90 days back
  });

  it('rejects a date further back than the stale window', () => {
    expect(isPlausibleReceiptDate('2026-05-21', now)).toBe(false); // 91 days back
  });

  it('rejects a date in the future', () => {
    expect(isPlausibleReceiptDate('2026-08-21', now)).toBe(false);
  });

  it('rejects an unparseable date', () => {
    expect(isPlausibleReceiptDate('not-a-date', now)).toBe(false);
  });
});

// ─── matchReceiptShop ────────────────────────────────────────────────────────

describe('matchReceiptShop', () => {
  it('matches a store whose punctuation differs', () => {
    const shops = [makeShop("Trader Joe's")];
    expect(matchReceiptShop('Trader Joes', shops)?.id).toBe(shops[0].id);
  });

  it('matches a header carrying a branch number', () => {
    const shops = [makeShop('Safeway')];
    expect(matchReceiptShop('Safeway Store 1234', shops)?.id).toBe(shops[0].id);
  });

  it('refuses a store it does not recognize rather than picking the nearest', () => {
    const shops = [makeShop('Safeway'), makeShop('Costco')];
    expect(matchReceiptShop('Whole Foods Market', shops)).toBeNull();
  });

  it('does not match on a bare prefix of a word', () => {
    // "Met" must not claim "Metro" — a whole word or nothing.
    const shops = [makeShop('Metro')];
    expect(matchReceiptShop('Met', shops)).toBeNull();
  });

  it('returns null for an empty or unnamed header', () => {
    const shops = [makeShop('Safeway')];
    expect(matchReceiptShop('', shops)).toBeNull();
    expect(matchReceiptShop('   ', shops)).toBeNull();
  });

  it('returns null when the user has no stores', () => {
    expect(matchReceiptShop('Safeway', [])).toBeNull();
  });
});

// ─── receiptCautionsFor ──────────────────────────────────────────────────────

function makeLink(overrides: Partial<ItemShopLink> & { itemId: string; shopId: string }): ItemShopLink {
  return {
    purchaseCount: 1,
    lastPurchasedAt: '2026-08-01T00:00:00.000Z',
    unavailableAt: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null, priceHistory: [],
    productId: null,
    unavailableProductIds: {},
    ...overrides,
  };
}

/** The one match a line/item pair produces, for the caution tests below. */
function only(item: GroceryItem, l: Partial<ReceiptLine> & { name: string }) {
  return matchReceiptLines([line(l)], [item])[0];
}

describe('receiptCautionsFor', () => {
  it('flags a price wildly off what the item last cost', () => {
    const item = makeItem({ name: 'Milk', lastPriceMinor: 348 });
    const match = only(item, { name: 'milk', priceMinor: 1840 });

    const cautions = receiptCautionsFor(match, [item], null, []);

    expect(cautions).toEqual([{ kind: 'price', baselineMinor: 348, baselineQuantity: null }]);
  });

  it('says nothing about ordinary price movement', () => {
    // A sale and a year of inflation both live well inside the threshold.
    const item = makeItem({ name: 'Milk', lastPriceMinor: 348 });
    expect(receiptCautionsFor(only(item, { name: 'milk', priceMinor: 232 }), [item], null, [])).toEqual([]);
    expect(receiptCautionsFor(only(item, { name: 'milk', priceMinor: 449 }), [item], null, [])).toEqual([]);
  });

  it('flags a price far below the baseline too', () => {
    const item = makeItem({ name: 'Olive oil', lastPriceMinor: 1599 });
    const match = only(item, { name: 'olive oil', priceMinor: 99 });

    expect(receiptCautionsFor(match, [item], null, [])).toContainEqual(
      { kind: 'price', baselineMinor: 1599, baselineQuantity: null }
    );
  });

  it('says nothing when the item has never been priced', () => {
    // Ignorance, not evidence — the default state of most of the catalog.
    const item = makeItem({ name: 'Tahini', lastPriceMinor: null });
    const match = only(item, { name: 'tahini', priceMinor: 9999 });

    expect(receiptCautionsFor(match, [item], null, [])).toEqual([]);
  });

  it('prefers the named store’s own price as the baseline', () => {
    const item = makeItem({ name: 'Olive oil', lastPriceMinor: 399 });
    const links = [makeLink({ itemId: item.id, shopId: 'costco', lastPriceMinor: 1599 })];
    const match = only(item, { name: 'olive oil', priceMinor: 1699 });

    // Against the item's own 3.99 this would be a 4x jump; against Costco's
    // 15.99 it's an ordinary one.
    expect(receiptCautionsFor(match, [item], 'costco', links)).toEqual([]);
    expect(receiptCautionsFor(match, [item], null, links)).toHaveLength(1);
  });

  it('compares per unit when both sides name a measurable amount', () => {
    // Twice the price for twice the cheese is not a mismatch.
    const item = makeItem({ name: 'Cheddar', lastPriceMinor: 499, lastPriceQuantity: '8 oz' });
    const match = only(item, { name: 'cheddar', quantity: '32 oz', priceMinor: 1996 });

    expect(receiptCautionsFor(match, [item], null, [])).toEqual([]);
  });

  it('refuses to compare a qualified price against an unqualified one', () => {
    // "$4.99 for 8 oz" against a bare "$0.99" says nothing either way.
    const item = makeItem({ name: 'Cheddar', lastPriceMinor: 99, lastPriceQuantity: null });
    const match = only(item, { name: 'cheddar', quantity: '8 oz', priceMinor: 499 });

    expect(receiptCautionsFor(match, [item], null, [])).toEqual([]);
  });

  it('refuses to compare across dimensions', () => {
    const item = makeItem({ name: 'Milk', lastPriceMinor: 100, lastPriceQuantity: '1 gal' });
    const match = only(item, { name: 'milk', quantity: '2 lb', priceMinor: 9999 });

    expect(receiptCautionsFor(match, [item], null, [])).toEqual([]);
  });

  it('flags a quantity that disagrees with what the row asked for', () => {
    const item = makeItem({ name: 'Chicken', quantity: '3 lb' });
    const match = only(item, { name: 'chicken', quantity: '1 lb' });

    expect(receiptCautionsFor(match, [item], null, [])).toContainEqual(
      { kind: 'quantity', wanted: '3 lb' }
    );
  });

  it('tolerates a scale reading a little either side of what was asked', () => {
    const item = makeItem({ name: 'Chicken', quantity: '2 lb' });
    const match = only(item, { name: 'chicken', quantity: '2.05 lb' });

    expect(receiptCautionsFor(match, [item], null, [])).toEqual([]);
  });

  it('says nothing about quantity when only one side names one', () => {
    const item = makeItem({ name: 'Chicken', quantity: null });
    const match = only(item, { name: 'chicken', quantity: '1.32 lb' });

    expect(receiptCautionsFor(match, [item], null, [])).toEqual([]);
  });

  it('returns nothing for an unmatched line', () => {
    const item = makeItem({ name: 'Milk', lastPriceMinor: 348 });
    const match = only(item, { name: 'AA batteries', priceMinor: 9999 });

    expect(match.itemId).toBeNull();
    expect(receiptCautionsFor(match, [item], null, [])).toEqual([]);
  });
});

// ─── acceptedByDefault ───────────────────────────────────────────────────────

describe('acceptedByDefault', () => {
  it('checks a confident match with nothing questionable about it', () => {
    const items = [makeItem({ name: 'Milk', lastPriceMinor: 348 })];
    const matches = matchReceiptLines([line({ name: 'milk', priceMinor: 379 })], items);

    expect(acceptedByDefault(matches, items, null, [])).toEqual([items[0].id]);
  });

  it('does not check a match whose price says it is the wrong row', () => {
    const items = [makeItem({ name: 'Milk', lastPriceMinor: 348 })];
    const matches = matchReceiptLines([line({ name: 'milk', priceMinor: 1840 })], items);

    // Still shown — the user may know something the app doesn't — but the
    // burden is on them to say so.
    expect(matches[0].itemId).toBe(items[0].id);
    expect(acceptedByDefault(matches, items, null, [])).toEqual([]);
  });

  it('still checks a match that merely came in a different size', () => {
    const items = [makeItem({ name: 'Chicken', quantity: '3 lb' })];
    const matches = matchReceiptLines([line({ name: 'chicken', quantity: '1 lb' })], items);

    expect(acceptedByDefault(matches, items, null, [])).toEqual([items[0].id]);
  });

  it('never checks a weak match', () => {
    const items = [makeItem({ name: 'Chicken thighs' })];
    const matches = matchReceiptLines([line({ name: 'chicken breast' })], items);

    expect(acceptedByDefault(matches, items, null, [])).toEqual([]);
  });

  it('re-decides when the named store changes', () => {
    const items = [makeItem({ name: 'Olive oil', lastPriceMinor: 399 })];
    const links = [makeLink({ itemId: items[0].id, shopId: 'costco', lastPriceMinor: 1599 })];
    const matches = matchReceiptLines([line({ name: 'olive oil', priceMinor: 1699 })], items);

    // The same receipt reads as a mismatch against the item's own price and as
    // ordinary against Costco's — which is exactly why this can't be settled
    // once at match time.
    expect(acceptedByDefault(matches, items, null, links)).toEqual([]);
    expect(acceptedByDefault(matches, items, 'costco', links)).toEqual([items[0].id]);
  });
});

// ─── the baseline the price check measures against ───────────────────────────

describe('receiptCautionsFor, against a run of prices', () => {
  it('does not cry wolf over a correct match following a sale', () => {
    // The reason a median exists. Measured against `lastPriceMinor` alone —
    // last week's half-price 1.99 — this ordinary 4.09 is a 2x+ move, and with
    // one more sale in the run it would clear the threshold outright.
    const item = makeItem({
      name: 'Olive oil',
      lastPriceMinor: 199,
      priceHistory: [
        { minor: 199, quantity: null, at: '2026-08-01T00:00:00.000Z' },
        { minor: 399, quantity: null, at: '2026-07-01T00:00:00.000Z' },
        { minor: 419, quantity: null, at: '2026-06-01T00:00:00.000Z' },
        { minor: 409, quantity: null, at: '2026-05-01T00:00:00.000Z' },
      ],
    });
    const match = only(item, { name: 'olive oil', priceMinor: 409 });

    expect(receiptCautionsFor(match, [item], null, [])).toEqual([]);
  });

  it('still catches a real mismatch, measured against the median', () => {
    const item = makeItem({
      name: 'Olive oil',
      lastPriceMinor: 399,
      priceHistory: [
        { minor: 399, quantity: null, at: '2026-08-01T00:00:00.000Z' },
        { minor: 419, quantity: null, at: '2026-07-01T00:00:00.000Z' },
        { minor: 409, quantity: null, at: '2026-06-01T00:00:00.000Z' },
      ],
    });
    const match = only(item, { name: 'olive oil', priceMinor: 4999 });

    expect(receiptCautionsFor(match, [item], null, [])).toContainEqual(
      { kind: 'price', baselineMinor: 409, baselineQuantity: null }
    );
  });

  it('prefers the named store’s own run over the item’s', () => {
    const item = makeItem({
      name: 'Olive oil',
      lastPriceMinor: 399,
      priceHistory: [
        { minor: 399, quantity: null, at: '2026-08-01T00:00:00.000Z' },
        { minor: 399, quantity: null, at: '2026-07-01T00:00:00.000Z' },
      ],
    });
    const links = [makeLink({
      itemId: item.id,
      shopId: 'costco',
      priceHistory: [
        { minor: 1599, quantity: null, at: '2026-08-01T00:00:00.000Z' },
        { minor: 1649, quantity: null, at: '2026-07-01T00:00:00.000Z' },
      ],
    })];
    const match = only(item, { name: 'olive oil', priceMinor: 1699 });

    // Costco sells the big bottle; the item's own median describes a different
    // shop entirely and would flag this for nothing.
    expect(receiptCautionsFor(match, [item], 'costco', links)).toEqual([]);
    expect(receiptCautionsFor(match, [item], null, links)).toHaveLength(1);
  });

  it('falls back to the last price when there is no run yet', () => {
    // An install that upgraded into the column behaves exactly as it did.
    const item = makeItem({ name: 'Milk', lastPriceMinor: 348, priceHistory: [] });
    const match = only(item, { name: 'milk', priceMinor: 1840 });

    expect(receiptCautionsFor(match, [item], null, [])).toContainEqual(
      { kind: 'price', baselineMinor: 348, baselineQuantity: null }
    );
  });
});

describe('a remembered alias', () => {
  const line = (label: string, name: string): ReceiptLine =>
    ({ label, name, quantity: '', priceMinor: 348 });

  it('claims a row two names would never have matched', () => {
    const milk = makeItem({ name: 'Milk' });
    const lines = [line('GV MLK 2% GAL', 'GV MLK 2% GAL')];

    expect(matchReceiptLines(lines, [milk])[0].itemId).toBeNull();

    const [remembered] = matchReceiptLines(lines, [milk], () => milk.id);
    expect(remembered.itemId).toBe(milk.id);
    expect(remembered.confidence).toBe('remembered');
  });

  it('outranks an exact name match on another row', () => {
    const milk = makeItem({ name: 'Milk' });
    const cream = makeItem({ name: 'Cream' });
    const [match] = matchReceiptLines([line('CREAM', 'cream')], [milk, cream], () => milk.id);
    expect(match.itemId).toBe(milk.id);
  });

  it('is ignored when it names a row that is gone', () => {
    const milk = makeItem({ name: 'Milk' });
    const [match] = matchReceiptLines([line('MILK', 'milk')], [milk], () => 'deleted-id');
    // Falls back to the name match rather than resolving to nothing, which is
    // what makes a stale alias a non-event instead of a silent suppression.
    expect(match.itemId).toBe(milk.id);
    expect(match.confidence).toBe('exact');
  });

  it('resolves an off-list row as an add-as-bought suggestion', () => {
    const bread = makeItem({ name: 'Bread', onList: false });
    const [match] = matchReceiptLines([line('WW SNDWCH LF', 'loaf')], [bread], () => bread.id);
    expect(match.itemId).toBeNull();
    expect(match.offListMatchId).toBe(bread.id);
  });

  it('is pre-checked even when the price looks wrong', () => {
    // A price caution demotes a guess. Someone confirmed this one, so a wild
    // price is news about the price rather than evidence of a misread.
    const milk = makeItem({ name: 'Milk', priceHistory: [
      { minor: 20, quantity: null, at: '2026-01-01T00:00:00.000Z' },
      { minor: 20, quantity: null, at: '2026-01-02T00:00:00.000Z' },
    ] });
    const lines = [line('GV MLK 2% GAL', 'GV MLK 2% GAL')];

    const guessed = matchReceiptLines([line('MILK', 'milk')], [milk]);
    expect(acceptedByDefault(guessed, [milk], null, [])).toEqual([]);

    const remembered = matchReceiptLines(lines, [milk], () => milk.id);
    expect(acceptedByDefault(remembered, [milk], null, [])).toEqual([milk.id]);
  });
});
