import {
  alreadyScanned,
  matchScans,
  scannedItemFor,
  shopperNameFor,
  unknownScannedItem,
  type ScannedItem,
} from '../utils/scanResolve';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem } from '../types';

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
    priceHistory: [],
    ...overrides,
  };
}

function scan(overrides: Partial<ScannedItem> & { name: string }): ScannedItem {
  return { gtin: null, label: '', brand: null, quantity: '', ...overrides };
}

describe('shopperNameFor', () => {
  it('drops a leading brand the source already named separately', () => {
    expect(shopperNameFor('Great Value 2% Reduced Fat Milk', 'Great Value'))
      .toBe('2% Reduced Fat Milk');
  });

  it('drops a trailing size clause', () => {
    expect(shopperNameFor('Whole Milk, 1 Gallon', null)).toBe('Whole Milk');
  });

  it('keeps a trailing clause that is not a size', () => {
    expect(shopperNameFor('Beans, black', null)).toBe('Beans, black');
  });

  it('does both, and tidies what they leave behind', () => {
    expect(shopperNameFor("Dave's Killer Bread - 21 Whole Grains, 27 oz", "Dave's Killer Bread"))
      .toBe('21 Whole Grains');
  });

  it('keeps the full name rather than emptying it', () => {
    expect(shopperNameFor('Oatly', 'Oatly')).toBe('Oatly');
  });

  it('ignores a brand that is not actually a prefix', () => {
    expect(shopperNameFor('Sharp Cheddar by Tillamook', 'Tillamook'))
      .toBe('Sharp Cheddar by Tillamook');
  });

  it('answers empty for nothing, rather than inventing a name', () => {
    expect(shopperNameFor('   ', 'Anything')).toBe('');
  });
});

describe('scannedItemFor', () => {
  it('keeps the source name as the label and the tidied one as the name', () => {
    const item = scannedItemFor({
      gtin: '00036000291452',
      name: 'Great Value 2% Reduced Fat Milk, 1 Gallon',
      brand: 'Great Value',
      quantity: '1 gal',
      source: 'openfoodfacts',
    });
    expect(item.label).toBe('Great Value 2% Reduced Fat Milk, 1 Gallon');
    expect(item.name).toBe('2% Reduced Fat Milk');
    expect(item.quantity).toBe('1 gal');
    expect(item.gtin).toBe('00036000291452');
  });
});

describe('unknownScannedItem', () => {
  it('is a nameable row, not an error', () => {
    const item = unknownScannedItem('00036000291452');
    expect(item.name).toBe('');
    expect(item.gtin).toBe('00036000291452');
  });
});

describe('alreadyScanned', () => {
  const rows = [scan({ name: 'Milk', gtin: '00036000291452' }), scan({ name: 'Bananas' })];

  it('catches the repeat frames a camera fires for one held-up box', () => {
    expect(alreadyScanned(rows, '00036000291452')).toBe(true);
  });

  it('lets a different code through', () => {
    expect(alreadyScanned(rows, '00000096385074')).toBe(false);
  });

  it('never matches a typed row, which carries no code', () => {
    expect(alreadyScanned([scan({ name: 'Bananas' })], '00036000291452')).toBe(false);
  });
});

describe('matchScans', () => {
  it('reads a scan onto the list row it names', () => {
    const milk = makeItem({ name: 'Milk' });
    const [match] = matchScans([scan({ name: '2% Reduced Fat Milk' })], [milk]);
    expect(match.itemId).toBe(milk.id);
    expect(match.confidence).toBe('likely');
  });

  it('offers an off-list catalog row rather than minting a second one', () => {
    const bread = makeItem({ name: 'Bread', onList: false });
    const [match] = matchScans([scan({ name: 'Bread' })], [bread]);
    expect(match.itemId).toBeNull();
    expect(match.offListMatchId).toBe(bread.id);
  });

  it('claims nothing for a scan the catalog has no answer for', () => {
    const [match] = matchScans([scan({ name: 'Tahini' })], [makeItem({ name: 'Milk' })]);
    expect(match.itemId).toBeNull();
    expect(match.offListMatchId).toBeNull();
  });

  it('lets only one of two scans claim a row, and says so on the other', () => {
    const milk = makeItem({ name: 'Milk' });
    const matches = matchScans([scan({ name: 'Milk' }), scan({ name: 'Milk' })], [milk]);
    const claimed = matches.filter(m => m.itemId === milk.id);
    expect(claimed).toHaveLength(1);
    expect(matches.find(m => m.itemId === null)?.duplicateOf).toBe(milk.id);
  });

  it('stays aligned index for index when a row has no name yet', () => {
    const milk = makeItem({ name: 'Milk' });
    const matches = matchScans([scan({ name: '' }), scan({ name: 'Milk' })], [milk]);
    expect(matches).toHaveLength(2);
    expect(matches[0].itemId).toBeNull();
    expect(matches[1].itemId).toBe(milk.id);
  });
});
