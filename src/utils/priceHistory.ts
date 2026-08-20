import type { PriceObservation } from '../types';
import { measureQuantity } from './unitConvert';

/**
 * A short run of what something has cost, and the one number worth deriving
 * from it.
 *
 * **This is the bounded answer to "a price is an observation, never a ledger".**
 * That rule was written for a world where every price was typed by hand, and it
 * rested on two arguments: nobody maintains a price book, and logs grow without
 * end. Receipt scanning retires the first — the numbers now arrive as a side
 * effect of a shop you were doing anyway — so what's left is the second, and a
 * rolling window of `PRICE_HISTORY_LIMIT` answers it by construction. The row
 * count never moves; the row just carries a little more. Same shape
 * `grocery_item_shops` already argued for.
 *
 * **What it is for is a baseline, not a chart.** A single last price is a poor
 * thing to measure against: if last week was a sale then a perfectly ordinary
 * price this week reads as a jump, which is exactly the false alarm the
 * receipt's own price check would otherwise raise. A median over a handful is a
 * far better outlier detector, and outlier detection is the whole use.
 *
 * **Quantities are the hard part and the reason most of this file is refusals.**
 * "$4.99" and "$9.98" is a doubling or it is the same product in a pack twice
 * the size, and nothing but the quantity tells them apart. So a run at mixed
 * sizes is normalized onto one basis before anything is computed, and refused
 * whole when it can't be — the all-or-nothing rule `unitPricesFor` follows, for
 * its reason: a median that quietly dropped the observations it couldn't read
 * would be worse than no median, because nothing downstream could tell.
 */

/**
 * How many observations are kept per item and per store.
 *
 * Twelve is about a season of a weekly staple — long enough that one sale can't
 * drag the median, short enough that it stays recent without anyone choosing a
 * date window. Sizing it in *observations* rather than in days is what keeps it
 * bounded: a thing bought twice a year keeps twelve prices and costs nothing.
 */
export const PRICE_HISTORY_LIMIT = 12;

/**
 * Reads the stored JSON, dropping anything malformed rather than throwing.
 *
 * Resolve-or-shrug, like every other stored blob here: a history that can't be
 * read is a baseline nobody gets, not a screen that won't load.
 */
export function parsePriceHistory(raw: string | null | undefined): PriceObservation[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((o): o is PriceObservation =>
        !!o
        && typeof o.minor === 'number'
        && Number.isFinite(o.minor)
        && o.minor > 0
        && typeof o.at === 'string'
        && (o.quantity === null || typeof o.quantity === 'string'))
      .slice(0, PRICE_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/**
 * Adds one observation to the front and drops anything past the cap.
 *
 * Newest first so the cap is a plain `slice` and the most recent — the basis
 * everything else is normalized onto — is always `[0]`.
 */
export function appendPriceObservation(
  history: readonly PriceObservation[],
  observation: PriceObservation,
): PriceObservation[] {
  return [observation, ...history].slice(0, PRICE_HISTORY_LIMIT);
}

/**
 * What this usually costs, expressed against the most recent observation's own
 * quantity — or null when the run can't be read as one measurement.
 *
 * The newest is the basis because it's the size you're most likely buying now,
 * so the number comes back in terms a caller can compare against today's price
 * without converting anything itself. That also makes the return shape identical
 * to `lastPricedAmountFor`'s, which is what lets a caller swap one for the other.
 *
 * Refusals, all of them deliberate:
 * - an empty run has no baseline;
 * - a run mixing a qualified price with a bare one can't be reconciled, since
 *   nothing says whether the bare one was for the same amount;
 * - a run spanning two dimensions (grams and litres) isn't one measurement.
 *
 * A run whose quantities all read the same needs no measuring at all, which is
 * both the common case and the one that keeps "a bunch" — unmeasurable, but
 * consistently so — from being refused for no reason.
 */
export function priceBaseline(
  history: readonly PriceObservation[],
): { minor: number; quantity: string | null } | null {
  if (history.length === 0) return null;
  const basis = history[0];
  if (history.length === 1) return { minor: basis.minor, quantity: basis.quantity };

  const key = (q: string | null) => (q ?? '').trim().toLowerCase();
  // Every observation named the same amount (or none named one): the prices are
  // already comparable, whether or not anything could measure them.
  if (history.every(o => key(o.quantity) === key(basis.quantity))) {
    return { minor: median(history.map(o => o.minor)), quantity: basis.quantity };
  }

  const basisMeasure = measureQuantity(basis.quantity ?? '');
  if (!basisMeasure) return null;

  const rebased: number[] = [];
  for (const observation of history) {
    const measure = measureQuantity(observation.quantity ?? '');
    if (!measure || measure.dimension !== basisMeasure.dimension) return null;
    // What this observation would have cost at the basis size.
    rebased.push(observation.minor * (basisMeasure.base / measure.base));
  }
  return { minor: median(rebased), quantity: basis.quantity };
}

/**
 * The middle value, averaging the two middle ones on an even count.
 *
 * A median rather than a mean because the thing being defended against is a
 * single wild value — a mis-scanned line, a bulk buy — and a mean is exactly
 * what such a value moves.
 */
function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value);
}

/**
 * Two runs into one, newest first and capped — what merging two catalog rows
 * (or their per-store links) does to their prices.
 *
 * Both sides are real observations of the same thing, so neither is dropped in
 * favour of the other; the cap then keeps whichever are most recent, which is
 * the same rule a single row's own appends follow. Sorted by `at` rather than
 * trusting either input's order, since two independently-capped runs interleave.
 */
export function mergePriceHistories(
  a: readonly PriceObservation[],
  b: readonly PriceObservation[],
): PriceObservation[] {
  return [...a, ...b]
    .sort((x, y) => y.at.localeCompare(x.at))
    .slice(0, PRICE_HISTORY_LIMIT);
}
