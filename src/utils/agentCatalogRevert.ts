import type { GroceryItem, UnattendedEntry, UnattendedRevert } from '../types';
import type { DeletedItemSnapshot } from './groceryItemWrite';

/**
 * Taking back an agent's change to the grocery catalog, on the same terms as
 * every other undo: **offered only while the record is still how the agent left
 * it.** Two things can be undone. An edit that touched only the item's own
 * fields (aisle, quantity, note, price, variety, preferred box, strictness) is
 * undone by writing those fields back, with the remembered aisle for the name.
 * A deleted item is undone by putting back everything the delete took with it
 * (`DeletedItemSnapshot`). A rename, a store or substitute link, a store, a
 * list and a receipt import are recorded and not undoable from Activity.
 */

/** The item fields a reversible catalog edit can change. */
export const CATALOG_REVERT_FIELDS = [
  'aisle', 'quantity', 'quantityFromRecipe', 'note', 'lastPriceMinor', 'lastPricedAt', 'lastPriceQuantity',
  'varietyOfKey', 'preferredProductId', 'productStrict',
] as const;

export interface CatalogItemSnapshot {
  item: Record<string, unknown>;
  /** What the name was remembered as filed under, or null for nothing. */
  aisleOverride: string | null;
}

export function catalogSnapshot(item: GroceryItem, aisleOverrides: Readonly<Record<string, string>>): CatalogItemSnapshot {
  const record = item as unknown as Record<string, unknown>;
  return {
    item: Object.fromEntries(CATALOG_REVERT_FIELDS.map(k => [k, record[k] ?? null])),
    aisleOverride: aisleOverrides[item.nameKey] ?? null,
  };
}

export function catalogRevertOf(before: CatalogItemSnapshot, after: CatalogItemSnapshot): UnattendedRevert | null {
  return same(before, after) ? null : { before: before as unknown as Record<string, unknown>, after: after as unknown as Record<string, unknown> };
}

export function deletedItemRevert(snapshot: DeletedItemSnapshot): UnattendedRevert {
  return { before: { deleted: snapshot } as unknown as Record<string, unknown>, after: {} };
}

export interface CatalogRecordState {
  groceryItem(id: string): GroceryItem | null;
  /** The remembered aisle for a name key, or null. */
  aisleOverride(nameKey: string): string | null;
  /** Whether some item already holds this name key. */
  itemKeyTaken(nameKey: string): boolean;
}

export type CatalogRecordPlan =
  | { kind: 'restoreCatalogItem'; itemId: string; patch: Record<string, unknown>; nameKey: string; aisleOverride: string | null }
  | { kind: 'restoreDeletedItem'; snapshot: DeletedItemSnapshot }
  | { kind: 'none'; reason: string | null };

const NONE: CatalogRecordPlan = { kind: 'none', reason: null };

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function pick(record: object, keys: readonly string[]): Record<string, unknown> {
  const r = record as Record<string, unknown>;
  return Object.fromEntries(keys.map(k => [k, r[k] ?? null]));
}

export function catalogRecordPlan(entry: UnattendedEntry, state: CatalogRecordState): CatalogRecordPlan {
  const revert = entry.revert;
  if (!revert) return NONE;

  if ('deleted' in revert.before) {
    const snapshot = revert.before.deleted as DeletedItemSnapshot;
    if (state.groceryItem(snapshot.item.id)) return { kind: 'none', reason: 'Added back since' };
    if (state.itemKeyTaken(snapshot.item.nameKey)) return { kind: 'none', reason: 'Name in use since' };
    return { kind: 'restoreDeletedItem', snapshot };
  }

  const id = entry.recordId ?? null;
  if (!id || entry.action !== 'edited') return NONE;
  const item = state.groceryItem(id);
  if (!item) return { kind: 'none', reason: 'Removed since' };
  const before = revert.before as unknown as CatalogItemSnapshot;
  const after = revert.after as unknown as CatalogItemSnapshot;
  const matches = (side: CatalogItemSnapshot): boolean =>
    same(pick(item, Object.keys(side.item)), side.item) && same(state.aisleOverride(item.nameKey), side.aisleOverride);
  if (matches(before)) return { kind: 'none', reason: 'Undone' };
  if (!matches(after)) return { kind: 'none', reason: 'Changed since' };
  return { kind: 'restoreCatalogItem', itemId: id, patch: before.item, nameKey: item.nameKey, aisleOverride: before.aisleOverride };
}
