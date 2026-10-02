import type { GroceryItem, ItemProduct } from '../types';
import { groceryNameKey } from '../utils/groceryParse';
import {
  coveringVariety,
  describeFamilyOnHand,
  familyOnHand,
  genericNameSuggestions,
  varietyIndex,
  varietyOfferFor,
} from '../utils/itemVarieties';

const NOW = new Date('2026-08-25T12:00:00.000Z');

function future(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString();
}

let seq = 0;
function makeItem(overrides: Partial<GroceryItem> & { name: string }): GroceryItem {
  const name = overrides.name;
  return {
    nameFromScan: false,
    id: `id-${++seq}`,
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
    createdAt: '2025-01-01T00:00:00.000Z',
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
    varietyOfKey: null, nutrition: null, backfillDismissedFields: [],
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    priceHistory: [],
    ...overrides,
  };
}

function byKeyOf(items: readonly GroceryItem[]): Map<string, GroceryItem> {
  return new Map(items.map(i => [i.nameKey, i]));
}

// ─── varietyIndex ────────────────────────────────────────────────────────────

describe('varietyIndex', () => {
  it('groups declared varieties under their generic key, in catalog order', () => {
    const white = makeItem({ name: 'White onion', varietyOfKey: 'onion' });
    const red = makeItem({ name: 'Red onion', varietyOfKey: 'onion' });
    const milk = makeItem({ name: 'Milk' });

    const index = varietyIndex([white, milk, red]);
    expect(index.get('onion')).toEqual([white, red]);
    // The generic and its other spelling (#2941), and nothing for Milk.
    expect([...index.keys()]).toEqual(['onion', 'onions']);
  });

  it('skips a declaration pointing at the item’s own key', () => {
    const weird = makeItem({ name: 'Onion', varietyOfKey: 'onion' });
    expect(varietyIndex([weird]).size).toBe(0);
  });

  describe('the other spelling of a declared generic (#2941)', () => {
    it('answers a singular line for a plural declaration, and the reverse', () => {
      // "White onions" can only suggest "onions" from its own name, and a
      // recipe saying "1 onion" is the same ask.
      const white = makeItem({ name: 'White onions', varietyOfKey: 'onions' });
      expect(varietyIndex([white]).get('onion')).toEqual([white]);
      expect(varietyIndex([white]).get('onions')).toEqual([white]);

      const red = makeItem({ name: 'Red onion', varietyOfKey: 'onion' });
      expect(varietyIndex([red]).get('onions')).toEqual([red]);
    });

    it('gives both spellings the whole family when both are declared, in catalog order', () => {
      const white = makeItem({ name: 'White onions', varietyOfKey: 'onions' });
      const milk = makeItem({ name: 'Milk' });
      const red = makeItem({ name: 'Red onion', varietyOfKey: 'onion' });
      const index = varietyIndex([white, milk, red]);
      expect(index.get('onion')).toEqual([white, red]);
      expect(index.get('onions')).toEqual([white, red]);
    });

    it('reaches the generic’s own row spelled the other way', () => {
      // The catalog already resolves "onions" to the Onion row, so a
      // declaration of "onions" is about that row.
      const onion = makeItem({ name: 'Onion' });
      const white = makeItem({ name: 'White onions', varietyOfKey: 'onions' });
      expect(varietyIndex([onion, white]).get('onion')).toEqual([white]);
    });

    it('leaves two rows one plural apart as two things', () => {
      // "Pepper" and "Peppers" both in the catalog were kept apart on purpose,
      // so a declaration about one says nothing about the other.
      const pepper = makeItem({ name: 'Pepper' });
      const peppers = makeItem({ name: 'Peppers' });
      const bell = makeItem({ name: 'Bell peppers', varietyOfKey: 'peppers' });
      const index = varietyIndex([pepper, peppers, bell]);
      expect(index.get('peppers')).toEqual([bell]);
      expect(index.get('pepper')).toBeUndefined();
    });

    it('refuses a spelling that is a plural of two keys at once', () => {
      // "leaves" could be "leaf" or "leave", and picking one is a coin flip.
      const bay = makeItem({ name: 'Bay leaf', varietyOfKey: 'leaf' });
      const leave = makeItem({ name: 'Leave' });
      expect(varietyIndex([bay, leave]).get('leaves')).toBeUndefined();
      expect(varietyIndex([bay]).get('leaves')).toEqual([bay]);
    });
  });
});

