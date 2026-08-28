import {
  catalogItemForKey,
  pluralKeyVariants,
  resolvePluralKey,
} from '../utils/groceryPlural';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem } from '../types';

let seq = 0;
function makeItem(name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: `id-${++seq}`,
    name,
    nameKey: groceryNameKey(name),
    preferredProductId: null,
    productStrict: false,
    aisle: 'Other',
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    checked: false,
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
    pantryCheckDeclinedAt: null,
    pantryReviewedAt: null,
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    varietyOfKey: null,
    backfillDismissedFields: [],
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    priceHistory: [],
    ...overrides,
  };
}

// ─── pluralKeyVariants ───────────────────────────────────────────────────────

describe('pluralKeyVariants', () => {
  it('offers the plural of a singular and the singular of a plural', () => {
    expect(pluralKeyVariants('pepper')).toContain('peppers');
    expect(pluralKeyVariants('peppers')).toContain('pepper');
  });

  it('only varies the last word', () => {
    expect(pluralKeyVariants('serrano pepper')).toContain('serrano peppers');
    expect(pluralKeyVariants('green beans')).toContain('green bean');
    expect(pluralKeyVariants('green beans')).not.toContain('greens beans');
  });

  it('knows the endings that take -es', () => {
    expect(pluralKeyVariants('peach')).toContain('peaches');
    expect(pluralKeyVariants('peaches')).toContain('peach');
    expect(pluralKeyVariants('box')).toContain('boxes');
    expect(pluralKeyVariants('boxes')).toContain('box');
    expect(pluralKeyVariants('potato')).toContain('potatoes');
    expect(pluralKeyVariants('potatoes')).toContain('potato');
  });

  it('knows -ies and -ves', () => {
    expect(pluralKeyVariants('berry')).toContain('berries');
    expect(pluralKeyVariants('berries')).toContain('berry');
    expect(pluralKeyVariants('knife')).toContain('knives');
    expect(pluralKeyVariants('knives')).toContain('knife');
    expect(pluralKeyVariants('loaves')).toContain('loaf');
  });

  it('does not stem a word ending in a double s', () => {
    expect(pluralKeyVariants('watercress')).not.toContain('watercre');
    expect(pluralKeyVariants('watercress')).not.toContain('watercres');
  });

  // "couscous" isn't a plural, and the table can't know that — it offers
  // "couscou" like any other word ending in a single s. Harmless, because a
  // variant is only ever looked up: no row is keyed "couscou", so it resolves
  // to nothing and the name is minted as typed.
  it('lets a stem that is not a word resolve to nothing', () => {
    expect(resolvePluralKey('couscous', ['milk', 'eggs', 'couscous salad'])).toBeNull();
  });

  // The whole file only ever *looks up* what it generates, so a bogus stem is
  // harmless — but a bogus stem that happens to be a real, different grocery
  // is not, which is why "-es" is only dropped after a sibilant.
  it('does not offer a bare stem for a word that merely ends in -es', () => {
    expect(pluralKeyVariants('grapes')).toContain('grape');
    expect(pluralKeyVariants('grapes')).not.toContain('grap');
  });

  it('says nothing about a word too short to have a plural worth guessing', () => {
    expect(pluralKeyVariants('as')).toEqual([]);
    expect(pluralKeyVariants('')).toEqual([]);
  });

  it('is symmetric — whichever half is in the catalog, the other finds it', () => {
    const pairs: Array<[string, string]> = [
      ['pepper', 'peppers'],
      ['serrano pepper', 'serrano peppers'],
      ['peach', 'peaches'],
      ['box', 'boxes'],
      ['potato', 'potatoes'],
      ['berry', 'berries'],
      ['knife', 'knives'],
      ['loaf', 'loaves'],
      ['egg', 'eggs'],
    ];
    for (const [singular, plural] of pairs) {
      expect(pluralKeyVariants(singular)).toContain(plural);
      expect(pluralKeyVariants(plural)).toContain(singular);
    }
  });
});

// ─── resolvePluralKey ────────────────────────────────────────────────────────

describe('resolvePluralKey', () => {
  it('finds the plural row a singular line means', () => {
    expect(resolvePluralKey('serrano pepper', ['milk', 'serrano peppers'])).toBe('serrano peppers');
  });

  it('finds the singular row a plural line means', () => {
    expect(resolvePluralKey('eggs', ['egg', 'flour'])).toBe('egg');
  });

  it('says nothing when the key itself is in the catalog', () => {
    expect(resolvePluralKey('pepper', ['pepper', 'peppers'])).toBeNull();
  });

  it('says nothing when the key is in the catalog and listed after its variant', () => {
    expect(resolvePluralKey('pepper', ['peppers', 'pepper'])).toBeNull();
  });

  it('refuses an ambiguous pair rather than picking one', () => {
    expect(resolvePluralKey('leaves', ['leaf', 'leave'])).toBeNull();
  });

  it('tolerates the same key appearing twice', () => {
    expect(resolvePluralKey('egg', ['eggs', 'eggs'])).toBe('eggs');
  });

  it('says nothing about a name the catalog has nothing like', () => {
    expect(resolvePluralKey('gochujang', ['milk', 'eggs'])).toBeNull();
  });
});

// ─── catalogItemForKey ───────────────────────────────────────────────────────

describe('catalogItemForKey', () => {
  it('prefers an exact key', () => {
    const items = [makeItem('Peppers'), makeItem('Pepper')];
    expect(catalogItemForKey('pepper', items)?.name).toBe('Pepper');
  });

  it('falls back to the plural row', () => {
    const items = [makeItem('Milk'), makeItem('Serrano peppers')];
    expect(catalogItemForKey('serrano pepper', items)?.name).toBe('Serrano peppers');
  });

  it('answers null for an empty key rather than the first row', () => {
    expect(catalogItemForKey('', [makeItem('Milk')])).toBeNull();
  });

  it('answers null when nothing resembles the key', () => {
    expect(catalogItemForKey('gochujang', [makeItem('Milk')])).toBeNull();
  });
});
