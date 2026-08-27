import type { GroceryItem, Task } from '../types';
import { generatedSourceOf, liveGeneratedTasksOfKind } from './generatedTasks';
import { OUT_OF_IT_UNTIL, pantryGuessLapsedDays, probablyHaveReason } from './grocerySuggest';
import { kitchenEntryId, kitchenLinkUrl } from './kitchenInventory';

/**
 * "Check if you still have X" — the pantry's answer to a guess going quiet.
 *
 * Nothing is ever taken *out* of the pantry, because there is no inventory to
 * take it out of: membership is `probablyHaveReason` recomputed on every read,
 * and an item leaves by that function starting to return null. Four things can
 * cause that and three of them are the user speaking — "Out of it", a thaw
 * emptying the freezer, a lapsed "Got it". The fourth is this one: the purchase
 * reading's window runs out and the row silently stops counting as on hand.
 *
 * That silence is deliberate everywhere else in the kitchen (see
 * `pantryGuessLapsedDays`), and it's also the one state change nobody can see.
 * The bag of flour is either still in the cupboard or it isn't, and the app has
 * just stopped having an opinion — so it offers to ask, once, the same way a
 * project going quiet offers a "Review X" row.
 *
 * **Modelled on `projectReviewTasks.ts`, not on the use-up generators**, and the
 * likeness is structural rather than cosmetic: both fire on time passing rather
 * than on a source mutation, so both run from the launch sequence and the Today
 * foreground sweep; both cap the rows they write; both clear a row whose reason
 * has gone; and both decline with a *stamp* rather than a permanent `false`,
 * because the same source earns the question again later.
 *
 * Where it deliberately differs, and why:
 *
 * - **The unit of "already answered" is the purchase, not the day.** A project
 *   stays quiet indefinitely, so `reviewDeclinedAt` lapses at the day boundary
 *   and the offer comes back tomorrow. A cupboard question that came back
 *   tomorrow would be nagging. `pantryCheckDeclinedAt` is spent against
 *   `lastPurchasedAt` instead: turned down after the last purchase means don't
 *   ask again until there's a new purchase to lapse.
 * - **Answering it isn't ticking it off.** The row links to the item's own
 *   sheet, where "Got it" and "Out of it" already live, and either of those
 *   makes the item stop wanting a check — so the task clears itself on the next
 *   sweep without the completion having to mean anything. Reading a tick as
 *   "yes I still have it" would be the app writing a claim the user didn't
 *   make, the same refusal `KitchenScreen` makes about closing a container out
 *   ("Eaten" / "Thrown out" is a two-way question, so it asks rather than
 *   guessing). A tick means only "I've dealt with this", which is why it counts
 *   as an answer here and writes nothing to the row.
 * - **Rows, not a stack.** Checking the cupboard arguably *is* one job with a
 *   tally, which is the meal-plan nudge's argument for its seven — but the
 *   common case here is one or two rows (the cap is three), and a stack header
 *   over a single row is a heading for nothing. Same call `projectReviewTasks`
 *   makes for the same reason.
 */

/**
 * Row-per-item ceiling. Three, like `MAX_PROJECT_REVIEW_TASKS`, and for the
 * blunter reason: a catalog is hundreds of rows and their windows lapse
 * whenever they lapse, so a generator with no ceiling would answer a quiet week
 * with a screenful of questions about the cupboard.
 *
 * Deliberately its own cap rather than a draw on `useUpTaskCap` (see
 * `isUseUpKind`). That ceiling exists because two *expiry clocks* flood one
 * surface between them; this generator's flooding is bounded by its own gates
 * — three purchases, a live lapse, one question per purchase — and folding the
 * two would mean a fridge full of spinach could silence the cupboard.
 */
export const MAX_PANTRY_CHECK_TASKS = 3;

/**
 * How stale a lapse can be and still be worth asking about.
 *
 * Without it the qualifying set is "every row whose window has run out", which
 * on the day this ships is most of the catalog — every item bought three times
 * and not since, back to the first trip ever recorded. The cap would meter that
 * out three at a time and never reach the end of it, so the feature would read
 * as an endless drip of questions about food from two years ago rather than as
 * a thing that notices when a guess runs out.
 *
 * A lapse is an event, so this is what makes it one: a fortnight after the
 * window closes, the moment has passed and the row goes quiet for good (until
 * it's bought again). It bounds *creation* only — see `stalePantryCheckTasks`
 * for why a task already written outlives its own grace period.
 */
export const PANTRY_CHECK_GRACE_DAYS = 14;

