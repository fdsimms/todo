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
 * How many things are hung off each item — boxes, store links, substitutes and
 * receipt aliases counted together.
 *
 * Built once per sweep rather than scanned per row: `clearList` asks about a
 * whole list at a time, and four `.some()` walks over four arrays for each of
 * fifty rows is thousands of comparisons on a tap.
 *
 * A **count**, not a membership set, because `factSignature` has to notice a
 * *second* link arriving on a row that already had one — a row minted with a
 * Brand chip owns an `ItemProduct` from birth, so "does it have any links" is
 * already true before the user names a store on it.
 *
 * Subs contribute to *both* ends: "margarine instead of butter" is a fact about
 * margarine's row as much as butter's, and deleting either end drops the link.
 */
export function linkCounts(relations: ItemRelations): Map<string, number> {
  const counts = new Map<string, number>();
  const bump = (id: string) => counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const p of relations.products) bump(p.itemId);
  for (const l of relations.subs) { bump(l.itemId); bump(l.subItemId); }
  for (const l of relations.shops) bump(l.itemId);
  for (const a of relations.aliases) bump(a.itemId);
  return counts;
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
 * trip, `undoForAdds` (which compares two `factSignature`s rather than calling
 * this, for the reason that function's own note gives), and
 * `catalogPruneCandidates`, whose "never bought" test was on its own too weak
 * to protect a row someone had named a brand on.
 *
 * Not counted, and each for its own reason:
 *   - `aisle`, because the lexicon guesses it unasked, and a hand-set one is
 *     kept in the `grocery_aisle_overrides` setting keyed by `nameKey` — it
 *     survives the row's deletion and is re-applied on re-add, so it is not
 *     something a delete can lose.
 *   - `sourceRecipeId`/`sourceRecipeTitle`, stamped by `addFromPlan` rather
 *     than typed.
 *   - `lastAddedAt`/`createdAt`/`sortOrder`, which every row has by existing.
 *   - `choiceGroup`, which is this trolley's own either/or. Every path that
 *     takes a row off the list clears it (see removeFromList), so it can't
 *     outlive the list it belonged to.
 */
export function hasUserFacts(item: GroceryItem, linked: ReadonlyMap<string, number>): boolean {
  if (linked.has(item.id)) return true;
  return FACT_READERS.some(read => read(item) !== '');
}

/**
 * One reader per fact a row can carry: `''` when it isn't there, a stable
 * string naming its current value when it is.
 *
 * A table rather than a chain of `if`s because two questions are asked of it
 * and they must never disagree: *is* there a fact (`hasUserFacts`) and *which
 * facts, with which values* (`factSignature`). Written twice, the second would
 * drift from the first on the next field added, and the failure would be a
 * silent one — an undo that deletes a row it should have spared.
 */
const FACT_READERS: ReadonlyArray<(item: GroceryItem) => string> = [
  // Shopped for. A purchase is the original promotion rule and still the
  // commonest one — it also brings the price and cadence the pantry reads.
  i => (i.purchaseCount > 0 ? `bought:${i.purchaseCount}` : ''),
  i => (i.lastPurchasedAt ? `boughtAt:${i.lastPurchasedAt}` : ''),
  i => (i.lastPriceMinor !== null ? `price:${i.lastPriceMinor}` : ''),
  i => (i.priceHistory.length > 0 ? `prices:${i.priceHistory.length}` : ''),

  // Said about the kitchen: "I always have it", "Got it", "Out of it", frozen,
  // opened, nearly out, goes off on this date, keeps this long.
  i => (i.isStaple ? 'staple' : ''),
  i => (i.onHandUntil ? `onHand:${i.onHandUntil}` : ''),
  i => (i.frozenAt ? `frozen:${i.frozenAt}` : ''),
  i => (i.openedAt ? `opened:${i.openedAt}` : ''),
  i => (i.runningLowAt ? `low:${i.runningLowAt}` : ''),
  i => (i.expiresAt ? `expires:${i.expiresAt}` : ''),
  i => (i.shelfLifeDays !== null ? `shelfLife:${i.shelfLifeDays}` : ''),

  // How it left the kitchen last time, and whether the app was told to stop
  // asking about it.
  i => (i.usedUpCount > 0 ? `usedUp:${i.usedUpCount}` : ''),
  i => (i.spoiledCount > 0 ? `spoiled:${i.spoiledCount}` : ''),
  i => (i.lastSpoiledAt ? `spoiledAt:${i.lastSpoiledAt}` : ''),
  i => (i.pantryCheckDeclinedAt ? `declined:${i.pantryCheckDeclinedAt}` : ''),
  i => (i.useUpTask !== null ? `useUp:${i.useUpTask}` : ''),

  // Which one of it — and which thing it's one of.
  i => (i.preferredProductId ? `box:${i.preferredProductId}` : ''),
  i => (i.productStrict ? 'strict' : ''),
  i => (i.varietyOfKey ? `varietyOf:${i.varietyOfKey}` : ''),

  // Typed onto the row. A quantity only counts when the user set it — the
  // recipe-owned kind is `addFromPlan`'s bookkeeping, not a preference (see
  // GroceryItem.quantityFromRecipe).
  i => (i.note.trim() ? `note:${i.note.trim()}` : ''),
  i => (i.quantity && !i.quantityFromRecipe ? `qty:${i.quantity}` : ''),
];

/**
 * The same facts as a comparable string, for asking "has anything been recorded
 * on this row *since* a moment I care about".
 *
 * `hasUserFacts` can't answer that on its own, and assuming it could was a bug:
 * an add writes facts of its own (a parsed "2 gal", a note typed into the add
 * field, a Brand chip), so a row that has only ever been added already answers
 * true. Undoing that add compared the predicate against nothing and concluded
 * the row was precious, leaving it behind. Compare two signatures instead —
 * `undoForAdds` takes one the instant the add lands and another when the undo
 * runs, and deletes only when they match.
 */
export function factSignature(item: GroceryItem, linked: ReadonlyMap<string, number>): string {
  const facts = FACT_READERS.map(read => read(item));
  return [...facts, `links:${linked.get(item.id) ?? 0}`].join(' ');
}
