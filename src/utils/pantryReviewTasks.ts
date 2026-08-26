import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Task } from '../types';
import { dayKeyToDate } from './dateUtils';
import { generatedSourceOf, liveGeneratedTasksOfKind } from './generatedTasks';
import { KITCHEN_LINK_URL } from './kitchenInventory';
import type { PantryReviewDeck } from './pantryReview';

/**
 * "Review what's in the pantry" — the offer to open the swipe deck.
 *
 * **Structurally this is `calendarReview`, one shelf over, not `pantryCheck`.**
 * Its source is a day key rather than a row (there is no single item this is
 * about), so there is no per-source qualifying predicate, no capped set, and
 * nothing a stamp could live on: the "don't hand it straight back" is a
 * settings-level mark, `pantryReviewLastDayKey`, exactly the position the
 * meal-plan nudge and the calendar review are already in.
 *
 * **Why it isn't just more `pantryCheck` rows.** That generator drips up to
 * three "Check if you still have X" rows and is the right shape for one or two
 * doubtful items: the row names the thing, and one tap on the item sheet
 * answers it. It is the wrong shape for eleven, which is a screenful of
 * near-identical questions about the cupboard — the flooding
 * `MAX_PANTRY_CHECK_TASKS` exists to prevent, arriving three at a time instead
 * of all at once. Past `MIN_PANTRY_REVIEW_CARDS` the honest offer is one row
 * that opens one pass. So the two generators divide on the size of the doubt,
 * and `checkPantryReviewTasks` suppresses the drip while a review row is live
 * (see that action) rather than letting the user be asked both ways at once.
 */

/**
 * The row's title. Never varies — there is exactly one question this asks, and
 * a count in it would be a number that goes stale as the deck does.
 *
 * Names the verb and the subject together, like `CALENDAR_REVIEW_TITLE` and for
 * the same reason: this row shows up on the widget, in Search and in the
 * Logbook, none of which render a meta line, so "Pantry" alone would read as a
 * task to go and do something to the pantry.
 */
export const PANTRY_REVIEW_TITLE = 'Review what\'s in the pantry';

/**
 * Where the row goes: the Pantry screen, with the deck already open.
 *
 * A query on the kitchen link rather than a scheme of its own, the same shape
 * `dundundun://groceries?finish=1` uses for the trip's own "there's a question
 * waiting here" — the destination is a screen this app already routes to, and
 * what's different is only which sheet it arrives with.
 */
export const PANTRY_REVIEW_LINK_URL = `${KITCHEN_LINK_URL}?review=1`;

/**
 * How many doubtful rows it takes before one review row beats the drip.
 *
 * Below this, `pantryCheck`'s per-item rows say more: they name the thing, and
 * the answer is one tap rather than a session. Five is where a list of names
 * stops being a list and starts being a chore with a tally — the same judgement
 * `MAX_PANTRY_CHECK_TASKS` makes from the other side when it refuses to write a
 * fourth row.
 */
export const MIN_PANTRY_REVIEW_CARDS = 5;

/**
 * How often the offer can come round, in days.
 *
 * A cupboard question that returned tomorrow would be nagging — the same
 * finding `pantryCheckDeclinedAt` is built on, which is why that one spends
 * itself against a purchase rather than against the day boundary
 * `reviewDeclinedAt` uses. There is no purchase to spend this against (it is
 * about the whole catalog, not one row), so it is a plain cadence, and a
 * fortnight is the same window `pantryGuessLapsedDays` measures a lapse in:
 * long enough that a deck refused once has genuinely changed before it is
 * offered again.
 */
export const PANTRY_REVIEW_CADENCE_DAYS = 14;

/**
 * The day key a review task was raised on, or null for any other task.
 *
 * Thin, like `calendarReviewDayKey`/`pantryCheckItemId` — a named wrapper over
 * `generatedSourceOf` for the one meaning this column has here.
 */
export function pantryReviewDayKey(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): string | null {
  return generatedSourceOf(task, 'pantryReview');
}

/**
 * Whether enough time has passed since the last offer to make another one.
 *
 * A null mark is an install that has never been asked, which qualifies. An
 * unparseable one is treated the same way rather than blocking for ever: the
 * mark is a convenience, and the worst a bad value can do here is cost one
 * offer.
 */
export function pantryReviewCadenceElapsed(
  lastDayKey: string | null,
  today: Date,
  cadenceDays: number = PANTRY_REVIEW_CADENCE_DAYS
): boolean {
  if (!lastDayKey) return true;
  const last = dayKeyToDate(lastDayKey);
  if (Number.isNaN(last.getTime())) return true;
  return differenceInCalendarDays(today, last) >= cadenceDays;
}

/**
 * Whether the cupboard is doubtful enough to be worth one row.
 *
 * Reads the deck rather than rebuilding the predicate, so the offer can never
 * promise a pass the deck would open empty.
 */
export function wantsPantryReview(deck: PantryReviewDeck): boolean {
  return deck.cards.length >= MIN_PANTRY_REVIEW_CARDS;
}

/**
 * Live review rows whose question has gone.
 *
 * **Judged on the deck being empty, not on `wantsPantryReview`.** That
 * threshold decides whether to *raise* an offer; a row already raised and
 * deferred to Saturday is not deleted because the user answered enough cards to
 * put the deck under five — that would be the app taking back a question the
 * moment it started being answered. The same split `stalePantryCheckTasks`
 * draws against `PANTRY_CHECK_GRACE_DAYS`, and `staleProjectReviewTasks`
 * against its own cap.
 */
export function stalePantryReviewTasks<
  T extends Pick<Task, 'generatedKind' | 'completed' | 'archived'>
>(tasks: readonly T[], deck: PantryReviewDeck): T[] {
  if (deck.cards.length > 0) return [];
  return liveGeneratedTasksOfKind(tasks, 'pantryReview');
}
