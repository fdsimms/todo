import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { LeftoverFreshness } from '../types';
import { dayKeyToDate } from './dateUtils';

/**
 * The one clock the kitchen runs on.
 *
 * Four things in this app carry a day something has to be dealt with by — a
 * container in the fridge (`Leftover.keepUntil`) and a perishable in the
 * catalog (`GroceryItem.expiresAt`) are the two that actually count down — and
 * until #1670 each read its own day through its own ladder. They were already
 * word-for-word identical (`describeKeepUntil` and `describeExpiry` were the
 * same four lines twice), which is the usual sign that two features have one
 * question between them: a bag of spinach going off Thursday and a container
 * of chilli going off Thursday are the same fact to the cook.
 *
 * So the ladder lives here, once, and both call it. `LeftoverFreshness` keeps
 * its name — it's the type the fridge card's colours are already keyed on and
 * renaming it would be a rename across the whole leftovers feature for no
 * behaviour — but it is now the general answer, not the fridge's private one.
 *
 * Two rules carried over from `leftovers.ts`, where this started:
 *
 * - **Days are calendar days, never 24-hour blocks.** "Use by tomorrow" is
 *   what a person means on Wednesday about a Thursday, whether the container
 *   went in at 6pm or at midnight. That's the whole reason both fields are
 *   stored as `YYYY-MM-DD` day keys rather than instants.
 * - **Nothing reads the clock without being asked.** Every function takes
 *   `now`, so a test can stand in a kitchen on a Tuesday.
 *
 * Deliberately importing nothing but `dateUtils`: `leftovers.ts`,
 * `groceryShelfLife.ts` and `kitchenInventory.ts` all read *down* into this,
 * and a single edge back up would make the three a cycle.
 */

/**
 * Calendar days until `dayKey`. 0 means "today is the day", negative means
 * it's already past.
 */
export function daysUntilDay(dayKey: string, now: Date): number {
  return differenceInCalendarDays(dayKeyToDate(dayKey), now);
}

/**
 * Where a use-by day sits on the ladder.
 *
 * Four states rather than a boolean because the nudge has to arrive *before*
 * the waste, and "one day left" and "three days past" are not the same
 * message — see `LeftoverFreshness`, which this is the one producer of.
 */
export function freshnessFor(dayKey: string, now: Date): LeftoverFreshness {
  const left = daysUntilDay(dayKey, now);
  if (left < 0) return 'over';
  if (left === 0) return 'due';
  if (left === 1) return 'soon';
  return 'fresh';
}

/**
 * Most urgent first, for anything that has to *rank* the states rather than
 * merely label one — a screen can show everything, but a single row has one
 * line and has to pick what to name first (#1670).
 *
 * `over` leads: something already past its day is the one that has to be
 * eaten or binned tonight. That's also the order `sortLeftovers` has always
 * put the fridge card in, since sorting by the day itself produces exactly
 * this sequence.
 */
export const FRESHNESS_ORDER: readonly LeftoverFreshness[] = ['over', 'due', 'soon', 'fresh'];

/**
 * A sortable position for a state, with null — "nothing is counting down" —
 * last.
 *
 * Null is a real answer here and not a missing one: most of what's in a
 * kitchen has no use-by day at all, and a rice that never goes off must not
 * out-rank a spinach that does.
 */
export function freshnessRank(freshness: LeftoverFreshness | null): number {
  if (freshness === null) return FRESHNESS_ORDER.length;
  return FRESHNESS_ORDER.indexOf(freshness);
}

/**
 * Whether this is what a use-up nudge is for: down to its last day, or already
 * past it.
 *
 * The threshold includes `soon` deliberately — the point is to catch it
 * *before* it's wasted, and a nudge that only fires on the day itself has
 * already given up the evening someone could have planned around it. This is
 * the line `needsAttention` has always drawn; it's here now so the fridge and
 * the catalog can't come to disagree about where it is.
 */
export function isUseUpSoon(freshness: LeftoverFreshness | null): boolean {
  return freshness !== null && freshness !== 'fresh';
}

/**
 * A use-by day in words — "Use by today", "Use by tomorrow", "3 days left",
 * "2 days past".
 *
 * Deliberately its own small ladder rather than a reuse of dateUtils'
 * `formatDeadlineDate` family: those are written for a task's due date and
 * phrase a past one as overdue work. Food past its day isn't late, it's
 * questionable — and the wording has to leave room for the user to decide it's
 * still fine.
 */
export function describeUseBy(dayKey: string, now: Date = new Date()): string {
  const left = daysUntilDay(dayKey, now);
  if (left === 0) return 'Use by today';
  if (left === 1) return 'Use by tomorrow';
  if (left > 1) return `${left} days left`;
  const past = -left;
  return `${past} ${past === 1 ? 'day' : 'days'} past`;
}
