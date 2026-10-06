/**
 * How many days usually pass between buying something, kept as a running
 * average of the gaps between purchases (`GroceryItem.purchaseIntervalDays`).
 *
 * This is the number behind `onHandWindowDays` in grocerySuggest.ts: how long
 * a purchase reads as still in the kitchen, and how long a "Got it" lasts. It
 * replaced `(now - createdAt) / purchaseCount`, which got two things wrong.
 * The row's age is not its purchase history: an item added from a recipe a
 * year before anyone bought it read as bought once every few months. And
 * dividing up to `now` made the figure grow on every day nothing was bought,
 * so the longer you went without buying something the longer the app assumed
 * you still had it.
 *
 * Kept apart from grocerySuggest.ts because `dbFinishGroceryShopping` needs it
 * and the db layer shouldn't pull in the whole suggestion module.
 */

const DAY_MS = 86_400_000;

/**
 * Gaps shorter than this are the same shop twice (a second trip the same day,
 * a list finished in two goes), not a measure of how long one lasts.
 */
export const MIN_PURCHASE_GAP_DAYS = 1;

/** How far each new gap moves the average: halfway, so it follows a change in habit within a few trips. */
const NEWEST_GAP_WEIGHT = 0.5;

/**
 * The most one gap can count for, as a multiple of the average so far. A
 * month away from home is not evidence that milk now lasts a month, and
 * without this one long gap would roughly double the window for the next
 * several trips.
 */
const MAX_GAP_MULTIPLE = 3;

/**
 * The average after a purchase at `purchasedAt`, given the row's previous
 * average and when it was last bought. Returns the previous value unchanged
 * when there's no gap to measure: a first purchase, a gap too short to count,
 * or a date that doesn't parse.
 */
export function nextPurchaseIntervalDays(
  previous: number | null,
  lastPurchasedAt: string | null,
  purchasedAt: string
): number | null {
  if (!lastPurchasedAt) return previous;
  const gap = (new Date(purchasedAt).getTime() - new Date(lastPurchasedAt).getTime()) / DAY_MS;
  if (Number.isNaN(gap) || gap < MIN_PURCHASE_GAP_DAYS) return previous;
  if (previous === null || !(previous > 0)) return gap;
  const counted = Math.min(gap, previous * MAX_GAP_MULTIPLE);
  return previous + (counted - previous) * NEWEST_GAP_WEIGHT;
}
