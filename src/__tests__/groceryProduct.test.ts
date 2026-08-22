import {
  describeProduct,
  describeProductPurchases,
  lacksPreferredProduct,
  parseUnavailableProductIds,
  preferredProductOf,
  productKeyFor,
  productsForItem,
} from '../utils/groceryProduct';
import type { ItemProduct } from '../types';

function product(overrides: Partial<ItemProduct> & { id: string }): ItemProduct {
  return {
    itemId: 'bread',
    brand: null,
    variant: null,
    productKey: overrides.id,
    onHandCount: null,
    rating: null,
    note: '',
    purchaseCount: 0,
    lastPurchasedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}


describe('describeProduct', () => {
  // One caption, not two: the row can already be four captions tall, and these
  // two name a single product between them.
  it('joins a brand and a variant with a space', () => {
    expect(describeProduct({ brand: 'Good Culture', variant: 'low fat' })).toBe(
      'Good Culture low fat'
    );
  });

  it('gives either one on its own, verbatim', () => {
    expect(describeProduct({ brand: 'Oatly', variant: null })).toBe('Oatly');
    // The state the row has to get right: caring about the milk fat and not the
    // dairy. It reads as qualifying the name above it, and nothing is added to
    // announce that it isn't a brand.
    expect(describeProduct({ brand: null, variant: 'low fat' })).toBe('low fat');
  });

  it('is null when the item names neither', () => {
    expect(describeProduct({ brand: null, variant: null })).toBeNull();
  });

  // Both setters trim to null, so this is belt and braces — but a row written
  // before they did, or by a future caller, must not caption itself with a
  // blank line or a leading space.
  it('treats a blank field as absent', () => {
    expect(describeProduct({ brand: '  ', variant: 'low fat' })).toBe('low fat');
    expect(describeProduct({ brand: 'Oatly', variant: '   ' })).toBe('Oatly');
    expect(describeProduct({ brand: '', variant: '' })).toBeNull();
  });
});

describe('productKeyFor', () => {
  // The identity, so two spellings of one box can't both exist — the same
  // normalisation `groceryNameKey` does for an item's own name.
  it('folds case, spacing and diacritics away', () => {
    expect(productKeyFor("ARNOLD'S", 'Whole  Wheat')).toBe(productKeyFor("arnold's", 'whole wheat'));
    expect(productKeyFor('Jalapeño', null)).toBe(productKeyFor('jalapeno', null));
  });

  // It is `groceryNameKey` on each half, so punctuation becomes a space rather
  // than vanishing — "Arnold's" and "Arnolds" are two keys, exactly as
  // "Trader Joe's" and "Trader Joes" are two shops. Consistency with the rest
  // of the app beats a special case for apostrophes, and the sheet's chips
  // make re-picking the spelling you already used one tap.
  it('does not fold an apostrophe away, matching item and shop keys', () => {
    expect(productKeyFor("Arnold's", null)).not.toBe(productKeyFor('Arnolds', null));
  });

  it('keeps the two halves apart, so a brandless variant cannot collide', () => {
    expect(productKeyFor("Arnold's", 'wheat')).not.toBe(productKeyFor(null, "Arnold's wheat"));
  });

  it('distinguishes a brand-only box from a variant-only one', () => {
    expect(productKeyFor("Arnold's", null)).not.toBe(productKeyFor(null, "Arnold's"));
  });

  // Empty is the caller's cue that this is the item itself, not a product of
  // it. addProduct refuses it outright.
  it('is empty when neither half names anything', () => {
    expect(productKeyFor(null, null)).toBe('');
    expect(productKeyFor('  ', '')).toBe('');
    // And a string that normalises to nothing at all, not just whitespace.
    expect(productKeyFor('???', null)).toBe('');
  });
});

describe('productsForItem', () => {
  const preferred = product({ id: 'preferred', rating: 'avoid' });
  const loved = product({ id: 'loved', rating: 'loved' });
  const plain = product({ id: 'plain' });
  const avoided = product({ id: 'avoided', rating: 'avoid' });
  const all = [avoided, plain, loved, preferred];

  it('puts the preferred one first, whatever it is rated', () => {
    expect(productsForItem('bread', all, 'preferred')[0].id).toBe('preferred');
  });

  it('then ranks loved, then unrated, then never-again', () => {
    expect(productsForItem('bread', all, 'preferred').map(p => p.id))
      .toEqual(['preferred', 'loved', 'plain', 'avoided']);
  });

  // A rating sorts rather than filters: remembering that you hated it is the
  // point, and hiding it takes the memory away exactly when you're standing in
  // front of the shelf about to buy it again.
  it('never drops a product for being rated badly', () => {
    expect(productsForItem('bread', all).map(p => p.id)).toContain('avoided');
  });

  it('breaks a tie on purchases, then on age, so the order is stable', () => {
    const items = [
      product({ id: 'newer', createdAt: '2026-02-01T00:00:00.000Z' }),
      product({ id: 'bought', purchaseCount: 4 }),
      product({ id: 'older', createdAt: '2026-01-01T00:00:00.000Z' }),
    ];
    expect(productsForItem('bread', items).map(p => p.id)).toEqual(['bought', 'older', 'newer']);
  });

  it('holds to its own item', () => {
    const mixed = [product({ id: 'a' }), product({ id: 'b', itemId: 'milk' })];
    expect(productsForItem('bread', mixed).map(p => p.id)).toEqual(['a']);
  });
});

describe('preferredProductOf', () => {
  const arnolds = product({ id: 'arnolds' });

  it('resolves the pointer', () => {
    expect(preferredProductOf({ preferredProductId: 'arnolds' }, [arnolds])).toBe(arnolds);
  });

  it('is null for the common no-opinion case', () => {
    expect(preferredProductOf({ preferredProductId: null }, [arnolds])).toBeNull();
  });

  // Resolve-or-shrug, like canBlock and every other cross-row pointer here: a
  // reader that depends on a cascade having run breaks on a half-merged sync.
  it('shrugs off an id that no longer resolves', () => {
    expect(preferredProductOf({ preferredProductId: 'gone' }, [arnolds])).toBeNull();
  });
});

describe('parseUnavailableProductIds', () => {
  it('reads the map back', () => {
    expect(parseUnavailableProductIds('{"p1":"2026-03-04T00:00:00.000Z"}'))
      .toEqual({ p1: '2026-03-04T00:00:00.000Z' });
  });

  // Unknown always counts, so a blob this build can't read has to degrade to
  // "no claims recorded" rather than take the grocery list down.
  it('degrades to no claims on anything it cannot read', () => {
    expect(parseUnavailableProductIds(null)).toEqual({});
    expect(parseUnavailableProductIds('')).toEqual({});
    expect(parseUnavailableProductIds('not json')).toEqual({});
    expect(parseUnavailableProductIds('[1,2]')).toEqual({});
    expect(parseUnavailableProductIds('"p1"')).toEqual({});
  });

  // A claim with no date isn't the claim this field means — see the type's
  // note on why these are dates and not flags.
  it('drops an entry whose value is not a stamp', () => {
    expect(parseUnavailableProductIds('{"p1":true,"p2":"2026-03-04T00:00:00.000Z"}'))
      .toEqual({ p2: '2026-03-04T00:00:00.000Z' });
  });
});

describe('lacksPreferredProduct', () => {
  const claimed = { unavailableProductIds: { p1: '2026-03-04T00:00:00.000Z' } };

  it('is true only when the claim names the box the item is asking for', () => {
    expect(lacksPreferredProduct({ preferredProductId: 'p1', productStrict: true }, claimed))
      .toBe(true);
  });

  // The whole reason the claims are keyed by product: switching what you want
  // leaves the old evidence behind rather than inheriting it.
  it('ignores a claim about a product the item no longer prefers', () => {
    expect(lacksPreferredProduct({ preferredProductId: 'p2', productStrict: true }, claimed))
      .toBe(false);
  });

  it('is false while the item is not strict — a preference is not a rule', () => {
    expect(lacksPreferredProduct({ preferredProductId: 'p1', productStrict: false }, claimed))
      .toBe(false);
  });

  it('is false with no preference at all — there is nothing to be missing', () => {
    expect(lacksPreferredProduct({ preferredProductId: null, productStrict: true }, claimed))
      .toBe(false);
  });

  it('is false when no claim has been made — unknown always counts', () => {
    expect(lacksPreferredProduct(
      { preferredProductId: 'p1', productStrict: true }, { unavailableProductIds: {} }
    )).toBe(false);
  });
});

describe('describeProductPurchases', () => {
  it('counts, and singularises one', () => {
    expect(describeProductPurchases(product({ id: 'a', purchaseCount: 3 }))).toBe('bought 3 times');
    expect(describeProductPurchases(product({ id: 'a', purchaseCount: 1 }))).toBe('bought 1 time');
  });

  it('says nothing about a box that has never come home', () => {
    expect(describeProductPurchases(product({ id: 'a' }))).toBeNull();
  });
});
