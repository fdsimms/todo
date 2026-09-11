import {
  alreadyScanned,
  matchScans,
  nameFromScanFor,
  scanBoxFor,
  scanLinkTarget,
  scannedItemFor,
  shopperNameFor,
  shorterNameSuggestions,
  sourceLabelFor,
  unknownScannedItem,
  variantFor,
  type ScannedItem,
} from '../utils/scanResolve';
import { groceryNameKey } from '../utils/groceryParse';
import type { GroceryItem } from '../types';

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
    onList: true,
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
    varietyOfKey: null, nutrition: null, backfillDismissedFields: [],
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    priceHistory: [],
    ...overrides,
  };
}

function scan(overrides: Partial<ScannedItem> & { name: string }): ScannedItem {
  return { gtin: null, label: '', brand: null, quantity: '', aisle: null, ...overrides };
}

describe('nameFromScanFor', () => {
  it('is true for a proposal nobody edited', () => {
    const record = scan({
      gtin: '1',
      label: 'Great Value 2% Reduced Fat Milk, 1 Gallon',
      brand: 'Great Value',
      name: '2% Reduced Fat Milk',
    });
    expect(nameFromScanFor(record)).toBe(true);
  });

  it('is false once the name has been edited away from the proposal', () => {
    const record = scan({
      gtin: '1',
      label: 'Great Value 2% Reduced Fat Milk, 1 Gallon',
      brand: 'Great Value',
      name: 'Milk',
    });
    expect(nameFromScanFor(record)).toBe(false);
  });

  it('is false with no barcode, however the row was named', () => {
    expect(nameFromScanFor(scan({ name: 'Bananas' }))).toBe(false);
  });

  it('is false for a miss the user named themselves', () => {
    expect(nameFromScanFor({ ...unknownScannedItem('1'), name: 'Halloumi' })).toBe(false);
  });

  it('is false for a row still sitting blank', () => {
    expect(nameFromScanFor(unknownScannedItem('1'))).toBe(false);
  });
});

describe('shorterNameSuggestions', () => {
  it('offers each suffix, longest first', () => {
    expect(shorterNameSuggestions('2% Reduced Fat Milk'))
      .toEqual(['Reduced Fat Milk', 'Fat Milk', 'Milk']);
  });

  it('never offers the name it was given', () => {
    expect(shorterNameSuggestions('Milk')).toEqual([]);
  });

  it('drops a one-character tail rather than offering it', () => {
    expect(shorterNameSuggestions('Vitamin D')).toEqual([]);
  });

  it('collapses runs of whitespace instead of emitting a blank', () => {
    expect(shorterNameSuggestions('Organic   Riced  Cauliflower'))
      .toEqual(['Riced Cauliflower', 'Cauliflower']);
  });
});

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
      category: null,
      nutrition: null,
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

describe('sourceLabelFor', () => {
  it('leads with the maker when the name does not say who it is', () => {
    expect(sourceLabelFor('Sun Sausage Plant-based Links Cajun', 'Beyond Meat'))
      .toBe('Beyond Meat · Sun Sausage Plant-based Links Cajun');
  });

  it('does not repeat a brand the name already starts with', () => {
    expect(sourceLabelFor('Great Value 2% Reduced Fat Milk', 'Great Value'))
      .toBe('Great Value 2% Reduced Fat Milk');
  });

  it('ignores case when deciding the name already says it', () => {
    expect(sourceLabelFor("DAVE'S KILLER BREAD 21 Grain", "Dave's Killer Bread"))
      .toBe("DAVE'S KILLER BREAD 21 Grain");
  });

  it('is the label alone when the source named no brand', () => {
    expect(sourceLabelFor('Semi-skimmed milk', null)).toBe('Semi-skimmed milk');
    expect(sourceLabelFor('Semi-skimmed milk', '   ')).toBe('Semi-skimmed milk');
  });

  it('is the brand alone rather than a dangling separator when there is no label', () => {
    expect(sourceLabelFor('', 'Beyond Meat')).toBe('Beyond Meat');
  });
});

