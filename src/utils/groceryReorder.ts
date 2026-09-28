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
  | { type: 'recipeHeader' }
  | { type: 'unavailableHeader' }
  | { type: 'cartHeader' }
  | { type: 'item'; item: GroceryItem };

export interface GroceryPlacement {
  id: string;
  /**
   * New rank in the walk order: one of the slots this aisle's visible rows
   * already held, handed out again in their new order (see resolveGroceryDrop).
   */
  sortOrder: number;
  /** The section the row ended up in. */
  aisle: string;
}

/**
 * Resolve a drop: walk the reordered rows top to bottom and hand every item its
 * new rank and its section's aisle.
 *
 * **The visible rows are laid into the slots they already hold, never
 * renumbered 1..n.** The rows handed in are only what's on screen: the cart
 * rows below the "In cart" header and every row in a collapsed aisle are
 * missing, and they keep their own `sortOrder`. Renumbering the visible rows
 * from 1 moved those hidden ones for them: a ticked row between apples and
 * carrots came back last in Produce once un-ticked, because apples and carrots
 * had become 1 and 2 around its old 11. So each aisle's visible rows pool the
 * slots they held before the drag, sorted, and take them back in their new
 * order, which is the `slotUpdates` rule (projectOrder.ts) applied per aisle.
 * Per aisle because only the order within an aisle is ever read
 * (buildGrocerySections sorts each section by sortOrder, and aisle order is its
 * own setting); pooling across aisles would trade a Dairy row's slot for a
 * Produce one and move each past hidden rows in its new aisle.
 *
 * A row that changed aisle brings its old slot into the new aisle's pool, so
 * it can still land either side of a hidden row there. A row dropped into a
 * collapsed aisle is the whole of that aisle's visible pool and keeps its own
 * slot. Neither is worse than before, when every rank was new.
 *
 * Slots are forced strictly increasing before they're handed out, same as
 * `slotUpdates`: rows added in a batch can share one, and handing a run of
 * equal numbers back out would leave the drag nothing to persist.
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
 *
 * **`recipeHeader` never actually reaches here.** Row drag is disabled
 * whenever the list is grouped by recipe (see GroceryScreen), so this only
 * exists to keep the type honest about every row `ListRow` can hand it; it's
 * skipped the same way `unavailableHeader` is, on the off chance it does.
 */
export function resolveGroceryDrop(rows: readonly GroceryDropRow[]): GroceryPlacement[] {
  const walk: Array<{ item: GroceryItem; aisle: string }> = [];
  let currentAisle: string | null = null;

  for (const row of rows) {
    if (row.type === 'cartHeader') break;
    if (row.type === 'aisle') {
      currentAisle = row.aisle;
      continue;
    }
    if (row.type === 'unavailableHeader' || row.type === 'recipeHeader') continue;
    walk.push({
      item: row.item,
      // No header above at all (nothing on the list is laid out that way, but a
      // drag range is a clamp, not a guarantee): keep the aisle it already had
      // rather than inventing one.
      aisle: currentAisle ?? row.item.aisle,
    });
  }

  // Each aisle's slots, sorted and forced strictly increasing, handed out in
  // the walk order of that aisle's rows.
  const slotsByAisle = new Map<string, number[]>();
  for (const { item, aisle } of walk) {
    const slots = slotsByAisle.get(aisle) ?? [];
    slots.push(item.sortOrder);
    slotsByAisle.set(aisle, slots);
  }
  for (const slots of slotsByAisle.values()) {
    slots.sort((a, b) => a - b);
    for (let i = 1; i < slots.length; i++) {
      if (slots[i] <= slots[i - 1]) slots[i] = slots[i - 1] + 1;
    }
  }

  const taken = new Map<string, number>();
  return walk.map(({ item, aisle }) => {
    const i = taken.get(aisle) ?? 0;
    taken.set(aisle, i + 1);
    return { id: item.id, sortOrder: slotsByAisle.get(aisle)![i], aisle };
  });
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
 * aisle-from-nearest-header rule and the slot rule are the ones already in use
 * and not a second copy of them (placeCreatedProject does this for projects,
 * for the same reason).
 *
 * A created row's `sortOrder` is its slot in the pool, so it has to be the
 * active list's entry slot rather than the item's home mirror: the caller
 * projects `created` onto the list's entries first, as `itemsOnList` does for
 * the rows on screen.
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
