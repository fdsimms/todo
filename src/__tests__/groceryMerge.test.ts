/**
 * The merge rules on their own; useGroceryStore.test.ts covers mergeItems with
 * its undo, and the MCP server writes the same plan.
 */
import { laterOf, pickPriceFields, planMergeItems } from '../utils/groceryMerge';
import type { GroceryItem, GroceryListEntry, ItemProduct } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const item = (over: Partial<GroceryItem> & { id: string; name: string }): GroceryItem => ({
  nameKey: over.name.toLowerCase(), aisle: 'Produce', quantity: null, quantityFromRecipe: false, note: null, onList: false, checked: false,
  purchaseCount: 0, lastAddedAt: null, lastPurchasedAt: null, purchaseIntervalDays: null, onHandUntil: null, isStaple: false,
  choiceGroup: null, preferredProductId: null, varietyOfKey: null, lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null,
  priceHistory: [], usedUpCount: 0, spoiledCount: 0, backfillDismissedFields: [],
  ...over,
}) as GroceryItem;

describe('planMergeItems', () => {
  it('sums the history, keeps the later stamps and moves the loser onto the survivor\'s list entry', () => {
    const from = item({ id: 'a', name: 'Cilantro', purchaseCount: 2, lastPurchasedAt: '2026-05-01', onList: true });
    const into = item({ id: 'b', name: 'Coriander', purchaseCount: 3, lastPurchasedAt: '2026-04-01' });
    const entry = { itemId: 'a', listId: null, checked: true, sortOrder: 1, choiceGroup: null, addedAt: '2026-05-01' } as GroceryListEntry;
    const plan = planMergeItems('a', 'b', { items: [from, into], itemShops: [], itemSubs: [], itemProducts: [], listEntries: [entry] })!;
    expect(plan.merged).toMatchObject({ id: 'b', purchaseCount: 5, lastPurchasedAt: '2026-05-01', onList: true });
    expect(plan.movedEntries).toEqual([{ ...entry, itemId: 'b' }]);
    expect(plan.removedEntries).toEqual([{ itemId: 'a', listId: null }]);
  });

  it('folds a box both sides have, adopting the loser\'s rating only where the survivor had none', () => {
    const boxes = [
      { id: 'p1', itemId: 'b', productKey: 'store', purchaseCount: 1, lastPurchasedAt: null, rating: null, note: '', gtin: null },
      { id: 'p2', itemId: 'a', productKey: 'store', purchaseCount: 2, lastPurchasedAt: null, rating: 'loved', note: '', gtin: null },
    ] as unknown as ItemProduct[];
    const plan = planMergeItems('a', 'b', { items: [item({ id: 'a', name: 'A' }), item({ id: 'b', name: 'B' })], itemShops: [], itemSubs: [], itemProducts: boxes, listEntries: [] })!;
    expect(plan.mergedProducts).toEqual([expect.objectContaining({ id: 'p1', purchaseCount: 3, rating: 'loved' })]);
  });

  it('refuses itself and an unknown item', () => {
    expect(planMergeItems('a', 'a', { items: [], itemShops: [], itemSubs: [], itemProducts: [], listEntries: [] })).toBeNull();
    expect(planMergeItems('a', 'b', { items: [], itemShops: [], itemSubs: [], itemProducts: [], listEntries: [] })).toBeNull();
  });
});

describe('laterOf and pickPriceFields', () => {
  it('treats null as oldest, and moves the three price fields from the newer side', () => {
    expect(laterOf(null, '2026-01-01')).toBe('2026-01-01');
    expect(laterOf('2026-02-01', '2026-01-01')).toBe('2026-02-01');
    const a: { lastPriceMinor: number | null; lastPricedAt: string | null; lastPriceQuantity: string | null } = { lastPriceMinor: 100, lastPricedAt: '2026-01-01', lastPriceQuantity: '1 lb' };
    const b = { lastPriceMinor: 200, lastPricedAt: '2026-03-01', lastPriceQuantity: null };
    expect(pickPriceFields(a, b)).toEqual({ lastPriceMinor: 200, lastPricedAt: '2026-03-01', lastPriceQuantity: null });
  });
});
