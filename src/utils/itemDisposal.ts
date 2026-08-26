import { format } from 'date-fns/format';
import type { GroceryItem } from '../types';

/**
 * How a thing left the pantry: you finished it, or it went bad.
 *
 * **The fact the pantry half was throwing away.** The fridge has recorded this
 * since leftovers shipped — `LeftoverOutcome` is 'eaten' | 'tossed', captured
 * by `LeftoverSheet`'s two buttons and read back by `describeFridgeHistory` —
 * while a catalog row's "Out of it" was one bit. The asymmetry used to be at
 * its most visible in `UseUpResolveSheet`: completing "Use up spinach" opened
 * the item's whole editor with nothing on screen actually asking the
 * question, while completing "Use up leftover chili" opened LeftoverSheet's
 * own Finished it/Threw it out. Both now ask directly — see that component's
 * doc comment.
 *
 * **This is not a shelf-life estimator, and the difference matters.** The
 * obvious reason to want it is to learn how long things really keep, and that
 * is the one thing these answers can't support. Both are given when the user
 * *notices* rather than when the food turned: the bag of spinach found in the
 * drawer on Sunday is recorded at twelve days when it went at five, and a
 * "used it up" is a lower bound with a consumption rate mixed into it. The lag
 * is routinely larger than the numbers being estimated (`SHELF_LIFE_LEXICON`
 * runs 2 to 7 days for everything that matters), and it biases both readings
 * the same way — *later* — which is the direction that gets a use-up task
 * arriving after the food is already slime. `groceryShelfLife.ts` keeps its
 * numbers at the cautious end on purpose; a learner fed only late observations
 * would walk them the other way.
 *
 * So nothing here is arithmetic on a date. `GroceryItem.shelfLifeDays` stays
 * the correction, made by a person holding the thing, and what these counts do
 * is tell that person when it's worth making one — see
 * `wantsShelfLifePrompt`. Evidence, not an estimate.
 */
export type DisposalOutcome = 'usedUp' | 'spoiled';

/**
 * How many times something has to have gone bad before the app says anything
 * about it.
 *
 * Two, because one is an accident and the app has nothing to add to it —
 * everybody loses a bag of salad now and again, and a prompt on the first one
 * is the app grading a week it wasn't asked to grade. Twice is a pattern the
 * user can act on, and the action is concrete: shorten what this keeps for, so
 * the reminder arrives earlier next time.
 */
export const REPEAT_WASTE_THRESHOLD = 2;

/** How many times the user has answered for this item at all. */
export function disposalAnswerCount(item: Pick<GroceryItem, 'usedUpCount' | 'spoiledCount'>): number {
  return item.usedUpCount + item.spoiledCount;
}

/**
 * "Went bad 2 of 3 times, last on Aug 12" — what the record says, or empty
 * when it has nothing to say.
 *
 * **Only the spoiled side is ever named.** "Used it up 5 of 5 times" is not
 * evidence about how long something keeps, and a line congratulating the user
 * on eating their food is exactly the editorialising `describeOutcome` refuses
 * when it picks "Thrown out" over "Wasted". Silence is the answer for a clean
 * record, the same way `describeFridgeHistory` returns '' for an empty one.
 *
 * **Dated, because a bare count ages badly.** `lastPricedAt`'s argument: "$3.19"
 * from eighteen months back is the UI lying, and so is "went bad 3 times" about
 * a habit the user fixed a year ago. Nothing decays the counts, so the date is
 * what lets someone weigh them.
 */
export function describeDisposalHistory(
  item: Pick<GroceryItem, 'usedUpCount' | 'spoiledCount' | 'lastSpoiledAt'>,
  now: Date = new Date()
): string {
  if (item.spoiledCount === 0) return '';
  const answered = disposalAnswerCount(item);
  const times = `${item.spoiledCount} of ${answered} ${answered === 1 ? 'time' : 'times'}`;
  if (!item.lastSpoiledAt) return `Went bad ${times}.`;
  const then = new Date(item.lastSpoiledAt);
  // The two unusable-stamp cases describeFrozenSince guards, same answer: drop
  // the date and keep the true half.
  if (Number.isNaN(then.getTime()) || then.getTime() > now.getTime()) return `Went bad ${times}.`;
  return `Went bad ${times}, last on ${format(then, 'MMM d')}.`;
}

/**
 * Whether recording this answer is the moment to offer the shelf-life stepper.
 *
 * **Evaluated on the item as it stands after the answer is written**, not
 * rendered off a row at rest: it's a reaction to a thing the user just said, so
 * it needs no dismissal stamp and can't sit on a screen going stale. Ignoring
 * it costs nothing and the offer comes back the next time something goes bad,
 * which is the right cadence for a prompt whose whole trigger is the user
 * telling the app the food didn't last.
 *
 * It keeps firing above the threshold rather than only landing exactly on it.
 * Firing once at two and never again would mean an offer waved away in a hurry
 * is an offer never made, and the thing it's asking about is by then more true
 * rather than less.
 */
export function wantsShelfLifePrompt(item: Pick<GroceryItem, 'spoiledCount'>): boolean {
  return item.spoiledCount >= REPEAT_WASTE_THRESHOLD;
}
