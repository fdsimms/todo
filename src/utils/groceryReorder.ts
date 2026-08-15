import type { GroceryItem } from '../types';

/**
 * Dragging a row on the shopping list — pure half, so the index math is pinned
 * by groceryReorder.test.ts rather than by a device in a supermarket.
 *
 * The list is one flat stream of aisle headers and item rows (see GroceryScreen),
 * which is what makes "reorder" and "change aisle" the same gesture: an item
 * adopts the aisle of the nearest header above wherever it lands, exactly the
 * rule resolveDrop uses for a task and its category section.
 */

/**
 * The row shapes this cares about. The screen's own row type carries more
 * (render keys, counts) and is structurally assignable to this.
 */
export type GroceryDropRow =
  | { type: 'aisle'; aisle: string }
  | { type: 'unavailableHeader' }
  | { type: 'cartHeader' }
  | { type: 'item'; item: GroceryItem };

export interface GroceryPlacement {
  id: string;
  /** New rank in the walk order. One counter across all aisles, as in resolveDrop. */
  sortOrder: number;
  /** The section the row ended up in. */
  aisle: string;
}

/**
 * Resolve a drop: walk the reordered rows top to bottom and hand every item its
 * new rank and its section's aisle.
 *
 * Ranks are one running counter across every aisle rather than 1..N per
 * section, so a single number decides the whole list — the same reason
 * resolveDrop hands tasks and stacks ranks from one counter. Within an aisle
 * only the relative order is ever read (buildGrocerySections sorts each section
 * by sortOrder), so the gaps between sections cost nothing.
 *
 * **Everything from the "In cart" header down is left alone.** Those rows are
 * below every aisle, so the nearest-header-above rule would file them under the
 * last aisle in the store — and their order isn't something anyone is arranging
 * anyway. Leaving them out also makes a drop mean the same thing whether the
 * cart section happens to be expanded or collapsed.
 *
 * **A `unavailableHeader` row is transparent, not a boundary.** It's a label
 * inside an aisle (the store you're standing in doesn't carry these), not a
 * new one — so it's skipped without touching `currentAisle`, the same way an
 * aisle header itself is the only thing allowed to change it.
 */
export function resolveGroceryDrop(rows: readonly GroceryDropRow[]): GroceryPlacement[] {
  const placements: GroceryPlacement[] = [];
  let currentAisle: string | null = null;
  let rank = 0;

  for (const row of rows) {
    if (row.type === 'cartHeader') break;
    if (row.type === 'aisle') {
      currentAisle = row.aisle;
      continue;
    }
    if (row.type === 'unavailableHeader') continue;
    rank += 1;
    placements.push({
      id: row.item.id,
      sortOrder: rank,
      // No header above at all (nothing on the list is laid out that way, but a
      // drag range is a clamp, not a guarantee): keep the aisle it already had
      // rather than inventing one.
      aisle: currentAisle ?? row.item.aisle,
    });
  }

  return placements;
}

/**
 * A row as the screen actually holds it — the same shapes above, plus the list
 * key each one renders under. Only the add-button drop needs the keys, because
 * that's the one placement that names its seam by key rather than by having the
 * reordered array handed to it.
 */
export type KeyedGroceryDropRow = GroceryDropRow & { key: string };

/**
 * Placements for items created by dropping the *add button* at a seam, rather
 * than by dragging a row that was already there.
 *
 * Deliberately the same pass a finished row drag runs: splice the new rows in
 * at the drop point and hand the result to resolveGroceryDrop, so the
 * aisle-from-nearest-header rule and the one running rank are the ones already
 * in use and not a second copy of them (placeCreatedProject does this for
 * projects, for the same reason).
 *
 * `created` is spliced in the order it was typed, so a pasted block arrives on
 * the list reading the way it was written. Any of those items that is *already*
 * on the list is dropped from its old position first — a name that comes back
 * moves to where it was just asked for rather than appearing twice.
 *
 * Null when the anchor row is no longer in `rows` (the list changed under the
 * sheet). The caller has nothing to apply: the item is on the list already,
 * appended, which is exactly where an unplaced add goes.
 */
export function placeNewGroceryItems(
  rows: readonly KeyedGroceryDropRow[],
  anchorKey: string,
  before: boolean,
  created: readonly GroceryItem[],
): GroceryPlacement[] | null {
  if (created.length === 0) return null;
  const fresh = new Set(created.map(i => i.id));
  const base = rows.filter(r => r.type !== 'item' || !fresh.has(r.item.id));
  const anchor = base.findIndex(r => r.key === anchorKey);
  if (anchor < 0) return null;

  const spliced: KeyedGroceryDropRow[] = [...base];
  spliced.splice(
    before ? anchor : anchor + 1,
    0,
    ...created.map(item => ({ type: 'item' as const, key: item.id, item })),
  );
  return resolveGroceryDrop(spliced);
}

/**
 * Inclusive [min, max] index range an item may be dragged across.
 *
 * Bounded at the top by the first aisle header — an item dropped above every
 * header has no aisle to adopt, and unlike Today there is no header-less
 * section for it to become part of. Bounded at the bottom by the "In cart"
 * header, since that section is a record of what's already in the trolley
 * rather than a place to file something.
 *
 * **Not similarly bounded above a `unavailableHeader`.** A "not here" row
 * can't be picked up as a drag source at all (see GroceryScreen), so the only
 * way one enters that range is a normal item dropped there — which
 * `resolveGroceryDrop` still ranks correctly, and the next render moves it
 * straight back out, since bucket membership is read fresh from the trip
 * marker rather than from where it landed. A per-aisle exclusion zone would
 * only prevent a one-frame visual that self-corrects on its own.
 */
export function groceryDragRange(
  rows: readonly GroceryDropRow[],
  activeIndex: number,
): [number, number] {
  const firstAisle = rows.findIndex(r => r.type === 'aisle');
  const cartHeader = rows.findIndex(r => r.type === 'cartHeader');
  const lo = firstAisle >= 0 ? firstAisle + 1 : activeIndex;
  const hi = cartHeader >= 0 ? cartHeader - 1 : rows.length - 1;
  // A degenerate list (no headers, or a cart header first) would otherwise hand
  // back an inverted range, which reads as "drop anywhere" once clamped.
  if (hi < lo) return [activeIndex, activeIndex];
  return [lo, hi];
}
