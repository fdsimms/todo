import { format } from 'date-fns/format';
import { MEAL_SHORTFALL_LEAD_DAYS_DEFAULT, type GroceryItem, type ItemSubLink, type MealPlanEntry, type Recipe, type Task } from '../types';
import { dayKeyToDate } from './dateUtils';
import { generatedSourceOf, liveGeneratedTasksOfKind } from './generatedTasks';
import { shiftDayKey, slotRank } from './mealPlan';
import { mealPlanNudgeLinkUrl } from './mealPlanNudge';
import { classifyPlanned, plannedIngredientsForRecipe, type ClassifiedIngredient } from './mealPlanGroceries';
import type { StandingSwapMap } from './standingSwaps';

/**
 * "Shop for Tue ragù" — the meal plan's answer to being blindsided on the night.
 *
 * You can plan a week without owning a thing it calls for. Nothing in the app
 * said so until you opened the meal plan and tapped the cart yourself, which is
 * a flow you have to *remember* on a day you have no reason to be thinking
 * about Thursday. The ingredients were always knowable — `mealPlanGroceries.ts`
 * has answered "what's missing for this meal" since the add-to-list sheets
 * shipped — and the only thing absent was something to say it unprompted.
 *
 * **Modelled on `pantryCheckTasks.ts`, which is itself modelled on
 * `projectReviewTasks.ts`**, and the likeness is structural: it fires on time
 * passing (a meal coming into range) rather than on a source mutation, so it
 * runs from the launch sequence and the Today foreground sweep; it caps the
 * rows it writes; and it clears a row whose reason has gone.
 *
 * Where it deliberately differs, and why:
 *
 * - **The qualifying set is every `needToBuy` row, `known` ones and not.**
 *   `restockRows` narrows to `known` because after a cooking, a recipe naming an
 *   item the app has never seen says nothing about whether the cook needs to buy
 *   it. Shopping *ahead* of a meal inverts that: an item with no catalog row has
 *   never been bought and is exactly what you'll be missing. More to the point,
 *   `needToBuy` is precisely what the add-to-list sheet this task sends you to
 *   already offers pre-ticked, so narrowing it here would let the row disagree
 *   with the sheet it opens. That is the one thing `hasShoppableMeals` exists to
 *   prevent, and it applies with more force to a task than to a button.
 * - **The window is the reason, not a grace period.** `PANTRY_CHECK_GRACE_DAYS`
 *   bounds *raising* a question and deliberately doesn't judge a live row, since
 *   a question already asked doesn't expire. Here the window is the whole
 *   justification — this task exists because a meal is imminent — so a meal that
 *   is no longer imminent takes its task with it, in both directions. Pushed to
 *   next week the shop is premature; once the day has passed it is moot. See
 *   `staleMealShortfallTasks`.
 * - **A finished one blocks for ever** (`blocksOnFinished`). A meal is one
 *   event, the same reading that made cook tasks the only generator to ask the
 *   wide question — having shopped for Tuesday's ragù, a second row asking again
 *   would be an invention. A grocery item and a leftover come round again; a
 *   dinner on the 22nd does not.
 */

/**
 * Row ceiling. Three, like `MAX_PANTRY_CHECK_TASKS` and
 * `MAX_PROJECT_REVIEW_TASKS`, and here the arithmetic makes the case on its own:
 * the default lead is two days and a day holds four slots, so an unbounded
 * generator would answer a fully planned week with a dozen shopping rows for
 * meals that mostly want the same trip.
 */
export const MAX_MEAL_SHORTFALL_TASKS = 3;

/**
 * The row's title.
 *
 * Names the verb and the night together, like `pantryCheckTitle` and
 * `projectReviewTitle` and for the same reason: "Ragù" on the widget, in Search
 * or in the Logbook is a task to *make* the ragù, which is the one thing this
 * isn't. The weekday comes from `collectPlannedIngredients`' own "Tue ragù"
 * format rather than a second one, and it earns its place here even though the
 * row is only ever raised a day or two out: a week where Tuesday and Thursday
 * both want a shop otherwise puts two identically-titled rows on Today.
 *
 * Built from the resolved recipe's own name rather than the entry's captured
 * `title`, so a recipe renamed under a live row is chased by `drift` the way a
 * renamed project is.
 */
export function mealShortfallTitle(dayKey: string, recipeName: string): string {
  return `Shop for ${format(dayKeyToDate(dayKey), 'EEE')} ${recipeName}`;
}

/**
 * The meal plan entry a shortfall task speaks for, or null for any other task.
 *
 * `generatedSourceOf` under a name that says what the string means here — one
 * column holds seven generators' source ids now, and a project id read as an
 * entry id would name a meal that doesn't exist.
 */
export function mealShortfallEntryId(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>
): string | null {
  return generatedSourceOf(task, 'mealShortfall');
}

