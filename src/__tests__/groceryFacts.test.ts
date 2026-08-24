import { hasUserFacts, linkedItemIds, type ItemRelations } from '../utils/groceryFacts';
import { groceryNameKey } from '../utils/groceryParse';
import { OTHER_AISLE } from '../utils/groceryAisles';
import type { GroceryItem, ItemProduct, ItemShopLink, ItemSubLink, StoreAlias } from '../types';

function makeItem(name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    id: `item-${groceryNameKey(name).replace(/\s/g, '-')}`,
    name,
    nameKey: groceryNameKey(name),
    preferredProductId: null,
    productStrict: false,
    aisle: OTHER_AISLE,
    quantity: null,
    quantityFromRecipe: false,
    note: '',
    onList: false,
    checked: false,
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
    frozenAt: null,
    openedAt: null,
    runningLowAt: null,
    shelfLifeDays: null,
    useUpTask: null,
    pantryCheckDeclinedAt: null,
    usedUpCount: 0,
    spoiledCount: 0,
    lastSpoiledAt: null,
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    priceHistory: [],
    ...overrides,
  };
}

const BARE = makeItem('Nduja');
const NO_LINKS: ReadonlySet<string> = new Set<string>();

/** The set `hasUserFacts` actually takes, built the way production builds it. */
function linked(over: Partial<ItemRelations> = {}): ReadonlySet<string> {
  return linkedItemIds({ products: [], subs: [], shops: [], aliases: [], ...over });
}

describe('hasUserFacts', () => {
  // The population clearList is allowed to sweep: typed once, never shopped
  // for, never spoken about.
  it('is false for a row that is only a name', () => {
    expect(hasUserFacts(BARE, NO_LINKS)).toBe(false);
  });

  // Everything the row picks up by merely existing or by being put on a list
  // stays sweepable — otherwise the sweep never fires and an abandoned trip
  // leaves the whole list behind.
  it.each([
    ['an auto-filed aisle', { aisle: 'Produce' }],
    ['a recipe stamp', { sourceRecipeId: 'r1', sourceRecipeTitle: 'Ragu' }],
    ['a recipe-owned quantity', { quantity: '2 lb', quantityFromRecipe: true }],
    ['a list slot', { onList: true, sortOrder: 9, lastAddedAt: '2026-08-01T00:00:00.000Z' }],
    ["this trolley's either/or", { choiceGroup: 'group-1' }],
  ])('stays sweepable with %s', (_label, patch) => {
    expect(hasUserFacts(makeItem('Nduja', patch), NO_LINKS)).toBe(false);
  });

  it.each([
    ['a purchase', { purchaseCount: 1, lastPurchasedAt: '2026-08-01T00:00:00.000Z' }],
    ['a recorded price', { lastPriceMinor: 499, lastPricedAt: '2026-08-01T00:00:00.000Z' }],
    ['a staple marking', { isStaple: true }],
    ['an on-hand claim', { onHandUntil: '2026-09-01T00:00:00.000Z' }],
    ['a freezer claim', { frozenAt: '2026-08-01T00:00:00.000Z' }],
    ['an opened jar', { openedAt: '2026-08-01T00:00:00.000Z' }],
    ['a running-low marking', { runningLowAt: '2026-08-01T00:00:00.000Z' }],
    ['a use-by date', { expiresAt: '2026-09-01T00:00:00.000Z' }],
    ['a shelf life', { shelfLifeDays: 14 }],
    ['disposal history', { usedUpCount: 2 }],
    ['a declined pantry check', { pantryCheckDeclinedAt: '2026-08-01T00:00:00.000Z' }],
    ['a use-up opt-out', { useUpTask: false }],
    ['a preferred box', { preferredProductId: 'p1' }],
    ['a brand-strict rule', { productStrict: true }],
    ['a typed note', { note: 'the green one' }],
    ['a hand-set quantity', { quantity: '2 bags', quantityFromRecipe: false }],
  ])('is true for %s', (_label, patch) => {
    expect(hasUserFacts(makeItem('Nduja', patch), NO_LINKS)).toBe(true);
  });

  it('is true for a row with a box named under it', () => {
    const product = { id: 'p1', itemId: BARE.id } as ItemProduct;
    expect(hasUserFacts(BARE, linked({ products: [product] }))).toBe(true);
  });

  it('is true for a row with a store link', () => {
    const link = { itemId: BARE.id, shopId: 's1' } as ItemShopLink;
    expect(hasUserFacts(BARE, linked({ shops: [link] }))).toBe(true);
  });

  it('is true for a row with a receipt alias', () => {
    const alias = { id: 'a1', itemId: BARE.id, shopId: 's1' } as StoreAlias;
    expect(hasUserFacts(BARE, linked({ aliases: [alias] }))).toBe(true);
  });

  // Both ends. "Margarine instead of butter" is a fact about margarine's row
  // as much as butter's, and deleting either end drops the link.
  it('is true for either end of a substitute link', () => {
    const other = makeItem('Butter');
    const link = { itemId: other.id, subItemId: BARE.id } as ItemSubLink;
    expect(hasUserFacts(BARE, linked({ subs: [link] }))).toBe(true);
    expect(hasUserFacts(other, linked({ subs: [link] }))).toBe(true);
  });

  it('ignores links belonging to other items', () => {
    const link = { itemId: 'someone-else', subItemId: 'also-not-this-one' } as ItemSubLink;
    const product = { id: 'p1', itemId: 'someone-else' } as ItemProduct;
    expect(hasUserFacts(BARE, linked({ subs: [link], products: [product] }))).toBe(false);
  });
});
