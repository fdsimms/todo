import type { GroceryItem, GroceryListEntry } from '../types';
import { listedAnywhere } from './groceryLists';

/**
 * Incidental purchases: what came home that wasn't on the list when the shop
 * started.
 *
 * **Derived, never stored.** A row's own `addedAt` (the moment it joined this
 * trolley) against the trip's start says it, so there is no flag to clear and
 * nothing for a sync to carry. The price is the same as every other derived
 * rule here: with no trip running there is no "when the shop started", and this
 * answers nothing rather than guessing from the clock. An item added to the list
 * three hours ago was probably planned, and calling it incidental would be a
 * claim the app has no evidence for.
 */

/**
 * The checked rows that joined this trolley at or after the trip began.
 *
 * Only the ticked ones: an item added mid-shop and left unticked is still a
 * thing to buy, not something that came home. `tripStartedAt` is the *resolved*
 * trip's start (`resolveActiveTrip`), so an expired or abandoned trip passes
 * `null` and gets the empty set.
 */
export function incidentalIds(
  entries: readonly GroceryListEntry[],
  listId: string | null,
  tripStartedAt: string | null
): Set<string> {
  const out = new Set<string>();
  if (!tripStartedAt) return out;
  for (const e of entries) {
    if (e.listId === listId && e.checked && e.addedAt >= tripStartedAt) out.add(e.itemId);
  }
  return out;
}

/** Why a row is offered as what came home instead of a missing item. */
export type SubstituteReason = 'usual' | 'incidental' | 'sameAisle';

export interface SubstituteCandidate {
  id: string;
  name: string;
  reason: SubstituteReason;
}

/**
 * What a row marked "they didn't have it" can be answered with, best first.
 *
 * - **usual**: a substitute link the person wrote. Always offered, bought or
 *   not, because it is the one answer the app knows they meant.
 * - **incidental**: bought this trip without being on the list. The answer to
 *   "what did you get instead" is nearly always something the list never had,
 *   which is why the old pick-from-everything-bought grid was mostly noise.
 * - **sameAisle**: something else already in the trolley from the same aisle,
 *   for the case where the replacement was on the list as its own row.
 *
 * Everything else in the trolley is left out on purpose. Paper towels are
 * never the answer for skyr, and offering them is what made the prompt read as
 * broken. A name outside this set is still one typed field away.
 */
export function substituteCandidates(input: {
  missing: Pick<GroceryItem, 'id' | 'aisle'> | null;
  /** The item's own substitute links, in the order they were written. */
  usual: ReadonlyArray<{ id: string; name: string }>;
  incidental: ReadonlySet<string>;
  /** What is in the trolley, in list order. */
  purchased: ReadonlyArray<{ id: string; name: string }>;
  aisleById: ReadonlyMap<string, string>;
}): SubstituteCandidate[] {
  const { missing, usual, incidental, purchased, aisleById } = input;
  const out: SubstituteCandidate[] = [];
  const seen = new Set<string>(missing ? [missing.id] : []);
  const push = (row: { id: string; name: string }, reason: SubstituteReason) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    out.push({ id: row.id, name: row.name, reason });
  };
  for (const row of usual) push(row, 'usual');
  for (const row of purchased) if (incidental.has(row.id)) push(row, 'incidental');
  if (missing) {
    for (const row of purchased) {
      if (aisleById.get(row.id) === missing.aisle) push(row, 'sameAisle');
    }
  }
  return out;
}

/** How many "bought before" picks the finish sheet offers at most. */
export const INCIDENTAL_PICK_LIMIT = 6;

/**
 * Catalog rows worth one-tap offering as "also bought": things you have
 * bought before that aren't in any trolley right now, most-bought first.
 *
 * It reads what the catalog already records (`purchaseCount`) rather than a
 * separate history of off-list buys, so it is "bought before" and not "usually
 * bought unplanned": a staple that is missing from the list this week is
 * exactly the thing that tends to come home anyway. A row on any list is left
 * out, since it is either already in the cart or a leftover with its own row.
 */
export function incidentalPicks(
  items: readonly GroceryItem[],
  entries: readonly GroceryListEntry[],
  limit: number = INCIDENTAL_PICK_LIMIT
): GroceryItem[] {
  const listed = listedAnywhere(entries);
  return items
    .filter(i => i.purchaseCount > 0 && !listed.has(i.id))
    .sort(
      (a, b) =>
        b.purchaseCount - a.purchaseCount
        || (b.lastPurchasedAt ?? '').localeCompare(a.lastPurchasedAt ?? '')
        || a.nameKey.localeCompare(b.nameKey)
    )
    .slice(0, limit);
}
