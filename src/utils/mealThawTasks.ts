import { format } from 'date-fns/format';
import {
  FROZEN_REASON,
  type GroceryItem,
  type ItemProduct,
  type ItemSubLink,
  type Leftover,
  type MealPlanEntry,
  type MealSlot,
  type Recipe,
  type Task,
} from '../types';
import { dayKeyToDate } from './dateUtils';
import { generatedSourceOf, liveGeneratedTasksOfKind } from './generatedTasks';
import { shiftDayKey, slotLabel, slotRank } from './mealPlan';
import { classifyPlanned, plannedIngredientsForRecipe } from './mealPlanGroceries';
import type { StandingSwapMap } from './standingSwaps';
import { onHandNameKeys } from './grocerySuggest';
import { kitchenEntryId, kitchenLinkUrl } from './kitchenInventory';
import { isLiveLeftover } from './leftovers';
import { joinNames } from './shoppingTrip';

/**
 * "Take chicken out of the freezer (Thursday Dinner)" — the meal plan noticing
 * that what a planned meal needs is only on hand frozen (#2926).
 *
 * The pantry already knew. `probablyHaveReason` reads a live `frozenAt` as on
 * hand, which is what keeps `mealShortfallTasks` quiet about a chicken that's
 * in the freezer (correctly: you don't need to buy it). But being quiet was all
 * it did, and "frozen and planned" is the one moment somebody trying not to
 * waste food needs telling, because thawing in the fridge takes a day and the
 * day to do it is the one before the meal.
 *
 * **A sibling of `mealShortfallTasks.ts`, and it borrows everything but the
 * question.** Same source row (the `MealPlanEntry`), same classification
 * (`classifyPlanned` over the entry's own picks, scale and standing swaps), same
 * soonest-first cap, same clear pass that re-runs the create predicate rather
 * than intercepting the mutations that can change a week, and a finished row
 * blocks for ever because a meal is one event. Where shortfall asks about rows
 * the kitchen *lacks* (`needToBuy`), this asks about rows it has only in the
 * freezer: `probablyHave` with `FROZEN_REASON`, the answer the freezer gives
 * on `probablyHaveReason`'s ladder. That ladder is exact about precedence, so a
 * frozen item the user has since marked "Out of it" or "running low" is not
 * read as frozen here either.
 *
 * Four decisions:
 *
 * - **The window is today and tomorrow** (`MEAL_THAW_LEAD_DAYS`). Tomorrow's
 *   meal is the one a fridge thaw is for; today's is still worth saying for a
 *   meal planned this morning, since a cold-water thaw or the microwave is
 *   still an answer. Anything further out is premature: food moved to the
 *   fridge three days early is food with three days less on its clock.
 * - **One row per meal, naming every frozen thing in it**, rather than one per
 *   item: it's one trip to the freezer, and three rows for one dinner is the
 *   pile-up the cap exists to stop.
 * - **A planned leftover counts too.** A frozen container is still live and
 *   still plannable (`docs/arch/groceries.md`, "A frozen container is still
 *   live"), and a frozen portion of chili planned for tomorrow is the most
 *   common version of this there is.
 * - **Nothing is thawed by ticking it off.** Completing the row doesn't clear
 *   the item's `frozenAt`: whether the food actually came out is the user's to
 *   say in the Pantry, which is where the row's link goes. Same "an offer,
 *   never a write" line `mealLog.ts` draws.
 */

/** How many days ahead of a meal its thaw row is raised: tomorrow, and today. */
export const MEAL_THAW_LEAD_DAYS = 1;

/** Row ceiling, for `MAX_MEAL_SHORTFALL_TASKS`' reason. */
export const MAX_MEAL_THAW_TASKS = 3;

/**
 * The row's title: the action, what to take out, and the meal it's for.
 *
 * Grocery names are lowercased mid-sentence the way `describeSubstitutesOnHand`
 * writes "you have margarine"; a leftover keeps the name it was logged under,
 * the way `mealShortfallTitle` keeps a recipe's.
 */
export function mealThawTitle(dayKey: string, slot: MealSlot, names: readonly string[]): string {
  return `Take ${joinNames(names)} out of the freezer (${format(dayKeyToDate(dayKey), 'EEEE')} ${slotLabel(slot)})`;
}

/** The meal plan entry a thaw task speaks for, or null for any other task. */
export function mealThawEntryId(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): string | null {
  return generatedSourceOf(task, 'mealThaw');
}

/** Whether a meal is close enough to thaw for: `[today, today + MEAL_THAW_LEAD_DAYS]`. */
export function isWithinThawWindow(dayKey: string, todayKey: string): boolean {
  return dayKey >= todayKey && dayKey <= shiftDayKey(todayKey, MEAL_THAW_LEAD_DAYS);
}

/** What in a meal is only on hand frozen, and the Pantry row to open for it. */
export interface FrozenForMeal {
  /** Display names, in the recipe's order. */
  names: string[];
  /** The one Pantry row to open, when there is exactly one thing to take out. */
  kitchenEntryId: string | null;
}

/**
 * What this meal would take out of the freezer, or null when it is not a meal
 * this can speak for at all.
 *
 * Null and an empty `names` mean different things, the same split
 * `mealShortfallRows` keeps: null is "nothing to ask about" (cooked already, a
 * typed meal with no recipe or container behind it, a recipe that no longer
 * resolves, a container that's been finished), empty is "a real meal, and
 * nothing in it is frozen".
 *
 * An optional line (a garnish) is left out, for shortfall's reason: the meal
 * doesn't wait on it.
 */
