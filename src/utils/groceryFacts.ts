import type {
  GroceryItem,
  ItemProduct,
  ItemShopLink,
  ItemSubLink,
  StoreAlias,
} from '../types';

/**
 * Everything that hangs off a catalog row rather than living on it. Passed as
 * one object because the four arrays are always read together and a positional
 * signature of four same-typed lists is the kind that gets transposed silently.
 */
export interface ItemRelations {
  products: readonly ItemProduct[];
  subs: readonly ItemSubLink[];
  shops: readonly ItemShopLink[];
  aliases: readonly StoreAlias[];
}

/**
 * The ids of every item something is hung off, as one set.
 *
 * Built once per sweep rather than scanned per row: `clearList` asks about a
 * whole list at a time, and four `.some()` walks over four arrays for each of
 * fifty rows is thousands of comparisons on a tap. Subs contribute *both* ends
 * — see the note in `hasUserFacts`.
 */
export function linkedItemIds(relations: ItemRelations): Set<string> {
  const ids = new Set<string>();
  for (const p of relations.products) ids.add(p.itemId);
  for (const l of relations.subs) { ids.add(l.itemId); ids.add(l.subItemId); }
  for (const l of relations.shops) ids.add(l.itemId);
  for (const a of relations.aliases) ids.add(a.itemId);
  return ids;
}

/**
 * Whether this row carries anything a person put there.
 *
 * **This is what replaced the `inCatalog` flag** (#1998), and the difference is
 * the whole point. `inCatalog` was a stored bit meaning "this row is really
 * yours", and every feature that recorded a fact about an item had to remember
 * to set it — `linkItemShop`, `linkItemSub`, `addToPantry`, `setPreferredProduct`
 * and `setProductStrict` each carried their own copy of the same note, saying
 * that without the promotion the next "Remove from list" would delete the row
 * and silently take the assertion with it. Seven call sites remembering a rule
 * is six chances to forget it, and a feature that forgot lost user data on an
 * unrelated action.
 *
 * Derived, that class of bug stops existing: the fact *is* the protection. A
 * new feature that hangs something off an item makes that item undeletable as a
 * side effect of the thing it stored, with nothing to remember and nothing to
 * keep in step.
 *
 * **It is deliberately generous.** Every caller deletes on a false answer, and
 * the two outcomes are not symmetric: keeping a row nobody wanted costs a line
 * in a catalog that already ranks by familiarity and buries it within weeks
 * (see `familiarity` in `grocerySuggest.ts`), while dropping one wrongly
 * destroys a substitute, a price history or a brand with no undo. So anything
 * arguable counts as a fact, and only a row that is purely a name — typed,
 * never shopped, never spoken about — answers false.
 *
 * Three callers, all of which delete: `clearList`'s sweep of an abandoned
 * trip, `revertAdds` (so undoing an add can't destroy something recorded on
 * the row since), and `catalogPruneCandidates`, whose "never bought" test was
 * on its own too weak to protect a row someone had named a brand on.
 *
 * Not counted, and each for its own reason:
 *   - `aisle`, because the lexicon guesses it unasked, and a hand-set one is
 *     kept in the `grocery_aisle_overrides` setting keyed by `nameKey` — it
 *     survives the row's deletion and is re-applied on re-add, so it is not
 *     something a delete can lose.
 *   - `sourceRecipeId`/`sourceRecipeTitle`, stamped by `addFromPlan` rather
 *     than typed.
 *   - `lastAddedAt`/`createdAt`/`sortOrder`, which every row has by existing.
 *   - `choiceGroup`, which is this trolley's own either/or and dies with it.
 */
export function hasUserFacts(item: GroceryItem, linked: ReadonlySet<string>): boolean {
  // Shopped for. A purchase is the original promotion rule and still the
  // commonest one — it also brings the price and cadence the pantry reads.
  if (item.purchaseCount > 0 || item.lastPurchasedAt) return true;
  if (item.lastPriceMinor !== null || item.priceHistory.length > 0) return true;

  // Said about the kitchen: "I always have it", "Got it", "Out of it", frozen,
  // opened, nearly out, goes off on this date, keeps this long.
  if (item.isStaple) return true;
  if (item.onHandUntil || item.frozenAt || item.openedAt || item.runningLowAt) return true;
  if (item.expiresAt || item.shelfLifeDays !== null) return true;

  // How it left the kitchen last time, and whether the app was told to stop
  // asking about it.
  if (item.usedUpCount > 0 || item.spoiledCount > 0 || item.lastSpoiledAt) return true;
  if (item.pantryCheckDeclinedAt || item.useUpTask !== null) return true;

  // Which one of it.
  if (item.preferredProductId || item.productStrict) return true;

  // Typed onto the row. A quantity only counts when the user set it — the
  // recipe-owned kind is `addFromPlan`'s bookkeeping, not a preference (see
  // GroceryItem.quantityFromRecipe).
  if (item.note.trim()) return true;
  if (item.quantity && !item.quantityFromRecipe) return true;

  // Hung off the row — a box, a store link, a substitute, a receipt alias.
  // Subs count in both directions: "margarine instead of butter" is a fact
  // about margarine's row as much as butter's, and deleting either end drops
  // the link. See linkedItemIds, which is what builds this set.
  return linked.has(item.id);
}
