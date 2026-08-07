/**
 * The order Today's category sections are laid out in, edited one step at a
 * time.
 *
 * This order used to be changed by dragging a section header inside the task
 * list itself; that's gone — the floating drag card could never be made to
 * track the finger there — and CategoryOrderSheet drives these two helpers
 * instead. They work on the plain name list `allCategories()` returns and
 * `reorderCategories()` takes, so nothing here needs to know about Category
 * rows or sortOrder.
 */

/**
 * Move `name` `delta` places through `order` (−1 up, +1 down).
 *
 * Returns the ORIGINAL array when the move can't happen — the name isn't in
 * the list, or it's already at the end it's being pushed towards — so a caller
 * can skip the store write (and the haptic) on an identity check.
 */
export function moveCategory(order: string[], name: string, delta: number): string[] {
  const from = order.indexOf(name);
  if (from < 0) return order;
  const to = from + delta;
  if (to < 0 || to >= order.length) return order;
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, name);
  return next;
}

/**
 * The same categories, A–Z.
 *
 * Sorted by the bare name rather than the display label: a label carries the
 * category's emoji in front (see categoryLabel), and sorting by that files
 * every emoji'd category together under whatever its glyph happens to sort as,
 * which reads as no order at all.
 */
export function alphabeticalCategories(order: string[]): string[] {
  return [...order].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
