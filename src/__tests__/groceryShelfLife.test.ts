import {
  SHELF_LIFE_LEXICON,
  clampExpiryDays,
  defaultExpiresAt,
  describeExpiry,
  expiresAtForPurchase,
  expiryDaysFromNow,
  expiryKeyFor,
  shelfLifeDaysFor,
  openShelfLifeDaysFor,
  expiresAtForOpening,
} from '../utils/groceryShelfLife';
import { groceryNameKey } from '../utils/groceryParse';
import { GROCERY_EXPIRY_DAYS_MAX } from '../types';
import type { GroceryItem } from '../types';

function item(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: 'item-1',
    name: 'Spinach',
    nameKey: 'spinach',
    preferredProductId: null,
    productStrict: false,
    aisle: 'Produce',
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    checked: false,
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
    frozenAt: null,
    openedAt: null,
    runningLowAt: null,
    shelfLifeDays: null,
    useUpTask: null,
    pantryCheckDeclinedAt: null,
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    varietyOfKey: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null, priceHistory: [],
    ...overrides,
  };
}

// dateUtils reaches the settings store for dayResetTime, which reaches
// expo-sqlite — same stub leftovers.test.ts keeps for the same reason.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const NOW = new Date('2026-08-12T09:00:00');

describe('SHELF_LIFE_LEXICON', () => {
  it('is keyed by groceryNameKey, so every entry can actually be looked up', () => {
    for (const name of Object.keys(SHELF_LIFE_LEXICON)) {
      expect(groceryNameKey(name)).toBe(name);
    }
  });

  it('holds only positive day counts', () => {
    for (const [name, days] of Object.entries(SHELF_LIFE_LEXICON)) {
      expect(typeof days).toBe('number');
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(GROCERY_EXPIRY_DAYS_MAX);
      expect(name).toBe(name.trim());
    }
  });

  it('leaves store-cupboard staples out — no date means no task', () => {
    for (const staple of ['rice', 'pasta', 'flour', 'sugar', 'olive oil', 'dish soap', 'paper towels']) {
      expect(shelfLifeDaysFor(staple)).toBeNull();
    }
  });
});

describe('shelfLifeDaysFor', () => {
  it('matches a known perishable', () => {
    expect(shelfLifeDaysFor('spinach')).toBe(5);
  });

  it('normalises case and spacing the way the catalog does', () => {
    expect(shelfLifeDaysFor('  Spinach ')).toBe(5);
  });

  it('refuses a near miss rather than guessing across it', () => {
    // "baby spinach" is its own catalog row with its own key; claiming
    // spinach's five days for it would date food the lexicon never saw.
    expect(shelfLifeDaysFor('baby spinach')).toBeNull();
  });

  it('has nothing to say about an empty name', () => {
    expect(shelfLifeDaysFor('   ')).toBeNull();
  });
});

describe('defaultExpiresAt', () => {
  it('dates a recognised item from the day it was bought', () => {
    expect(defaultExpiresAt('spinach', NOW)).toBe('2026-08-17');
  });

  it('leaves an unrecognised item with no date at all', () => {
    expect(defaultExpiresAt('rice', NOW)).toBeNull();
  });
});

describe('expiresAtForPurchase', () => {
  it('falls back to the lexicon when the item has no override', () => {
    expect(expiresAtForPurchase(item({ name: 'spinach', shelfLifeDays: null }), NOW)).toBe('2026-08-17');
  });

  it('uses the shopper\'s own correction ahead of the lexicon', () => {
    expect(expiresAtForPurchase(item({ name: 'spinach', shelfLifeDays: 10 }), NOW)).toBe('2026-08-22');
  });

  it('gives a name the lexicon has never heard of a date, once the shopper has said how long it keeps', () => {
    expect(expiresAtForPurchase(item({ name: 'homemade stock', shelfLifeDays: 4 }), NOW)).toBe('2026-08-16');
  });

  it('still leaves an unrecognised item with no override undated', () => {
    expect(expiresAtForPurchase(item({ name: 'rice', shelfLifeDays: null }), NOW)).toBeNull();
  });
});