/**
 * The row's title.
 *
 * Names the verb and the doubt together, like `projectReviewTitle` and for the
 * same reason: "Flour" on the widget, in Search or in the Logbook is a task to
 * buy flour, which is the one thing this isn't — it's a question about what's
 * already in the cupboard, and the answer may well be "yes, nothing to do".
 * Spelled out rather than clipped to "Check flour", which reads as an
 * instruction to inspect the flour itself.
 */
export function pantryCheckTitle(item: Pick<GroceryItem, 'name'>): string {
  return `Check if you still have ${item.name}`;
}

/**
 * The grocery item a pantry check speaks for, or null for any other task.
 *
 * `generatedSourceOf` under a name that says what the string means here — one
 * column holds six generators' source ids now, and a project id read as an item
 * id would open a sheet on nothing.
 */
export function pantryCheckItemId(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): string | null {
  return generatedSourceOf(task, 'pantryCheck');
}

/**
 * Where the row goes: this item's own sheet, opened on the Pantry pills.
 *
 * The same `kitchenLinkUrl` the two use-up generators carry, because it's the
 * same instruction ("take me to that one thing") and `KitchenScreen` already
 * answers it by opening `GroceryItemSheet` with `initialField="pantry"` — which
 * is exactly the pair of pills this task is asking about. The item is by
 * definition *not* in the pantry list while a check is live, so the screen
 * falls back to opening the sheet by id; see its focus effect.
 */
export function pantryCheckLinkUrl(itemId: string): string {
  return kitchenLinkUrl(kitchenEntryId('grocery', itemId));
}

/**
 * Whether this item's purchase reading has run out with nothing else answering
 * for it — the lapse in days, or null.
 *
 * The gates, in the order they rule things out:
 *
 * 1. **Something else already answers.** A non-null `probablyHaveReason` is the
 *    app having an opinion — a staple, a live "Got it", the freezer, running
 *    low, or a purchase still inside its window — and there is nothing to ask.
 * 2. **An explicit "Out of it" is an answer too**, and the one that
 *    `probablyHaveReason` reports as null. Asking "still got this?" of someone
 *    who just told you they haven't is the app not listening.
 * 3. **A row on the list is being restocked.** The question is moot the moment
 *    it's in the trolley, and `finishShopping` will re-date the row anyway.
 * 4. **The lapse itself**, with its own purchase-history gate — see
 *    `pantryGuessLapsedDays`.
 *
 * Deliberately *not* gated on the grace window: this is the predicate a live
 * task is judged against as well as a new one. See `stalePantryCheckTasks`.
 */
export function pantryCheckLapse(
  item: GroceryItem,
  now: Date,
  /**
   * The ids in *any* trolley (`listedAnywhere` in `groceryLists.ts`).
   *
   * The broad reading is the right one here: asking "do you still have olive
   * oil?" about something already on the Airbnb list is asking about shopping
   * the user is on their way to do. Null falls back to `item.onList`, which
   * answers for the home list alone (see `GroceryItem.onList`) — the behaviour
   * this had before lists existed.
   */
  listed: ReadonlySet<string> | null = null
): number | null {
  if (probablyHaveReason(item, now) !== null) return null;
  if (item.onHandUntil === OUT_OF_IT_UNTIL) return null;
  if (listed ? listed.has(item.id) : item.onList) return null;
  return pantryGuessLapsedDays(item, now);
}

/**
 * When each item was last asked about and answered, by item id.
 *
 * Derived from the task rows rather than written anywhere, the way
 * `projectsReviewedToday` is, and for the same reason: the rows already say it.
 * A completed check is an answer ("I've dealt with this"), and so is an
 * archived one — this app's other explicit "dealt with", and the blind spot
 * `liveGeneratedTasksOfKind` would otherwise leave, since neither leaves a live
 * task for the next sweep to find.
 *
 * The stamp is what gets compared against `lastPurchasedAt`, so the latest one
 * wins where an item has been asked more than once.
 */
export function pantryCheckAnswers(
  tasks: readonly Pick<
    Task,
    'generatedKind' | 'generatedSourceId' | 'completed' | 'completedAt' | 'archived' | 'archivedAt'
  >[]
): Map<string, string> {
  const answers = new Map<string, string>();
  for (const task of tasks) {
    const itemId = pantryCheckItemId(task);
    if (!itemId) continue;
    const at =
      (task.completed ? task.completedAt : null) ?? (task.archived ? task.archivedAt : null);
    if (!at) continue;
    const seen = answers.get(itemId);
    if (!seen || at > seen) answers.set(itemId, at);
  }
  return answers;
}

