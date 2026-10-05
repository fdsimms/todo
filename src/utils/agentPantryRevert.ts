import type { GroceryItem, ItemProduct, Leftover, UnattendedEntry, UnattendedRevert } from '../types';

/**
 * Taking back an agent's pantry write, on the same terms as every other undo:
 * **offered only while the record is still how the agent left it.**
 *
 * A pantry write touches an item's row and, sometimes, its boxes (a frozen
 * portion made or deleted) and the home list (running low joins it). The
 * ledger's field-level revert carries one flat record, so an entry here stores
 * a *snapshot* on each side: the item's pantry fields, the item's boxes, and
 * whether the item was on the list at home. An undo compares the world to the
 * "after" snapshot, and writes the "before" one back.
 *
 * A leftover is its own record and its own (smaller) snapshot.
 */

/** The item fields a pantry write can change, and so the ones an undo writes back. */
export const PANTRY_ITEM_REVERT_FIELDS = [
  'name', 'onHandUntil', 'isStaple', 'expiresAt', 'runningLowAt', 'openedAt', 'frozenAt', 'shelfLifeDays',
  'useUpTask', 'usedUpCount', 'spoiledCount', 'lastSpoiledAt', 'pantryReviewedAt', 'lastAddedAt',
] as const;

/** The leftover fields a pantry write can change. */
export const LEFTOVER_REVERT_FIELDS = ['frozenAt', 'storedAt', 'keepUntil', 'finishedAt', 'outcome'] as const;

/** The columns of a box that carry its pantry state. Everything else about a box is never touched. */
const BOX_STATE_FIELDS = ['onHandUntil', 'expiresAt', 'frozenAt', 'openedAt'] as const;

export interface PantryItemSnapshot {
  item: Record<string, unknown>;
  boxes: ItemProduct[];
  /** Whether the item was on the list at home. */
  onHome: boolean;
}

export interface LeftoverSnapshot {
  leftover: Record<string, unknown>;
}

export function pantrySnapshot(item: GroceryItem, boxes: readonly ItemProduct[], onHome: boolean): PantryItemSnapshot {
  const record = item as unknown as Record<string, unknown>;
  return {
    item: Object.fromEntries(PANTRY_ITEM_REVERT_FIELDS.map(k => [k, record[k] ?? null])),
    boxes: boxes.map(b => ({ ...b })),
    onHome,
  };
}

export function leftoverSnapshot(leftover: Leftover): LeftoverSnapshot {
  const record = leftover as unknown as Record<string, unknown>;
  return { leftover: Object.fromEntries(LEFTOVER_REVERT_FIELDS.map(k => [k, record[k] ?? null])) };
}

/** The revert an entry carries, or null when nothing it records changed. */
export function pantryRevertOf(before: PantryItemSnapshot | LeftoverSnapshot, after: PantryItemSnapshot | LeftoverSnapshot): UnattendedRevert | null {
  return same(before, after) ? null : { before: before as unknown as Record<string, unknown>, after: after as unknown as Record<string, unknown> };
}

/** What the plan needs to know about the world. */
export interface PantryRecordState {
  groceryItem(id: string): GroceryItem | null;
  itemBoxes(itemId: string): ItemProduct[];
  /** The item's entry on the list at home, or null when it is not on it. */
  groceryHome(itemId: string): { checked: boolean } | null;
  leftover(id: string): Leftover | null;
}

export type PantryRecordPlan =
  | { kind: 'restorePantryItem'; itemId: string; patch: Record<string, unknown>; boxes: ItemProduct[]; removeBoxIds: string[]; removeFromList: boolean }
  | { kind: 'restoreLeftover'; id: string; patch: Record<string, unknown> }
  | { kind: 'removeLeftover'; id: string }
  | { kind: 'none'; reason: string | null };

const NONE: PantryRecordPlan = { kind: 'none', reason: null };

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function pick(record: object, keys: readonly string[]): Record<string, unknown> {
  const r = record as Record<string, unknown>;
  return Object.fromEntries(keys.map(k => [k, r[k] ?? null]));
}

function boxesMatch(current: readonly ItemProduct[], snapshot: readonly ItemProduct[]): boolean {
  if (current.length !== snapshot.length) return false;
  const byId = new Map(current.map(b => [b.id, b]));
  return snapshot.every(s => {
    const c = byId.get(s.id);
    return !!c && same(pick(c, BOX_STATE_FIELDS), pick(s, BOX_STATE_FIELDS));
  });
}

export function pantryRecordPlan(entry: UnattendedEntry, state: PantryRecordState): PantryRecordPlan {
  const id = entry.recordId ?? null;
  if (!id) return NONE;

  // A container the agent logged: removable while it exists and is still open,
  // the rule a log entry gets, since there is nothing to compare it with.
  if (entry.action === 'created') {
    const row = state.leftover(id);
    if (!row) return { kind: 'none', reason: 'Removed since' };
    return row.finishedAt ? { kind: 'none', reason: 'Finished since' } : { kind: 'removeLeftover', id };
  }

  const revert = entry.revert;
  if (entry.action !== 'edited' || !revert) return NONE;

  if ('leftover' in revert.before) {
    const row = state.leftover(id);
    if (!row) return { kind: 'none', reason: 'Removed since' };
    const before = revert.before.leftover as Record<string, unknown>;
    const after = revert.after.leftover as Record<string, unknown>;
    const now = pick(row, Object.keys(before));
    if (same(now, before)) return { kind: 'none', reason: 'Undone' };
    if (!same(now, after)) return { kind: 'none', reason: 'Changed since' };
    return { kind: 'restoreLeftover', id, patch: before };
  }

  const item = state.groceryItem(id);
  if (!item) return { kind: 'none', reason: 'Removed since' };
  const before = revert.before as unknown as PantryItemSnapshot;
  const after = revert.after as unknown as PantryItemSnapshot;
  const boxes = state.itemBoxes(id);
  const home = state.groceryHome(id) !== null;
  const matches = (side: PantryItemSnapshot): boolean =>
    same(pick(item, Object.keys(side.item)), side.item) && boxesMatch(boxes, side.boxes) && home === side.onHome;
  if (matches(before)) return { kind: 'none', reason: 'Undone' };
  if (!matches(after)) return { kind: 'none', reason: 'Changed since' };
  const beforeIds = new Set(before.boxes.map(b => b.id));
  return {
    kind: 'restorePantryItem',
    itemId: id,
    patch: before.item,
    boxes: before.boxes,
    removeBoxIds: after.boxes.filter(b => !beforeIds.has(b.id)).map(b => b.id),
    removeFromList: home && !before.onHome,
  };
}