describe('variantFor', () => {
  it('is what is left after the maker and the item are both taken out', () => {
    expect(variantFor("Dave's Killer Bread 21 Whole Grains", "Dave's Killer", 'Bread'))
      .toBe('21 Whole Grains');
  });

  it('reads the item name case-insensitively, wherever it sits', () => {
    expect(variantFor('Great Value 2% Reduced Fat Milk', 'Great Value', 'milk'))
      .toBe('2% Reduced Fat');
  });

  it('is null when the item name never appears, rather than claiming the whole name', () => {
    expect(variantFor('Sun Sausage Plant-based Links Cajun', 'Beyond Meat', 'Sausages'))
      .toBeNull();
  });

  it('is null when the product is exactly the item, with nothing left over', () => {
    expect(variantFor('Oatly Milk', 'Oatly', 'Milk')).toBeNull();
  });

  it('does not match the item name inside a longer word', () => {
    expect(variantFor('Buttermilk Pancake Mix', null, 'Milk')).toBeNull();
  });

  it('survives an item name carrying regex punctuation', () => {
    expect(variantFor("Ben & Jerry's Chocolate Fudge Brownie", null, "Ben & Jerry's"))
      .toBe('Chocolate Fudge Brownie');
  });

  it('is null for an empty item name or an empty product name', () => {
    expect(variantFor('Whole Milk', null, '   ')).toBeNull();
    expect(variantFor('   ', null, 'Milk')).toBeNull();
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

  // The case linking a barcode exists for: the words have drifted so far apart
  // that no threshold could bring them back, and the code underneath hasn't
  // moved at all.
  it('hands the resolver the whole scan, so a barcode can answer where the words cannot', () => {
    const sausage = makeItem({ name: 'vegan sausage' });
    const scanned = scan({
      name: 'Plant Based Sausages Cajun',
      gtin: '00850003201115',
    });
    const [unresolved] = matchScans([scanned], [sausage]);
    // Without the link this is a single shared word and nothing more, which is
    // exactly the tier the scan sheet refuses to act on.
    expect(unresolved.confidence).toBe('weak');

    const [resolved] = matchScans([scanned], [sausage], s =>
      s.gtin === '00850003201115' ? sausage.id : null
    );
    expect(resolved.itemId).toBe(sausage.id);
    expect(resolved.confidence).toBe('remembered');
  });

  it('resolves each scan against its own barcode rather than the first one', () => {
    const milk = makeItem({ name: 'Milk' });
    const bread = makeItem({ name: 'Bread' });
    const byGtin: Record<string, string> = { '1': milk.id, '2': bread.id };
    const matches = matchScans(
      [scan({ name: 'x', gtin: '1' }), scan({ name: 'y', gtin: '2' })],
      [milk, bread],
      s => (s.gtin ? byGtin[s.gtin] ?? null : null)
    );
    expect(matches.map(m => m.itemId)).toEqual([milk.id, bread.id]);
  });

  it('falls through to the words for a scan with no barcode', () => {
    const milk = makeItem({ name: 'Milk' });
    const [match] = matchScans([scan({ name: 'Milk' })], [milk], s => (s.gtin ? milk.id : null));
    expect(match.itemId).toBe(milk.id);
    expect(match.confidence).toBe('exact');
  });
});

describe('scanLinkTarget', () => {
  it('sends a pick on the list down the list branch', () => {
    const milk = makeItem({ name: 'Milk', onList: true });
    expect(scanLinkTarget(milk)).toEqual({ onList: true, itemId: milk.id });
  });

  it('sends a pick that is merely in the catalog down the off-list branch', () => {
    // The two branches do different things — one ticks a row off the list, the
    // other rides an add draft — so a pick has to say which, off the item's own
    // onList rather than off how it was chosen.
    const flour = makeItem({ name: 'Flour', onList: false });
    expect(scanLinkTarget(flour)).toEqual({ onList: false, itemId: flour.id });
  });

  it('shrugs at a pick that no longer resolves, so the row falls back to the matcher', () => {
    expect(scanLinkTarget(null)).toBeNull();
    expect(scanLinkTarget(undefined)).toBeNull();
  });
});

describe('scanBoxFor', () => {
  const box = { itemId: 'milk', brand: 'Horizon', variant: 'whole' };

  it('hands back the box\'s own words, which is what a box is found by', () => {
    // `addProduct` and `linkScannedGtins` both resolve a box through
    // `productKeyFor(brand, variant)`, so the words land on the existing box
    // and create nothing. An id would need a second lookup path through both.
    expect(scanBoxFor(box, 'milk')).toEqual({ brand: 'Horizon', variant: 'whole' });
  });

  it('keeps a brand-only box, which is what most scanned rows have', () => {
    expect(scanBoxFor({ itemId: 'bread', brand: "Dave's Killer", variant: null }, 'bread'))
      .toEqual({ brand: "Dave's Killer", variant: null });
  });

  it('refuses a box belonging to a different item', () => {
    // The two picks are independent controls on one row: pick the Horizon
    // carton, then change your mind about which catalog row this is, and the
    // box now belongs to a food the scan is no longer about. Carrying it would
    // file Horizon's words onto Bread and mint a box there.
    expect(scanBoxFor(box, 'bread')).toBeNull();
  });

  it('shrugs at a box that no longer resolves', () => {
    expect(scanBoxFor(null, 'milk')).toBeNull();
    expect(scanBoxFor(undefined, 'milk')).toBeNull();
  });
});