/**
 * Whether the user has already had their say about this item since the last
 * time it was bought — a swipe (`pantryCheckDeclinedAt`) or a tick/archive
 * (`answeredAt`, from `pantryCheckAnswers`).
 *
 * ISO strings compared as strings, which the app does everywhere it compares
 * two of these (`projectQuietDays`, the roster's completion sort): they're all
 * `toISOString()` output, so they're fixed-width UTC and sort as instants.
 *
 * A row with no purchase on record can't reach here — `pantryGuessLapsedDays`
 * requires one — so a missing `lastPurchasedAt` reads as "not answered" rather
 * than needing a rule of its own.
 */
function answeredSincePurchase(item: GroceryItem, answeredAt: string | undefined): boolean {
  const last = item.lastPurchasedAt;
  if (!last) return false;
  if (item.pantryCheckDeclinedAt && item.pantryCheckDeclinedAt > last) return true;
  return !!answeredAt && answeredAt > last;
}

/** One item that should have a check sitting on today's list. */
export interface PantryCheckWant {
  itemId: string;
  title: string;
  /** How long ago the purchase reading ran out, for ordering under the cap. */
  lapsedDays: number;
}

/**
 * Which items should have a check right now, freshest lapse first.
 *
 * **Freshest, not oldest**, which is the opposite of how `wantedProjectReviews`
 * ranks its stalls — a project that has been quiet longest is the most overdue,
 * whereas a window that ran out this morning is the live question and one that
 * ran out twelve days ago is nearly out of grace. Ties break on name, the
 * tiebreak `compareKitchenEntries` and `pantryEntries` already use, so a
 * capped-out day is at least stable between sweeps.
 */
export function wantedPantryChecks(
  items: readonly GroceryItem[],
  tasks: readonly Pick<
    Task,
    'generatedKind' | 'generatedSourceId' | 'completed' | 'completedAt' | 'archived' | 'archivedAt'
  >[],
  now: Date,
  cap: number = MAX_PANTRY_CHECK_TASKS,
  /** The ids in any trolley — see `pantryCheckLapse`. */
  listed: ReadonlySet<string> | null = null
): PantryCheckWant[] {
  const answers = pantryCheckAnswers(tasks);
  const wants: { item: GroceryItem; lapsedDays: number }[] = [];
  for (const item of items) {
    const lapsedDays = pantryCheckLapse(item, now, listed);
    if (lapsedDays === null || lapsedDays > PANTRY_CHECK_GRACE_DAYS) continue;
    if (answeredSincePurchase(item, answers.get(item.id))) continue;
    wants.push({ item, lapsedDays });
  }
  return wants
    .sort((a, b) => a.lapsedDays - b.lapsedDays || a.item.name.localeCompare(b.item.name))
    .slice(0, Math.max(0, cap))
    .map(({ item, lapsedDays }) => ({
      itemId: item.id,
      title: pantryCheckTitle(item),
      lapsedDays,
    }));
}

/**
 * The checks sitting there whose reason has gone.
 *
 * **This is why the check runs on a sweep** rather than only when something
 * changes: an item stops wanting one the moment it's answered, restocked or put
 * on the list — including by the user acting on this very row — and none of
 * those mutations knows a task is sitting on Today asking the old question.
 * "Check if you still have flour" left over after you tapped "Out of it" is a
 * chore about nothing.
 *
 * **Judged on `pantryCheckLapse` alone**, so neither the cap nor the grace
 * window can delete a row that's already been written. The cap decides who
 * claims a scarce slot, and losing that contest is no reason to take away a
 * task the user has deferred to Saturday; the grace decides whether a lapse is
 * still fresh enough to *raise*, and a question already asked doesn't expire
 * just because the user hasn't got to it within a fortnight. Same split
 * `staleProjectReviewTasks` makes against `wantedProjectReviews`.
 *
 * An item that has been deleted outright leaves a task pointing at nothing,
 * which is stale by the same reading — the lookup simply misses.
 */
export function stalePantryCheckTasks<
  T extends Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>
>(
  tasks: readonly T[],
  items: readonly GroceryItem[],
  now: Date,
  /** The ids in any trolley — see `pantryCheckLapse`. */
  listed: ReadonlySet<string> | null = null
): T[] {
  const byId = new Map(items.map(item => [item.id, item]));
  return liveGeneratedTasksOfKind(tasks, 'pantryCheck').filter(task => {
    const itemId = pantryCheckItemId(task);
    const item = itemId ? byId.get(itemId) : undefined;
    return !item || pantryCheckLapse(item, now, listed) === null;
  });
}
