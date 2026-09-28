import { describeForgetLoss, hasUserFacts, factSignature, linkCounts, type ItemRelations } from '../utils/groceryFacts';
import { aliasKeyFor, gtinAliasText } from '../utils/storeAliases';
import { groceryNameKey } from '../utils/groceryParse';
import { OTHER_AISLE } from '../utils/groceryAisles';
import type { GroceryItem, ItemProduct, ItemShopLink, ItemSubLink, StoreAlias } from '../types';

function makeItem(name: string, overrides: Partial<GroceryItem> = {}): GroceryItem {
  return {
    nameFromScan: false,
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

const BARE = makeItem('Nduja');
const NO_LINKS: ReadonlyMap<string, number> = new Map<string, number>();

/** The counts `hasUserFacts` actually takes, built the way production builds them. */
function linked(over: Partial<ItemRelations> = {}): ReadonlyMap<string, number> {
  return linkCounts({ products: [], subs: [], shops: [], aliases: [], ...over });
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
    ['a variety declaration', { varietyOfKey: 'onion' }],
    ['a typed note', { note: 'the green one' }],
    ['a hand-set quantity', { quantity: '2 bags', quantityFromRecipe: false }],
    // A row made only to carry a food log entry's figures is that record, and
    // the prune sweep used to offer it as a typo.
    ['a nutrition panel', { nutrition: { source: 'label', amounts: { calorieKcal: 120 }, servingText: '1 bar', servingGrams: 40, portions: [] } as never }],
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

describe('factSignature', () => {
  it('is stable for an unchanged row', () => {
    expect(factSignature(BARE, NO_LINKS)).toBe(factSignature(BARE, NO_LINKS));
  });

  // The distinction hasUserFacts cannot draw on its own, and the reason this
  // exists: both rows carry a fact, but only one of them *changed*.
  it('separates a row that already had a fact from one that has gained another', () => {
    const withNote = makeItem('Nduja', { note: 'the spicy one' });
    const before = factSignature(withNote, NO_LINKS);
    expect(factSignature({ ...withNote }, NO_LINKS)).toBe(before);
    expect(factSignature({ ...withNote, isStaple: true }, NO_LINKS)).not.toBe(before);
  });

  it('changes when a fact is edited rather than added', () => {
    const a = makeItem('Nduja', { quantity: '1 jar' });
    const b = makeItem('Nduja', { quantity: '2 jars' });
    expect(factSignature(a, NO_LINKS)).not.toBe(factSignature(b, NO_LINKS));
  });

  // Counts, not membership: a row minted with a Brand chip owns a product from
  // birth, so a bit would miss the store link named on it afterwards.
  it('changes when a second link lands on a row that already had one', () => {
    const product = { id: 'p1', itemId: BARE.id } as ItemProduct;
    const shop = { itemId: BARE.id, shopId: 's1' } as ItemShopLink;
    const one = factSignature(BARE, linked({ products: [product] }));
    const two = factSignature(BARE, linked({ products: [product], shops: [shop] }));
    expect(one).not.toBe(two);
  });

  it('ignores everything hasUserFacts ignores', () => {
    const bare = factSignature(BARE, NO_LINKS);
    expect(factSignature(makeItem('Nduja', { aisle: 'Produce' }), NO_LINKS)).toBe(bare);
    expect(factSignature(makeItem('Nduja', { choiceGroup: 'g1' }), NO_LINKS)).toBe(bare);
    expect(factSignature(makeItem('Nduja', { sourceRecipeId: 'r1' }), NO_LINKS)).toBe(bare);
    expect(
      factSignature(makeItem('Nduja', { quantity: '2 lb', quantityFromRecipe: true }), NO_LINKS)
    ).toBe(bare);
  });
});

describe('describeForgetLoss', () => {
  const MILK = makeItem('Milk');
  const OAT = makeItem('Oat milk');
  const ITEMS = [MILK, OAT];
  const none = { products: [], subs: [], aliases: [] };

  it('says nothing when nothing hangs off the row', () => {
    expect(describeForgetLoss([OAT.id], none, ITEMS, [])).toBe('');
  });

  it('names a standing swap from either end, since the cascade takes both', () => {
    const swap = { itemId: MILK.id, subItemId: OAT.id, standing: true } as ItemSubLink;
    const text = 'It also removes the standing swap that uses Oat milk for Milk.';
    expect(describeForgetLoss([OAT.id], { ...none, subs: [swap] }, ITEMS, [])).toBe(text);
    expect(describeForgetLoss([MILK.id], { ...none, subs: [swap] }, ITEMS, [])).toBe(text);
  });

  it('counts substitutes, brands, barcodes, receipt lines and names the supply', () => {
    const sub = { itemId: MILK.id, subItemId: OAT.id, standing: false } as ItemSubLink;
    const products = [
      { id: 'p1', itemId: OAT.id, gtin: '0123' } as ItemProduct,
      { id: 'p2', itemId: OAT.id, gtin: null } as ItemProduct,
    ];
    const aliases = [
      // The same barcode remembered as an alias counts once.
      { id: 'a1', itemId: OAT.id, shopId: '', rawKey: aliasKeyFor(gtinAliasText('0123')) } as StoreAlias,
      { id: 'a2', itemId: OAT.id, shopId: 's1', rawKey: aliasKeyFor('OATLY BARISTA') } as StoreAlias,
    ];
    expect(describeForgetLoss([OAT.id], { products, subs: [sub], aliases }, ITEMS, ['Make coffee'])).toBe(
      'It also removes a substitute, 2 saved brands, a remembered barcode, a remembered receipt line'
        + ' and the supply link on “Make coffee”.'
    );
  });

  it('counts rather than lists past two supplies', () => {
    expect(describeForgetLoss([OAT.id], none, ITEMS, ['A', 'B', 'C'])).toBe('It also removes 3 supply links.');
  });
});