// ─── coveringVariety ─────────────────────────────────────────────────────────

describe('coveringVariety', () => {
  it('returns null with no candidates, and with candidates nothing answers for', () => {
    expect(coveringVariety(undefined, NOW)).toBeNull();
    expect(coveringVariety([], NOW)).toBeNull();
    // Declared but the app has no reason to believe you have it.
    const white = makeItem({ name: 'White onion', varietyOfKey: 'onion' });
    expect(coveringVariety([white], NOW)).toBeNull();
  });

  it('answers with a variety the pantry vouches for', () => {
    const white = makeItem({
      name: 'White onion',
      varietyOfKey: 'onion',
      onHandUntil: future(7),
    });
    expect(coveringVariety([white], NOW)).toBe(white);
  });

  it('ranks an unchecked list row over a staple over the pantry guess', () => {
    const onHand = makeItem({ name: 'White onion', varietyOfKey: 'onion', onHandUntil: future(7) });
    const staple = makeItem({ name: 'Yellow onion', varietyOfKey: 'onion', isStaple: true });
    const listed = makeItem({ name: 'Red onion', varietyOfKey: 'onion', onList: true });

    expect(coveringVariety([onHand, staple, listed], NOW)).toBe(listed);
    expect(coveringVariety([onHand, staple], NOW)).toBe(staple);
    expect(coveringVariety([onHand], NOW)).toBe(onHand);
  });

  // A box frozen or marked "Got it" keeps its item in the Pantry, so it has to
  // answer for the family here too, the same way probablyHaveReason reads it.
  it('answers with a variety whose only claim is one of its boxes, when handed them', () => {
    const white = makeItem({ name: 'White onion', varietyOfKey: 'onion' });
    const box: ItemProduct = {
      id: 'p-white', itemId: white.id, brand: 'Farm', variant: null, productKey: 'farm|',
      rating: null, nutrition: null, note: '', purchaseCount: 0, lastPurchasedAt: null,
      gtin: null, onHandUntil: future(7), expiresAt: null, frozenAt: null, openedAt: null,
      isPortion: false, createdAt: '2026-01-01T00:00:00.000Z',
    };

    expect(coveringVariety([white], NOW, null, [box])).toBe(white);
    expect(coveringVariety([white], NOW)).toBeNull();
  });

  it('still answers with a checked (in-cart) list row', () => {
    const inCart = makeItem({ name: 'Red onion', varietyOfKey: 'onion', onList: true, checked: true });
    expect(coveringVariety([inCart], NOW)).toBe(inCart);
  });

  it('breaks a tie by catalog order', () => {
    const first = makeItem({ name: 'White onion', varietyOfKey: 'onion', onHandUntil: future(7) });
    const second = makeItem({ name: 'Red onion', varietyOfKey: 'onion', onHandUntil: future(7) });
    expect(coveringVariety([first, second], NOW)).toBe(first);
  });
});

// ─── familyOnHand ────────────────────────────────────────────────────────────

describe('familyOnHand', () => {
  it('names the on-hand parent and siblings of a variety, and only those', () => {
    const onion = makeItem({ name: 'Onion', onHandUntil: future(7) });
    const white = makeItem({ name: 'White onion', varietyOfKey: 'onion', onHandUntil: future(7) });
    const yellow = makeItem({ name: 'Yellow onion', varietyOfKey: 'onion' });
    const red = makeItem({ name: 'Red onion', varietyOfKey: 'onion' });
    const items = [onion, white, yellow, red];

    const family = familyOnHand(red, byKeyOf(items), varietyIndex(items), NOW);
    // The parent leads, then siblings; yellow drops out — nothing says you have it.
    expect(family).toEqual([onion, white]);
  });

  it('is empty for an item that is not a variety, and never names the item itself', () => {
    const onion = makeItem({ name: 'Onion', onHandUntil: future(7) });
    const white = makeItem({ name: 'White onion', varietyOfKey: 'onion', onHandUntil: future(7) });
    const items = [onion, white];

    expect(familyOnHand(onion, byKeyOf(items), varietyIndex(items), NOW)).toEqual([]);
    expect(familyOnHand(white, byKeyOf(items), varietyIndex(items), NOW)).toEqual([onion]);
  });

  it('finds the parent row and siblings spelled the other way (#2941)', () => {
    const onion = makeItem({ name: 'Onion', onHandUntil: future(7) });
    const white = makeItem({ name: 'White onions', varietyOfKey: 'onions', onHandUntil: future(7) });
    const red = makeItem({ name: 'Red onion', varietyOfKey: 'onion' });
    const items = [onion, white, red];
    expect(familyOnHand(red, byKeyOf(items), varietyIndex(items), NOW)).toEqual([onion, white]);
  });
});

