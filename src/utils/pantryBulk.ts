import type { KitchenEntry } from './kitchenInventory';
import type { UndoableAction } from './undoHistory';
import { useGroceryStore } from '../store/useGroceryStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { defaultOnHandUntil } from './grocerySuggest';

/**
 * The pantry's bulk actions: what the row menu offers one row at a time, for a
 * selection. Clearing out a fridge was two taps per thing.
 *
 * - `usedUp` / `spoiled`: the two ways out. A catalog row records which
 *   (`markOutOfMany`), a box is out (`markProductsOutOf`, which has no outcome
 *   of its own), and a container is finished as eaten or thrown out.
 * - `have`: "Got it", for catalog rows only. A box and a container have no
 *   on-hand date to set.
 * - `freeze`: into the freezer, for anything not already in it.
 */
export type PantryBulkAction = 'usedUp' | 'spoiled' | 'have' | 'freeze';

export interface PantryBulkTargets {
  itemIds: string[];
  productIds: string[];
  leftoverIds: string[];
}

/** The selection split by which store each row belongs to. */
export function partitionPantryEntries(entries: readonly Pick<KitchenEntry, 'kind' | 'sourceId'>[]): PantryBulkTargets {
  const out: PantryBulkTargets = { itemIds: [], productIds: [], leftoverIds: [] };
  for (const entry of entries) {
    if (entry.kind === 'grocery') out.itemIds.push(entry.sourceId);
    else if (entry.kind === 'product') out.productIds.push(entry.sourceId);
    else out.leftoverIds.push(entry.sourceId);
  }
  return out;
}

/** The undo bar's line for a batch. */
export function pantryBulkLabel(action: PantryBulkAction, count: number): string {
  const things = count === 1 ? '1 thing' : `${count} things`;
  switch (action) {
    case 'usedUp': return `Used up ${things}`;
    case 'spoiled': return `Marked ${things} as gone bad`;
    case 'have': return `Marked ${things} as on hand`;
    case 'freeze': return `Froze ${things}`;
  }
}

/**
 * Applies `action` to a selection and files **one** undo for the whole batch,
 * on the grocery store's undo bar.
 *
 * The rows live in two stores and the actions underneath file their undos
 * differently: the two "out" writes each put an entry on the grocery store,
 * while finishing a container, freezing anything and "Got it" file none. So
 * the entries the batch pushed are lifted back off the grocery stack and
 * folded into one, alongside undos written here for the rest, and the stack
 * is left as it was plus that one entry (`replacing`). A tossed container's
 * forfeited use-up coins are not refunded by the undo, the same as finishing
 * one from its own sheet.
 *
 * Returns how many rows it changed.
 */
export function applyPantryBulk(action: PantryBulkAction, entries: readonly Pick<KitchenEntry, 'kind' | 'sourceId'>[]): number {
  const grocery = useGroceryStore.getState();
  const leftovers = useLeftoverStore.getState();
  const { itemIds, productIds, leftoverIds } = partitionPantryEntries(entries);
  const before = grocery.undoStack;
  const undos: Array<() => void> = [];
  let changed = 0;

  if (action === 'usedUp' || action === 'spoiled') {
    if (itemIds.length > 0) changed += grocery.markOutOfMany(itemIds, action);
    if (productIds.length > 0) changed += grocery.markProductsOutOf(productIds);
    for (const id of leftoverIds) {
      const row = leftovers.leftovers.find(l => l.id === id);
      if (!row || row.finishedAt) continue;
      useLeftoverStore.getState().finishLeftover(id, action === 'usedUp' ? 'eaten' : 'tossed');
      undos.push(() => useLeftoverStore.getState().reopenLeftover(id));
      changed += 1;
    }
  } else if (action === 'have') {
    const now = new Date();
    for (const id of itemIds) {
      const item = grocery.items.find(i => i.id === id);
      if (!item) continue;
      const was = item.onHandUntil;
      useGroceryStore.getState().setOnHandUntil(id, defaultOnHandUntil(item, now));
      undos.push(() => useGroceryStore.getState().setOnHandUntil(id, was));
      changed += 1;
    }
  } else {
    for (const id of itemIds) {
      const item = grocery.items.find(i => i.id === id);
      if (!item || item.frozenAt) continue;
      useGroceryStore.getState().setFrozen(id, true);
      undos.push(() => useGroceryStore.getState().setFrozen(id, false));
      changed += 1;
    }
    for (const id of productIds) {
      const product = grocery.itemProducts.find(p => p.id === id);
      if (!product || product.frozenAt) continue;
      useGroceryStore.getState().setProductFrozen(id, true);
      undos.push(() => useGroceryStore.getState().setProductFrozen(id, false));
      changed += 1;
    }
    for (const id of leftoverIds) {
      const row = leftovers.leftovers.find(l => l.id === id);
      if (!row || row.frozenAt || row.finishedAt) continue;
      useLeftoverStore.getState().setFrozen(id, true);
      undos.push(() => useLeftoverStore.getState().setFrozen(id, false));
      changed += 1;
    }
  }

  if (changed === 0) return 0;
  const kept = new Set(before);
  const pushed: UndoableAction[] = useGroceryStore.getState().undoStack.filter(e => !kept.has(e));
  useGroceryStore.getState().setLastAction({
    label: pantryBulkLabel(action, changed),
    destructive: action === 'usedUp' || action === 'spoiled',
    announce: action === 'have' || action === 'freeze',
    undo: () => {
      for (const undo of [...undos].reverse()) undo();
      for (const entry of [...pushed].reverse()) entry.undo();
    },
    redo: () => { applyPantryBulk(action, entries); },
  }, { replacing: before });
  return changed;
}
