import {
  matchReceiptLines,
  matchReceiptShop,
  receiptMatchConfidence,
} from '../utils/receiptMatch';
import { groceryNameKey } from '../utils/groceryParse';
import type { ReceiptLine } from '../services/aiSuggestions';
import type { GroceryItem, Shop } from '../types';

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
    shelfLifeDays: null,
    useUpTask: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
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

    const { matches, confidentIds } = matchReceiptLines(lines, items);

    expect(matches[0].itemId).toBe(items[0].id);
    expect(matches[0].confidence).toBe('exact');
    expect(confidentIds).toEqual([items[0].id]);
  });

  it('leaves a weak match unclaimed by confidentIds so it cannot pre-check', () => {
    const items = [makeItem({ name: 'Chicken thighs' })];
    const lines = [line({ name: 'chicken breast' })];

    const { matches, confidentIds } = matchReceiptLines(lines, items);

    // Still surfaced — the user may well have meant it — but never pre-ticked.
    expect(matches[0].itemId).toBe(items[0].id);
    expect(matches[0].confidence).toBe('weak');
    expect(confidentIds).toEqual([]);
  });

  it('ignores rows that are not on the list', () => {
    const items = [makeItem({ name: 'Milk', onList: false })];
    const lines = [line({ name: 'milk' })];

    const { matches, confidentIds } = matchReceiptLines(lines, items);

    expect(matches[0].itemId).toBeNull();
    expect(confidentIds).toEqual([]);
  });

  it('reports an unmatched line rather than forcing it onto the nearest row', () => {
    const items = [makeItem({ name: 'Milk' })];
    const lines = [line({ name: 'AA batteries' })];

    const { matches } = matchReceiptLines(lines, items);

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

    const { matches, confidentIds } = matchReceiptLines(lines, items);

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

    const { matches } = matchReceiptLines(lines, items);

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

    const { matches } = matchReceiptLines(lines, items);

    expect(matches[0].itemId).toBe(items[1].id);
    expect(matches[0].confidence).toBe('exact');
  });

  it('is stable regardless of the order the list happens to be in', () => {
    const a = makeItem({ name: 'Chicken breast tenders' });
    const b = makeItem({ name: 'Chicken' });
    const lines = [line({ name: 'chicken' })];

    expect(matchReceiptLines(lines, [a, b]).matches[0].itemId)
      .toBe(matchReceiptLines(lines, [b, a]).matches[0].itemId);
  });

  it('returns nothing for an empty receipt', () => {
    expect(matchReceiptLines([], [makeItem({ name: 'Milk' })]))
      .toEqual({ matches: [], confidentIds: [] });
  });

  it('carries the line through untouched so the sheet can show what was printed', () => {
    const items = [makeItem({ name: 'Bananas' })];
    const lines = [line({ label: 'BANANAS 1.32 LB', name: 'bananas', quantity: '1.32 lb', priceMinor: 77 })];

    const { matches } = matchReceiptLines(lines, items);

    expect(matches[0].line.label).toBe('BANANAS 1.32 LB');
    expect(matches[0].line.quantity).toBe('1.32 lb');
    expect(matches[0].line.priceMinor).toBe(77);
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