// ─── describeFamilyOnHand ────────────────────────────────────────────────────

describe('describeFamilyOnHand', () => {
  it('phrases exactly as the substitute caption does', () => {
    const white = makeItem({ name: 'White onion' });
    const yellow = makeItem({ name: 'Yellow onion' });
    const red = makeItem({ name: 'Red onion' });

    expect(describeFamilyOnHand([])).toBeNull();
    expect(describeFamilyOnHand([white])).toBe('you have white onion');
    expect(describeFamilyOnHand([white, yellow])).toBe('you have white onion or yellow onion');
    expect(describeFamilyOnHand([white, yellow, red])).toBe('you have 3 kinds of it');
  });
});

// ─── varietyOfferFor ─────────────────────────────────────────────────────────

describe('varietyOfferFor', () => {
  it('offers when the catalog name ends with the line’s whole key', () => {
    const white = makeItem({ name: 'White onion' });
    expect(varietyOfferFor('onion', white)).toBe(white);
  });

  it('offers when the catalog name ends with the line’s key spelled the other way', () => {
    const whites = makeItem({ name: 'White onions' });
    expect(varietyOfferFor('onion', whites)).toBe(whites);
    const white = makeItem({ name: 'White onion' });
    expect(varietyOfferFor('onions', white)).toBe(white);
  });

  it('refuses a boundary that falls mid-word', () => {
    // The mirror of longestPrefixItem's rule: "eggplant" is not a kind of plant
    // said this way, and "scallion" is not a kind of onion.
    expect(varietyOfferFor('plant', makeItem({ name: 'Eggplant' }))).toBeNull();
    expect(varietyOfferFor('onion', makeItem({ name: 'Scallion' }))).toBeNull();
  });

  it('refuses the reverse direction and an equal name', () => {
    // The line is the more specific of the two, so there is no variety of it
    // to declare — that's the rename's case, not this one.
    expect(varietyOfferFor('white onion', makeItem({ name: 'Onion' }))).toBeNull();
    expect(varietyOfferFor('onion', makeItem({ name: 'Onion' }))).toBeNull();
  });

  it('leaves an item that already declares something alone', () => {
    const white = makeItem({ name: 'White onion', varietyOfKey: 'allium' });
    expect(varietyOfferFor('onion', white)).toBeNull();
  });

  it('refuses a blank key and a missing item', () => {
    expect(varietyOfferFor('', makeItem({ name: 'White onion' }))).toBeNull();
    expect(varietyOfferFor('onion', null)).toBeNull();
  });
});

// ─── genericNameSuggestions ──────────────────────────────────────────────────

describe('genericNameSuggestions', () => {
  it('offers the item’s trailing words, then generics already in use, deduped', () => {
    const sharp = makeItem({ name: 'Extra sharp cheddar' });
    const white = makeItem({ name: 'White onion', varietyOfKey: 'onion' });

    const keys = genericNameSuggestions(sharp, [sharp, white]).map(s => s.key);
    expect(keys).toEqual(['sharp cheddar', 'cheddar', 'onion']);
  });

  it('labels a generic with its catalog row’s own name when one exists', () => {
    const onion = makeItem({ name: 'Onion' });
    const white = makeItem({ name: 'White onion' });

    const suggestions = genericNameSuggestions(white, [onion, white]);
    expect(suggestions).toEqual([{ key: 'onion', label: 'Onion' }]);
  });

  it('keeps a free-typed current value visible, and never offers the item’s own key', () => {
    const white = makeItem({ name: 'White onion', varietyOfKey: 'allium' });
    const suggestions = genericNameSuggestions(white, [white]);
    expect(suggestions.map(s => s.key)).toEqual(['onion', 'allium']);
    // A one-word item has no trailing words and suggests nothing of its own.
    const salt = makeItem({ name: 'Salt' });
    expect(genericNameSuggestions(salt, [salt])).toEqual([]);
  });
});
