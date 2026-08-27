import type { GroceryItem } from '../types';
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
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    varietyOfKey: null,
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
    expect(index.size).toBe(1);
  });

  it('skips a declaration pointing at the item’s own key', () => {
    const weird = makeItem({ name: 'Onion', varietyOfKey: 'onion' });
    expect(varietyIndex([weird]).size).toBe(0);
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
