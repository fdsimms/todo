/**
 * How many of a thing are in the kitchen — the "two jars of mayo, and one of
 * them is a different brand" half of the pantry.
 *
 * The count lives in two buckets and this module is the only place they are
 * added up. `GroceryItem.onHandCount` holds the units with no brand recorded;
 * each `ItemProduct.onHandCount` holds the units of that one box. Every jar is
 * in exactly one bucket, so the total is derived and there is no stored copy of
 * it to drift — the failure the `ItemShopLink` counters document as permanent
 * ("never sum links to get a total") is unreachable here because there is
 * nothing to sum *against*.
 *
 * Read the total through `onHandCountFor` and never off a raw field, the same
 * discipline `estimatedMinutesFor` imposes for a chain step's estimate and for
 * the same reason: the raw number is one bucket, and a caller that reads it as
 * the answer is wrong exactly when the feature is being used.
 *
 * **What this deliberately is not.** It is a number, not a per-unit row. A jar
 * has no identity here, so it carries no opened/frozen/use-by of its own —
 * those stay one clock on the item, and a sealed backup is not tracked as
 * fresher than the open one. That was the explicit trade when counts were
 * added (see docs/arch/groceries.md): the count answers "do I have a spare, and
 * of what", and stops there. A row per jar is the maintained inventory the rest
 * of that file spends its length ruling out.
 */

import type { GroceryItem, ItemProduct } from '../types';

/**
 * The stepper's floor is 1, not 0, so a count is only ever a statement that you
 * *have* some. "I have none" is what the "Out of it" pill and the Pantry row's
 * ✕ already write, and a count of 0 saying the same thing is a second bit to
 * keep in step with the first — the same reason `runningLowAt` is its own
 * column rather than a third sentinel on `onHandUntil`.
 *
 * With `allowNull`, − at the floor clears back to "never counted", so the
 * stepper spans exactly the states that mean something: null, then 1 upward.
 */
export const PANTRY_COUNT_MIN = 1;
/**
 * High enough never to be met by a pantry (a flat of eggs, a case of seltzer)
 * and low enough that a held key can't run somewhere absurd. `CountStepper`
 * reserves width for two digits, so this is also what fits without the keys
 * shifting.
 */
export const PANTRY_COUNT_MAX = 99;

/** A stored count that actually says something: a positive whole number. */
function counted(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  // Zero and below read as "nothing counted" rather than as an assertion of
  // absence — see GroceryItem.onHandCount. Only old or synced rows can hold
  // one, and treating it as a claim would make it outrank the purchase reading
  // while saying nothing a user ever typed.
  return value > 0 ? Math.floor(value) : 0;
}

/** The products of one item, tolerating a caller that hands over the whole set. */
export function productsWithCount(
  item: GroceryItem,
  products: readonly ItemProduct[],
): ItemProduct[] {
  return products.filter(p => p.itemId === item.id && counted(p.onHandCount) > 0);
}

/**
 * How many of this are in the kitchen, across both buckets — or null when
 * nothing has been counted, which is the state nearly every row is in and is
 * *ignorance rather than absence*, exactly as `probablyHaveReason` returning
 * null is. A caller must not read null as zero.
 */
export function onHandCountFor(
  item: GroceryItem,
  products: readonly ItemProduct[],
): number | null {
  let total = counted(item.onHandCount);
  for (const product of products) {
    if (product.itemId !== item.id) continue;
    total += counted(product.onHandCount);
  }
  return total > 0 ? total : null;
}

/**
 * "2 on hand". Borrows `probablyHaveReason`'s own words for the state rather
 * than inventing a second phrase for it — that function already says "marked as
 * on hand", and this is the same claim carrying a number.
 */
export function describeOnHandCount(count: number): string {
  return `${count} on hand`;
}

/**
 * "2 on hand · Hellmann's, store brand" — the count with the boxes it's made
 * of, for the one surface with room to name them.
 *
 * Unattributed units are deliberately not spelled out as a third clause ("and 1
 * other"): the count in front already covers them, and the names are here to
 * answer "which ones", not to be reconciled against the number by the reader.
 */
export function describeOnHandBreakdown(
  item: GroceryItem,
  products: readonly ItemProduct[],
  describe: (product: ItemProduct) => string | null,
): string {
  const count = onHandCountFor(item, products);
  if (count === null) return '';
  const names = productsWithCount(item, products)
    .map(describe)
    .filter((name): name is string => !!name);
  const head = describeOnHandCount(count);
  return names.length > 0 ? `${head} · ${names.join(', ')}` : head;
}