describe('expiryKeyFor / expiryDaysFromNow', () => {
  it('round-trips a count through a day key', () => {
    const key = expiryKeyFor(NOW, 4);
    expect(key).toBe('2026-08-16');
    expect(expiryDaysFromNow(key, NOW)).toBe(4);
  });

  it('counts in calendar days, not 24-hour blocks', () => {
    // Bought at nine in the morning, read late at night: still four days.
    expect(expiryDaysFromNow('2026-08-16', new Date('2026-08-12T23:30:00'))).toBe(4);
  });

  it('clamps a day already past to zero so the stepper can hold it', () => {
    expect(expiryDaysFromNow('2026-08-01', NOW)).toBe(0);
  });

  it('clamps a wild count into the sayable range', () => {
    expect(clampExpiryDays(-5)).toBe(0);
    expect(clampExpiryDays(10_000)).toBe(GROCERY_EXPIRY_DAYS_MAX);
    expect(clampExpiryDays(Number.NaN)).toBe(0);
    expect(clampExpiryDays(3.4)).toBe(3);
  });
});

describe('describeExpiry', () => {
  it('names the near days rather than counting them', () => {
    expect(describeExpiry('2026-08-12', NOW)).toBe('Use by today');
    expect(describeExpiry('2026-08-13', NOW)).toBe('Use by tomorrow');
  });

  it('counts what is left further out', () => {
    expect(describeExpiry('2026-08-15', NOW)).toBe('3 days left');
  });

  it('says how far past, not that it is overdue — food past its day is questionable, not late', () => {
    expect(describeExpiry('2026-08-11', NOW)).toBe('1 day past');
    expect(describeExpiry('2026-08-09', NOW)).toBe('3 days past');
  });
});

describe('the open shelf life', () => {
  const NOW = new Date(2026, 7, 13, 15, 0, 0);

  it('knows the names where opening is what starts the clock', () => {
    expect(openShelfLifeDaysFor('Salsa')).toBe(7);
    expect(openShelfLifeDaysFor('cream cheese')).toBe(14);
  });

  // Opening a bag of spinach doesn't restart anything, so the table is silent
  // about produce, meat and bakery on purpose.
  it('says nothing about a name opening tells you nothing about', () => {
    expect(openShelfLifeDaysFor('Spinach')).toBeNull();
    expect(openShelfLifeDaysFor('Chicken breast')).toBeNull();
    expect(openShelfLifeDaysFor('Bicarbonate of soda')).toBeNull();
  });

  it('counts from the opening, not from the purchase', () => {
    const salsa = item({ name: 'Salsa', expiresAt: '2026-05-01' });
    expect(expiresAtForOpening(salsa, NOW)).toBe('2026-08-20');
  });

  // The reason this replaces the day rather than taking the earlier of the
  // two: the `min` of a day that already passed and "today plus 7" is the day
  // that already passed, so opening would be inert in exactly the case it
  // exists for.
  it('re-anchors a day that has already gone by rather than keeping it', () => {
    const stale = item({ name: 'Salsa', expiresAt: '2026-05-01' });
    expect(expiresAtForOpening(stale, NOW)! > '2026-08-13').toBe(true);
  });

  it('is null for a name the table has never heard of, so the day is left alone', () => {
    expect(expiresAtForOpening(item({ name: 'Spinach' }), NOW)).toBeNull();
  });

  // shelfLifeDays means "this one keeps N days once bought", which is a claim
  // about the shelf and not about the open jar.
  it('ignores a hand-corrected shelf life, which is about the sealed jar', () => {
    const salsa = item({ name: 'Salsa', shelfLifeDays: 90 });
    expect(expiresAtForOpening(salsa, NOW)).toBe('2026-08-20');
  });

  // Milk bought a week ago with one day left on its sealed clock doesn't earn
  // a fresh 7 days just because it got opened today — the sealed day is still
  // sooner and still true, so opening must not hand back time it hasn't lost.
  it('keeps the sooner day when the sealed one is still ahead', () => {
    const milk = item({ name: 'Milk', expiresAt: '2026-08-14' });
    expect(expiresAtForOpening(milk, NOW)).toBe('2026-08-14');
  });

  // The reverse still holds: when opening is the sooner day (a jar opened
  // right after a generous purchase guess), the opened count wins.
  it('takes the opened day when it is the sooner of the two', () => {
    const salsa = item({ name: 'Salsa', expiresAt: '2026-09-01' });
    expect(expiresAtForOpening(salsa, NOW)).toBe('2026-08-20');
  });
});