/**
 * Where the row goes: the Meal Plan screen, opened straight on the sheet the
 * row is asking about.
 *
 * The same dated link the weekly nudge carries, plus a `&shop=` parameter
 * naming the entry — the third meal-plan link form, mirroring `&pick=` on an
 * unanswered meal task's own link (`mealSlotTasks.mealSlotLinkUrl`). Opaque
 * like `projectsUrlPullId`: `mealPlanUrlShopEntryId` resolves it against the
 * live entry list and shrugs (falling back to the dated link's own behavior —
 * land on the day) rather than erroring if the meal has since been moved,
 * cooked, or removed.
 */
export function mealShortfallLinkUrl(dayKey: string, entryId: string): string {
  return `${mealPlanNudgeLinkUrl(dayKey)}&shop=${encodeURIComponent(entryId)}`;
}

/**
 * Whether this meal is close enough to shop for — inside `[today, today +
 * leadDays]`, inclusive at both ends.
 *
 * Day keys compared as strings, which is what every other reader of this column
 * does (`isKeyInRange`, `countPlannedSlots`): they're fixed-width `YYYY-MM-DD`,
 * so they sort as days.
 *
 * `todayKey` is the caller's *logical* today — a meal task raised at 1am with a
 * 2am reset belongs to the day that hasn't ended yet, and reading the calendar
 * date here would open the window a day early. See the grace-window note in
 * CLAUDE.md.
 */
export function isWithinShopWindow(dayKey: string, todayKey: string, leadDays: number): boolean {
  if (dayKey < todayKey) return false;
  return dayKey <= shiftDayKey(todayKey, Math.max(0, leadDays));
}

/**
 * What this meal still needs bought, or null when it is not a meal that can be
 * shopped for at all.
 *
 * The three refusals are `collectPlannedIngredients`' own, read one entry at a
 * time so the button, the sheet and this generator can't disagree about which
 * meals have anything to say: a free-text night ("leftovers") has no ingredient
 * list, a `recipeId` that no longer resolves is resolve-or-shrug like every
 * other cross-row pointer here, and a meal already cooked has had its
 * ingredients either bought or made moot.
 *
 * Null and `[]` mean different things and both callers rely on it: null is "not
 * a shoppable meal", `[]` is "shoppable, and you already have everything".
 *
 * The entry's own `recipeChoices` and `recipeScale` are applied, and the user's
 * standing swaps, for the reason `cookedConsumption` applies them — what you
 * need to buy is what you're actually going to cook with, not what the recipe
 * happens to say.
 */
export function mealShortfallRows(
  entry: MealPlanEntry,
  recipesById: ReadonlyMap<string, Recipe>,
  items: readonly GroceryItem[],
  itemSubs: readonly ItemSubLink[],
  swaps: StandingSwapMap,
  now: Date
): ClassifiedIngredient[] | null {
  if (!entry.recipeId) return null;
  if (entry.cookedAt) return null;
  const recipe = recipesById.get(entry.recipeId);
  if (!recipe) return null;

  const classified = classifyPlanned(
    plannedIngredientsForRecipe(
      recipe,
      recipesById,
      { chosen: entry.recipeChoices },
      entry.recipeScale,
      swaps
    ),
    items,
    now,
    itemSubs
  );
  return classified.filter(row => row.category === 'needToBuy');
}

/**
 * Whether this meal has been told not to ask — `MealPlanEntry.shopTask`, which
 * `deleteTask` stamps `false` when the user swipes the row away.
 *
 * **Deliberately not `wantsGeneratedTask`**, and this is the one place this
 * generator narrows the shared tri-state rather than reusing it. That helper
 * lets an explicit `true` spawn a task with the setting off *and with the
 * source not qualifying* — right for a cook task, where "remind me to make this
 * on Sunday" is a complete instruction on its own, and wrong here, where the
 * task's entire content is a list of things you are missing. A `true` that
 * conjured a shop for a meal you already have everything for would also thrash:
 * `staleMealShortfallTasks` judges on the shortfall alone, so the create pass
 * would write the row and the clear pass would delete it, once per sweep,
 * forever.
 *
 * So the answer only ever subtracts. The setting is checked by the caller
 * (`checkMealShortfallTasks` returns early when it is off), the shortfall is
 * checked below and in the stale pass, and this is the per-meal "no".
 */
function declinedShop(entry: Pick<MealPlanEntry, 'shopTask'>): boolean {
  return entry.shopTask === false;
}

/** One meal that should have a shopping task sitting on today's list. */
export interface MealShortfallWant {
  entryId: string;
  title: string;
  dayKey: string;
  /** How many lines are still to buy, for ordering and for the caller's own use. */
  missingCount: number;
}

