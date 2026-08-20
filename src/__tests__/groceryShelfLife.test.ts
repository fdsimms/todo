import {
  SHELF_LIFE_LEXICON,
  clampExpiryDays,
  defaultExpiresAt,
  describeExpiry,
  expiresAtForPurchase,
  expiryDaysFromNow,
  expiryKeyFor,
  shelfLifeDaysFor,
} from '../utils/groceryShelfLife';
import { groceryNameKey } from '../utils/groceryParse';
import { GROCERY_EXPIRY_DAYS_MAX } from '../types';
import type { GroceryItem } from '../types';

function item(overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: 'item-1',
    name: 'Spinach',
    nameKey: 'spinach',
    brand: null,
    brandStrict: false,
    variant: null,
    aisle: 'Produce',
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