export function frozenForMeal(
  entry: MealPlanEntry,
  recipesById: ReadonlyMap<string, Recipe>,
  leftovers: readonly Leftover[],
  items: readonly GroceryItem[],
  itemSubs: readonly ItemSubLink[],
  swaps: StandingSwapMap,
  now: Date,
  products: readonly ItemProduct[] = []
): FrozenForMeal | null {
  if (entry.cookedAt) return null;

  // A leftover night eats the container, not the recipe it came from, which is
  // the reading mealSlotChain takes too (no Cook step).
  if (entry.leftoverId) {
    const leftover = leftovers.find(l => l.id === entry.leftoverId);
    if (!leftover || !isLiveLeftover(leftover)) return null;
    return leftover.frozenAt
      ? { names: [leftover.title], kitchenEntryId: kitchenEntryId('leftover', leftover.id) }
      : { names: [], kitchenEntryId: null };
  }

  if (!entry.recipeId) return null;
  const recipe = recipesById.get(entry.recipeId);
  if (!recipe) return null;

  const rows = classifyPlanned(
    plannedIngredientsForRecipe(
      recipe,
      recipesById,
      { chosen: entry.recipeChoices, onHand: onHandNameKeys(items, now, products) },
      entry.recipeScale,
      swaps
    ),
    items,
    now,
    itemSubs,
    null,
    products
  ).filter(row => row.category === 'probablyHave' && row.reason === FROZEN_REASON && !row.optional);

  const only = rows.length === 1 ? items.find(i => i.nameKey === rows[0].nameKey) : undefined;
  return {
    names: rows.map(row => row.name.toLowerCase()),
    kitchenEntryId: only ? kitchenEntryId('grocery', only.id) : null,
  };
}

/**
 * Where the row goes: the Pantry, opened on the one frozen row when there is
 * only one, since marking it thawed there is what the user does next. Several
 * open the Pantry itself, whose Freezer section leads the list.
 */
export function mealThawLinkUrl(frozen: Pick<FrozenForMeal, 'kitchenEntryId'>): string {
  return kitchenLinkUrl(frozen.kitchenEntryId);
}

/**
 * Whether this meal has been told not to ask — `MealPlanEntry.thawTask`, which
 * `deleteTask` stamps `false` when the user swipes the row away. Subtract-only,
 * for `mealShortfallTasks`' `declinedShop` reason: a `true` conjuring a row for
 * a meal with nothing frozen in it would be written by the create pass and
 * deleted by the clear pass on every sweep.
 */
function declinedThaw(entry: Pick<MealPlanEntry, 'thawTask'>): boolean {
  return entry.thawTask === false;
}

/** One meal that should have a thaw task on today's list. */
export interface MealThawWant {
  entryId: string;
  title: string;
  dayKey: string;
  linkUrl: string;
}

/** Which meals should have a thaw task right now, soonest first and capped. */
export function wantedMealThaws(
  entries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
  leftovers: readonly Leftover[],
  items: readonly GroceryItem[],
  itemSubs: readonly ItemSubLink[],
  swaps: StandingSwapMap,
  todayKey: string,
  now: Date,
  cap: number = MAX_MEAL_THAW_TASKS,
  products: readonly ItemProduct[] = []
): MealThawWant[] {
  const wants: { entry: MealPlanEntry; want: MealThawWant }[] = [];
  for (const entry of entries) {
    if (declinedThaw(entry)) continue;
    if (!isWithinThawWindow(entry.date, todayKey)) continue;
    const frozen = frozenForMeal(entry, recipesById, leftovers, items, itemSubs, swaps, now, products);
    if (!frozen || frozen.names.length === 0) continue;
    wants.push({
      entry,
      want: {
        entryId: entry.id,
        title: mealThawTitle(entry.date, entry.slot, frozen.names),
        dayKey: entry.date,
        linkUrl: mealThawLinkUrl(frozen),
      },
    });
  }
  return wants
    .sort(
      (a, b) =>
        a.entry.date.localeCompare(b.entry.date) ||
        slotRank(a.entry.slot) - slotRank(b.entry.slot) ||
        a.want.title.localeCompare(b.want.title)
    )
    .slice(0, Math.max(0, cap))
    .map(({ want }) => want);
}

/**
 * The thaw tasks sitting there whose reason has gone: the creation predicate
 * re-run, for `staleMealShortfallTasks`' reason and with its list — the meal
 * deleted, re-planned, moved out of the window (including its day passing),
 * cooked, declined, or its food already out of the freezer. Judged on the
 * predicate alone and never on the cap.
 */
export function staleMealThawTasks<
  T extends Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived'>
>(
  tasks: readonly T[],
  entries: readonly MealPlanEntry[],
  recipesById: ReadonlyMap<string, Recipe>,
  leftovers: readonly Leftover[],
  items: readonly GroceryItem[],
  itemSubs: readonly ItemSubLink[],
  swaps: StandingSwapMap,
  todayKey: string,
  now: Date,
  products: readonly ItemProduct[] = []
): T[] {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  return liveGeneratedTasksOfKind(tasks, 'mealThaw').filter(task => {
    const entryId = mealThawEntryId(task);
    const entry = entryId ? byId.get(entryId) : undefined;
    if (!entry) return true;
    if (declinedThaw(entry)) return true;
    if (!isWithinThawWindow(entry.date, todayKey)) return true;
    const frozen = frozenForMeal(entry, recipesById, leftovers, items, itemSubs, swaps, now, products);
    return !frozen || frozen.names.length === 0;
  });
}