/**
 * Which meals should have a shopping task right now, soonest first.
 *
 * **Soonest, not most-missing.** A row is a prompt to make one trip, and the
 * trip that matters is the one for tonight — ranking by how much is missing
 * would put Thursday's twelve-line curry above tomorrow's one missing onion,
 * which is the meal you're actually about to be blindsided by. Ties break on
 * the slot order and then the title, so a capped-out day is stable between
 * sweeps the way `wantedPantryChecks` is.
 *
 * Answers "who should have one", not "who lacks one" — the caller runs every
 * want through `reconcileGeneratedTask`, which is what turns "wanted, none
 * exists" into a create and "wanted, one exists" into a drift check.
 */
export function wantedMealShortfalls(
  entries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
  items: readonly GroceryItem[],
  itemSubs: readonly ItemSubLink[],
  swaps: StandingSwapMap,
  todayKey: string,
  now: Date,
  leadDays: number = MEAL_SHORTFALL_LEAD_DAYS_DEFAULT,
  cap: number = MAX_MEAL_SHORTFALL_TASKS
): MealShortfallWant[] {
  const wants: { entry: MealPlanEntry; title: string; missingCount: number }[] = [];
  for (const entry of entries) {
    if (declinedShop(entry)) continue;
    if (!isWithinShopWindow(entry.date, todayKey, leadDays)) continue;
    const rows = mealShortfallRows(entry, recipesById, items, itemSubs, swaps, now);
    if (!rows || rows.length === 0) continue;
    // Non-null by construction: mealShortfallRows returns null without a
    // resolvable recipe, which is the only way this lookup could miss.
    const recipe = recipesById.get(entry.recipeId!)!;
    wants.push({
      entry,
      title: mealShortfallTitle(entry.date, recipe.name),
      missingCount: rows.length,
    });
  }
  return wants
    .sort(
      (a, b) =>
        a.entry.date.localeCompare(b.entry.date) ||
        slotRank(a.entry.slot) - slotRank(b.entry.slot) ||
        a.title.localeCompare(b.title)
    )
    .slice(0, Math.max(0, cap))
    .map(({ entry, title, missingCount }) => ({
      entryId: entry.id,
      title,
      dayKey: entry.date,
      missingCount,
    }));
}

/**
 * The shopping tasks sitting there whose reason has gone.
 *
 * **This is why the check runs on a sweep**, and it is the whole answer to a
 * meal plan being a thing people change. A meal stops wanting a shop the moment
 * it is re-planned, moved, cooked, deleted, or shopped for — including from this
 * very row — and none of those mutations knows a task is sitting on Today naming
 * the old dish. "Shop for Tue ragù" left over after Tuesday became a takeaway is
 * a chore about nothing.
 *
 * Every way a plan can change is one of these, which is why the predicate is the
 * creation predicate re-run rather than a list of mutations to intercept:
 *
 * - **entry deleted** — the lookup misses, exactly as a deleted grocery item
 *   leaves a pantry check pointing at nothing.
 * - **recipe swapped, or swapped for free text** — `mealShortfallRows` is
 *   recomputed against whatever is there now, so a night that no longer resolves
 *   to a recipe returns null and a night that now resolves to something you have
 *   everything for returns `[]`.
 * - **ingredients bought, or added to the list** — the same recompute: a row on
 *   the list is `alreadyOnList`/`inCart`, never `needToBuy`.
 * - **marked cooked** — refused by `mealShortfallRows`.
 * - **moved out of range**, in either direction — see `isWithinShopWindow`.
 *
 * A meal merely *renamed* is not stale; the title is chased by `drift` instead,
 * the same split `staleProjectReviewTasks` draws for a renamed project. Deleting
 * and rewriting the row there would cost the user their deferral to buy nothing.
 *
 * **Judged on the predicate alone, never on the cap**, so losing a contest for
 * one of three slots can't delete a row the user has already deferred to
 * Saturday. Same split `stalePantryCheckTasks` and `staleProjectReviewTasks`
 * both make, and the reason this doesn't simply diff against
 * `wantedMealShortfalls`.
 *
 * A completed task is in neither reading, and neither is an archived one — the
 * two exclusions `liveGeneratedTasksOfKind` already makes.
 */
export function staleMealShortfallTasks<
  T extends Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>
>(
  tasks: readonly T[],
  entries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
  items: readonly GroceryItem[],
  itemSubs: readonly ItemSubLink[],
  swaps: StandingSwapMap,
  todayKey: string,
  now: Date,
  leadDays: number = MEAL_SHORTFALL_LEAD_DAYS_DEFAULT
): T[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  return liveGeneratedTasksOfKind(tasks, 'mealShortfall').filter(task => {
    const entryId = mealShortfallEntryId(task);
    const entry = entryId ? byId.get(entryId) : undefined;
    if (!entry) return true;
    // Both passes read the per-meal "no", so a meal told to stop asking can't
    // keep a row the create pass would refuse to write.
    if (declinedShop(entry)) return true;
    if (!isWithinShopWindow(entry.date, todayKey, leadDays)) return true;
    const rows = mealShortfallRows(entry, recipesById, items, itemSubs, swaps, now);
    return !rows || rows.length === 0;
  });
}
