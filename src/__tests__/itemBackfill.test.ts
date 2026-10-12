import {
  isItemFieldMissing, isItemBackfillDismissed, itemBackfillCandidates, itemBackfillFieldCounts,
  dismissItemBackfillField, ITEM_BACKFILL_FIELDS,
} from '../utils/itemBackfill';
import { groceryNameKey } from '../utils/groceryParse';
import { OTHER_AISLE } from '../utils/groceryAisles';
import type { FoodNutrition, GroceryItem, ItemSubLink } from '../types';

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
    purchaseIntervalDays: null,
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
    lastPriceMinor: null,
    lastPricedAt: null,
    lastPriceQuantity: null,
    priceHistory: [],
    nutrition: null,
    backfillDismissedFields: [],
    ...overrides,
  };
}

function sub(itemId: string, subItemId: string, overrides: Partial<ItemSubLink> = {}): ItemSubLink {
  return {
    itemId,
    subItemId,
    note: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ratioFrom: null,
    ratioTo: null,
    standing: false,
    ...overrides,
  };
}

const butter = makeItem('Butter');
const margarine = makeItem('Margarine');

/** The smallest panel that reads as a real record. */
function panel(): FoodNutrition {
  return {
    basis: 'per100g',
    servingGrams: null,
    servingText: null,
    amounts: { calorieKcal: 717 },
    source: 'manual',
    sourceId: null,
    portions: [],
    recordedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('isItemFieldMissing', () => {
  it('treats a null varietyOfKey as missing', () => {
    expect(isItemFieldMissing(butter, 'variety')).toBe(true);
    expect(isItemFieldMissing({ ...butter, varietyOfKey: 'dairy' }, 'variety')).toBe(false);
  });

  it('treats no recorded substitute as missing', () => {
    expect(isItemFieldMissing(butter, 'substitutes')).toBe(true);
    expect(isItemFieldMissing(butter, 'substitutes', [sub(butter.id, margarine.id)], [butter, margarine])).toBe(false);
  });

  it('drops a substitute link whose other half is gone, same as substitutesFor', () => {
    expect(isItemFieldMissing(butter, 'substitutes', [sub(butter.id, margarine.id)], [butter])).toBe(true);
  });

  it('treats a null nutrition panel as missing', () => {
    expect(isItemFieldMissing(butter, 'nutrition')).toBe(true);
    expect(isItemFieldMissing({ ...butter, nutrition: panel() }, 'nutrition')).toBe(false);
  });

  it('excludes a non-food aisle from the nutrition queue, but not from other fields', () => {
    const medicine = makeItem('Aleve', { id: 'medicine', aisle: 'Medicine & Supplements' });
    expect(isItemFieldMissing(medicine, 'nutrition', [], [], ['Medicine & Supplements'])).toBe(false);
    // A plain, un-flagged aisle is untouched by the same list.
    expect(isItemFieldMissing(medicine, 'nutrition', [], [], ['Household'])).toBe(true);
    // The flag is scoped to nutrition — a non-food item still wants a variety
    // or a substitute like any other row.
    expect(isItemFieldMissing(medicine, 'variety', [], [], ['Medicine & Supplements'])).toBe(true);
  });

  it('asks about a name a scan supplied, and only that one', () => {
    expect(isItemFieldMissing(butter, 'scannedName')).toBe(false);
    expect(isItemFieldMissing({ ...butter, nameFromScan: true }, 'scannedName')).toBe(true);
  });
});

describe('itemBackfillCandidates', () => {
  it('includes every item missing the field, sorted by name', () => {
    const zebra = makeItem('Zebra cake', { id: 'a' });
    const apple = makeItem('Apple sauce', { id: 'b' });
    expect(itemBackfillCandidates([zebra, apple], 'variety').map(i => i.id)).toEqual(['b', 'a']);
  });

  it('excludes an item that already has the field set', () => {
    const items = [
      makeItem('Onion', { id: 'a' }),
      makeItem('White onion', { id: 'b', varietyOfKey: 'onion' }),
    ];
    expect(itemBackfillCandidates(items, 'variety').map(i => i.id)).toEqual(['a']);
  });

  it('excludes an item dismissed for that field, but not for another', () => {
    const items = [
      makeItem('A', { id: 'a', backfillDismissedFields: ['variety'] }),
      makeItem('B', { id: 'b', backfillDismissedFields: ['substitutes'] }),
    ];
    expect(itemBackfillCandidates(items, 'variety').map(i => i.id)).toEqual(['b']);
  });

  it('reads substitute links to decide the substitutes field', () => {
    const items = [butter, margarine];
    expect(itemBackfillCandidates(items, 'substitutes').map(i => i.id)).toEqual([butter.id, margarine.id]);
    expect(itemBackfillCandidates(items, 'substitutes', [sub(butter.id, margarine.id)]).map(i => i.id))
      .toEqual([margarine.id]);
  });

  it('drops a non-food aisle from the nutrition queue', () => {
    const items = [
      makeItem('Aleve', { id: 'medicine', aisle: 'Medicine & Supplements' }),
      butter,
    ];
    expect(itemBackfillCandidates(items, 'nutrition').map(i => i.id)).toEqual(['medicine', butter.id]);
    expect(itemBackfillCandidates(items, 'nutrition', [], ['Medicine & Supplements']).map(i => i.id))
      .toEqual([butter.id]);
  });
});

describe('itemBackfillCandidates fromScratch', () => {
  it('includes items that already have the value or were dismissed', () => {
    const items = [
      makeItem('Onion', { id: 'a' }),
      makeItem('White onion', { id: 'b', varietyOfKey: 'onion' }),
      makeItem('Red onion', { id: 'c', backfillDismissedFields: ['variety'] }),
    ];
    expect(itemBackfillCandidates(items, 'variety').map(i => i.id)).toEqual(['a']);
    expect(itemBackfillCandidates(items, 'variety', [], [], { fromScratch: true }).map(i => i.id))
      .toEqual(['a', 'c', 'b']);
  });

  it('still leaves non-food items out of nutrition', () => {
    const items = [
      makeItem('Aleve', { id: 'medicine', aisle: 'Medicine & Supplements' }),
      makeItem('Milk', { id: 'milk' }),
    ];
    expect(itemBackfillCandidates(items, 'nutrition', [], ['Medicine & Supplements'], { fromScratch: true }).map(i => i.id))
      .toEqual(['milk']);
  });
});

describe('isItemBackfillDismissed / dismissItemBackfillField', () => {
  it('is false until the field has been dismissed', () => {
    expect(isItemBackfillDismissed(butter, 'variety')).toBe(false);
  });

  it('dismissing appends the field id', () => {
    const patch = dismissItemBackfillField(butter, 'variety');
    expect(patch.backfillDismissedFields).toEqual(['variety']);
    expect(isItemBackfillDismissed({ ...butter, ...patch }, 'variety')).toBe(true);
  });

  it('preserves other dismissed fields already on the item', () => {
    const item = { ...butter, backfillDismissedFields: ['substitutes'] };
    expect(dismissItemBackfillField(item, 'variety').backfillDismissedFields).toEqual(['substitutes', 'variety']);
  });

  it('dismissing twice does not duplicate the entry', () => {
    const item = { ...butter, backfillDismissedFields: ['variety'] };
    expect(dismissItemBackfillField(item, 'variety').backfillDismissedFields).toEqual(['variety']);
  });
});

describe('nutritionDetail', () => {
  const withAmounts = (amounts: FoodNutrition['amounts'], source: FoodNutrition['source'] = 'openFoodFacts') =>
    ({ ...butter, nutrition: { ...panel(), amounts, source } });

  it('is missing on a saved panel that has none of the later label lines', () => {
    expect(isItemFieldMissing(withAmounts({ calorieKcal: 717, fatG: 81 }), 'nutritionDetail')).toBe(true);
  });

  it('is answered once any one of the three is recorded, including a real zero', () => {
    expect(isItemFieldMissing(withAmounts({ calorieKcal: 717, transFatG: 0 }), 'nutritionDetail')).toBe(false);
    expect(isItemFieldMissing(withAmounts({ calorieKcal: 717, cholesterolMg: 215 }), 'nutritionDetail')).toBe(false);
    expect(isItemFieldMissing(withAmounts({ calorieKcal: 717, addedSugarG: 0 }), 'nutritionDetail')).toBe(false);
  });

  it('leaves an item with no panel to the nutrition field', () => {
    expect(isItemFieldMissing(butter, 'nutritionDetail')).toBe(false);
    expect(isItemFieldMissing(butter, 'nutrition')).toBe(true);
  });

  it('leaves an estimate alone, since it was never read off a label', () => {
    expect(isItemFieldMissing(withAmounts({ calorieKcal: 717 }, 'estimated'), 'nutritionDetail')).toBe(false);
  });

  it('skips a non-food aisle', () => {
    const medicine = { ...withAmounts({ calorieKcal: 5 }), aisle: 'Medicine & Supplements' };
    expect(isItemFieldMissing(medicine, 'nutritionDetail', [], [], ['Medicine & Supplements'])).toBe(false);
  });

  it('offers a redo only for a panel that could take the lines', () => {
    const items = [
      withAmounts({ calorieKcal: 717, transFatG: 3 }),
      { ...margarine, nutrition: { ...panel(), source: 'estimated' as const } },
      makeItem('Salt', { id: 'salt' }),
    ];
    expect(itemBackfillCandidates(items, 'nutritionDetail', [], [], { fromScratch: true }).map(i => i.name))
      .toEqual(['Butter']);
  });
});

describe('itemBackfillFieldCounts', () => {
  it('counts each field independently', () => {
    const items = [
      makeItem('A', { id: 'a', varietyOfKey: 'onion' }),
      makeItem('B', { id: 'b' }),
    ];
    expect(itemBackfillFieldCounts(items)).toEqual({
      variety: 1, substitutes: 2, nutrition: 2, nutritionDetail: 0, scannedName: 0,
    });
  });

  // `scannedName` is the one field that queues on a value being *present*, so
  // an item with every other gap still has to be told it was named by a scan
  // for this to hold — which is the assertion, not a workaround for it.
  // `nutrition` and `nutritionDetail` cannot both queue one item (the first is
  // no panel, the second is a panel), so the pair is covered by two rows.
  it('covers every declared backfillable field', () => {
    const counts = itemBackfillFieldCounts([
      { ...butter, nameFromScan: true },
      { ...margarine, nutrition: panel() },
    ]);
    for (const field of ITEM_BACKFILL_FIELDS) {
      expect(counts[field.id]).toBeGreaterThan(0);
    }
  });

  it('does not count an item dismissed for that field', () => {
    const item = { ...butter, backfillDismissedFields: ['variety'] };
    expect(itemBackfillFieldCounts([item])).toEqual({
      variety: 0, substitutes: 1, nutrition: 1, nutritionDetail: 0, scannedName: 0,
    });
  });
});
