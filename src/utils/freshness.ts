import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
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
 * The freezer lives here too, for the same reason the ladder does — see
 * `liveUseBy` at the bottom. Both halves can be frozen, so "is anything
 * actually counting down" has to be one function or the two will drift.
 *
 * Deliberately importing nothing but `dateUtils` and `date-fns`:
 * `leftovers.ts`, `groceryShelfLife.ts` and `kitchenInventory.ts` all read
 * *down* into this, and a single edge back up would make the three a cycle.
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

/**
 * The use-by day that's actually counting down, or null because nothing is.
 *
 * **The one place the freezer rule lives**, and the reason it lives here: both
 * halves of the kitchen carry a day (`GroceryItem.expiresAt`,
 * `Leftover.keepUntil`) and both can go in the freezer, so a second copy of
 * this test is how a bag of spinach and a container of chilli would come to
 * disagree about the same fact — exactly what #1670 merged this module to
 * prevent.
 *
 * **Frozen suspends the clock; it doesn't delete it.** The stored day is left
 * alone rather than cleared, because the thing that ends a freeze is a *thaw*,
 * and a thaw restarts the count from a fresh shelf life (see
 * `useGroceryStore.setFrozen` / `useLeftoverStore.setFrozen`). Clearing on the
 * way in would leave nothing to put back on the way out, and stamping the new
 * day at freeze time would be asserting a thaw date the user hasn't chosen —
 * food can sit in a freezer for a month or for a year.
 *
 * So every reader of a countdown reads it through here, and a stale day behind
 * a live `frozenAt` is never visible to one.
 */
export function liveUseBy(useBy: string | null, frozenAt: string | null): string | null {
  return frozenAt ? null : useBy;
}

/**
 * "Frozen 12 Jul" — what a frozen row says in the slot a countdown would
 * otherwise fill.
 *
 * The clock half only. The *reason* half ("in the freezer") is
 * `types.FROZEN_REASON`, and the two are paired by whatever draws the row, the
 * same way "bought 6× · last on 12 Jul" is paired with "Use by today". Split
 * because a kitchen row renders them in different colours: the reason is grey
 * and the clock clause carries the freshness tint.
 *
 * A date rather than an elapsed count ("3 weeks in the freezer"), which is the
 * opposite call `describeAge` makes for the fridge, and deliberately: a
 * container in the fridge is measured in days because days are what it has
 * left, while a freezer is measured in months and the useful fact is *which
 * shop it came home from*. Same reasoning as `lastPricedAt` rendering "(March)"
 * rather than an age.
 */
/**
 * "opened 12 Aug" — the clause a pantry row adds once a jar has been opened.
 *
 * Lower case and dateful, because it lands beside `probablyHaveReason`'s own
 * lower-case clauses ("bought 4× · last on 19 Aug · opened 12 Aug") rather than
 * in the tinted clock slot `describeFrozenSince` fills. Opening doesn't stop
 * the clock, so it doesn't take that slot; it's one more piece of evidence
 * about the thing in the fridge.
 */
export function describeOpenedOn(openedAt: string, now: Date = new Date()): string {
  const then = new Date(openedAt);
  // Same two unusable-stamp cases `describeFrozenSince` guards, same answer:
  // drop the date, keep the true half.
  if (Number.isNaN(then.getTime()) || then.getTime() > now.getTime()) return 'opened';
  return `opened ${format(then, 'd MMM')}`;
}

export function describeFrozenSince(frozenAt: string, now: Date = new Date()): string {
  const then = new Date(frozenAt);
  // "Frozen" alone for the two cases a date would be a lie: an unparseable
  // stamp from a restored backup, and one in the future because the device's
  // clock has been moved back. Both still say the true half.
  if (Number.isNaN(then.getTime()) || then.getTime() > now.getTime()) return 'Frozen';
  return `Frozen ${format(then, 'd MMM')}`;
}
