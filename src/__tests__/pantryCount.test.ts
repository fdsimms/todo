import {
  describeOnHandBreakdown,
  describeOnHandCount,
  onHandCountFor,
  productsWithCount,
  PANTRY_COUNT_MAX,
  PANTRY_COUNT_MIN,
} from '../utils/pantryCount';
import { describeProduct } from '../utils/groceryProduct';
import type { GroceryItem, ItemProduct } from '../types';

function item(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: 'mayo',
    name: 'Vegan mayonnaise',
    nameKey: 'vegan mayonnaise',
    preferredProductId: null,
    productStrict: false,
    aisle: 'Other',
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    checked: false,
    inCatalog: true,
    sortOrder: 0,
    purchaseCount: 0,
    lastAddedAt: null,
    lastPurchasedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    onHandUntil: null,
    onHandCount: null,
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
    lastPriceQuantity: null,
    priceHistory: [],
    ...overrides,
  };
}

function product(overrides: Partial<ItemProduct> & { id: string }): ItemProduct {
  return {
    itemId: 'mayo',
    brand: null,
    variant: null,
    productKey: overrides.id,
    rating: null,
    note: '',
    purchaseCount: 0,
    lastPurchasedAt: null,
    onHandCount: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── onHandCountFor ─────────────────────────────────────────────────────────

describe('onHandCountFor', () => {
  // The state nearly every row is in, and the one thing a caller must not read
  // as zero: nobody has counted, which is ignorance rather than absence.
  it('is null when nothing has been counted', () => {
    expect(onHandCountFor(item(), [])).toBeNull();
    expect(onHandCountFor(item(), [product({ id: 'hellmanns' })])).toBeNull();
  });

  it('counts the item bucket on its own', () => {
    expect(onHandCountFor(item({ onHandCount: 2 }), [])).toBe(2);
  });

  // The case the feature exists for: two jars, and one of them is a different
  // brand than the other.
  it('adds the boxes to the item bucket', () => {
    const products = [
      product({ id: 'hellmanns', brand: "Hellmann's", onHandCount: 1 }),
      product({ id: 'store', brand: 'store brand', onHandCount: 1 }),
    ];
    expect(onHandCountFor(item(), products)).toBe(2);
    // And a third jar nobody recorded a brand for sits in the item's own
    // bucket rather than forcing a product to exist for it.
    expect(onHandCountFor(item({ onHandCount: 1 }), products)).toBe(3);
  });

  it('ignores the boxes of other items', () => {
    const products = [
      product({ id: 'hellmanns', onHandCount: 1 }),
      product({ id: 'other', itemId: 'ketchup', onHandCount: 5 }),
    ];
    expect(onHandCountFor(item(), products)).toBe(1);
  });

  // Only old or synced rows can hold a zero — the stepper's floor is 1 and −
  // at the floor clears to null. It reads as "nothing counted" rather than as
  // an assertion of absence, which is what the "Out of it" pill writes.
  it('reads a zero or a negative as nothing counted', () => {
    expect(onHandCountFor(item({ onHandCount: 0 }), [])).toBeNull();
    expect(onHandCountFor(item({ onHandCount: -3 }), [])).toBeNull();
    expect(
      onHandCountFor(item({ onHandCount: 2 }), [product({ id: 'x', onHandCount: 0 })])
    ).toBe(2);
  });

  it('floors a fractional count rather than carrying it into the total', () => {
    expect(onHandCountFor(item({ onHandCount: 2.7 }), [])).toBe(2);
  });

  // The stepper's own range, asserted here so the floor and the null-clearing
  // rule above can't drift apart from the control that produces them.
  it('has a floor of one, so a count only ever says you have some', () => {
    expect(PANTRY_COUNT_MIN).toBe(1);
    expect(PANTRY_COUNT_MAX).toBeGreaterThan(PANTRY_COUNT_MIN);
  });
});

// ─── productsWithCount ──────────────────────────────────────────────────────

describe('productsWithCount', () => {
  it('is the item\'s own boxes that carry a number', () => {
    const counted = product({ id: 'hellmanns', brand: "Hellmann's", onHandCount: 1 });
    const uncounted = product({ id: 'store', brand: 'store brand' });
    const elsewhere = product({ id: 'other', itemId: 'ketchup', onHandCount: 2 });
    expect(productsWithCount(item(), [counted, uncounted, elsewhere])).toEqual([counted]);
  });
});

// ─── describeOnHandCount ────────────────────────────────────────────────────

describe('describeOnHandCount', () => {
  it('borrows probablyHaveReason\'s words and adds the number', () => {
    expect(describeOnHandCount(1)).toBe('1 on hand');
    expect(describeOnHandCount(2)).toBe('2 on hand');
  });
});

// ─── describeOnHandBreakdown ────────────────────────────────────────────────

describe('describeOnHandBreakdown', () => {
  it('is empty when nothing has been counted, so a row renders nothing at all', () => {
    expect(describeOnHandBreakdown(item(), [], describeProduct)).toBe('');
  });

  it('names the boxes the count is made of', () => {
    const products = [
      product({ id: 'hellmanns', brand: "Hellmann's", onHandCount: 1 }),
      product({ id: 'kensington', brand: 'Sir Kensington', onHandCount: 1 }),
    ];
    expect(describeOnHandBreakdown(item(), products, describeProduct)).toBe(
      "2 on hand · Hellmann's, Sir Kensington"
    );
  });

  // The unattributed jars are already in the number in front; spelling them out
  // as "and 1 other" would ask the reader to reconcile the two.
  it('gives the count alone when no box is named', () => {
    expect(describeOnHandBreakdown(item({ onHandCount: 2 }), [], describeProduct)).toBe(
      '2 on hand'
    );
  });

  it('counts the unnamed jars but does not list them', () => {
    const products = [product({ id: 'hellmanns', brand: "Hellmann's", onHandCount: 1 })];
    expect(describeOnHandBreakdown(item({ onHandCount: 1 }), products, describeProduct)).toBe(
      "2 on hand · Hellmann's"
    );
  });
});
