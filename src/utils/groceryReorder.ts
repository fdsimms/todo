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
 * Inclusive [min, max] index range an item may be dragged across.
 *
 * Bounded at the top by the first aisle header — an item dropped above every
 * header has no aisle to adopt, and unlike Today there is no header-less
 * section for it to become part of. Bounded at the bottom by the "In cart"
 * header, since that section is a record of what's already in the trolley
 * rather than a place to file something.
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
