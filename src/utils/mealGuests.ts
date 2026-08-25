import type { MealPlanEntry, Person } from '../types';

/**
 * Who a planned meal is for — see `docs/arch/people.md` and
 * `MealPlanEntry.personIds`.
 *
 * The tie-in no other app can have, because no other app holds both halves:
 * once a meal knows who is coming, a dietary note about somebody has somewhere
 * to be useful, and somebody's own screen can say "dinner here on Thursday"
 * without anything having been ticked off yet.
 *
 * **Nothing here counts, ranks or scores anybody.** It resolves ids to names
 * and answers "which meals name this person". A guest list is a fact the user
 * typed about one evening, so there is no derivation of how often somebody
 * comes over, and adding one would be the disease the arch doc exists to
 * prevent.
 *
 * Pure, and takes the day key rather than reading the clock.
 */

/**
 * The guests a meal actually has, in the user's own People order.
 *
 * **Resolve-or-shrug**, exactly like `recipeId` and `leftoverId` on the same
 * row: a deleted person leaves their id behind (ids are never cleaned up — see
 * the arch doc) and this skips it rather than rendering a blank. The order is
 * `sortOrder`, which is the hand drag on the People screen and the only
 * ranking the feature is allowed to contain, never the order they were tapped
 * in.
 */
export function guestsOn(
  entry: Pick<MealPlanEntry, 'personIds'>,
  people: readonly Person[]
): Person[] {
  const wanted = new Set(entry.personIds);
  return people.filter(p => wanted.has(p.id)).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * "Ansley", "Ansley and Mom", "Ansley, Mom and Dustin", "Ansley and 3 others".
 *
 * Names rather than a count wherever they fit, because "3 guests" is the meal
 * plan reporting a number about your friends and the names are the thing that
 * actually helps. The count only appears past `maxNames`, where a row would
 * otherwise wrap — and even then the first name leads, so the row still says
 * something rather than only how many.
 */
export function describeGuests(guests: readonly Person[], maxNames = 3): string {
  const names = guests.map(p => p.nickname.trim() || p.name.trim()).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length <= maxNames) {
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  return `${names[0]} and ${names.length - 1} others`;
}

/** Whether anybody is named on this meal. */
export function hasGuests(entry: Pick<MealPlanEntry, 'personIds'>): boolean {
  return entry.personIds.length > 0;
}

/** One meal somebody is a guest at. */
export interface GuestMeal {
  entryId: string;
  title: string;
  /** The `YYYY-MM-DD` local day key the meal sits on. */
  date: string;
  slot: MealPlanEntry['slot'];
}

/**
 * The meals naming this person that haven't happened yet, soonest first.
 *
 * **Today counts as upcoming.** A meal's date is a day key rather than an
 * instant precisely so it isn't a moment (see `MealPlanEntry.date`), so
 * "tonight" has no time to be past, and a dinner dropping off somebody's screen
 * at some hour of the day it is on would be the app deciding the evening is
 * over.
 *
 * A cooked meal is left out: it happened, and what a cooked meal should write
 * into somebody's history is deliberately a separate question (#2078). Nothing
 * here writes history, and a "Coming up" section listing a dinner you already
 * made would be the one claim this module must not make.
 */
export function upcomingMealsWithGuest(
  entries: readonly MealPlanEntry[],
  personId: string,
  todayKey: string
): GuestMeal[] {
  return entries
    .filter(e => e.personIds.includes(personId) && !e.cookedAt && e.date >= todayKey)
    .map(e => ({ entryId: e.id, title: e.title, date: e.date, slot: e.slot }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
}
