import type { GroceryItem, UnattendedEntry } from '../types';
import {
  catalogRecordPlan,
  catalogRevertOf,
  catalogSnapshot,
  deletedItemRevert,
  type CatalogRecordState,
} from '../utils/agentCatalogRevert';
import type { DeletedItemSnapshot } from '../utils/groceryItemWrite';

const item = (over: Partial<GroceryItem> = {}): GroceryItem =>
  ({ id: 'g1', name: 'Milk', nameKey: 'milk', aisle: 'Dairy', quantity: null, quantityFromRecipe: false, note: '', lastPriceMinor: null, lastPricedAt: null, lastPriceQuantity: null, varietyOfKey: null, preferredProductId: null, productStrict: false, ...over }) as GroceryItem;

const state = (over: Partial<CatalogRecordState> = {}): CatalogRecordState => ({
  groceryItem: () => null, aisleOverride: () => null, itemKeyTaken: () => false, ...over,
});

const entry = (over: Partial<UnattendedEntry>): UnattendedEntry =>
  ({ id: 'e1', at: 'now', actor: 'agent', subject: 'catalog', action: 'edited', title: 'Milk', taskId: null, recordId: 'g1', ...over }) as UnattendedEntry;

describe('an item edit', () => {
  const before = catalogSnapshot(item(), {});
  const after = catalogSnapshot(item({ aisle: 'Other' }), { milk: 'Other' });
  const e = entry({ revert: catalogRevertOf(before, after) });

  it('is null when nothing it records changed', () => {
    expect(catalogRevertOf(before, catalogSnapshot(item(), {}))).toBeNull();
  });

  it('is offered while the item and the remembered filing are as left, and writes the before back', () => {
    const plan = catalogRecordPlan(e, state({ groceryItem: () => item({ aisle: 'Other' }), aisleOverride: () => 'Other' }));
    expect(plan).toEqual({ kind: 'restoreCatalogItem', itemId: 'g1', patch: expect.objectContaining({ aisle: 'Dairy' }), nameKey: 'milk', aisleOverride: null });
  });

  it('reads Undone, Changed since or Removed since otherwise, and a remembered filing counts as part of the state', () => {
    expect(catalogRecordPlan(e, state({ groceryItem: () => item() }))).toEqual({ kind: 'none', reason: 'Undone' });
    expect(catalogRecordPlan(e, state({ groceryItem: () => item({ aisle: 'Produce' }) }))).toEqual({ kind: 'none', reason: 'Changed since' });
    expect(catalogRecordPlan(e, state({ groceryItem: () => item({ aisle: 'Other' }), aisleOverride: () => 'Produce' }))).toEqual({ kind: 'none', reason: 'Changed since' });
    expect(catalogRecordPlan(e, state())).toEqual({ kind: 'none', reason: 'Removed since' });
  });

  it('has nothing to offer without a revert', () => {
    expect(catalogRecordPlan(entry({ revert: null }), state({ groceryItem: () => item() }))).toEqual({ kind: 'none', reason: null });
  });
});

describe('a deleted item', () => {
  const snapshot = { item: item(), entries: [], boxes: [], shopLinks: [], subLinks: [], aliases: [], aisleOverride: null } as DeletedItemSnapshot;
  const e = entry({ action: 'cleared', revert: deletedItemRevert(snapshot) });

  it('can be restored while neither its id nor its name is back', () => {
    expect(catalogRecordPlan(e, state())).toEqual({ kind: 'restoreDeletedItem', snapshot });
    expect(catalogRecordPlan(e, state({ groceryItem: () => item() }))).toEqual({ kind: 'none', reason: 'Added back since' });
    expect(catalogRecordPlan(e, state({ itemKeyTaken: () => true }))).toEqual({ kind: 'none', reason: 'Name in use since' });
  });
});
