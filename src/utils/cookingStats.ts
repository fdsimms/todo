import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { subDays } from 'date-fns/subDays';
import type { Leftover, MealPlanEntry, Recipe } from '../types';
import { dayKeyOf, dayKeyToDate } from './dateUtils';
import { outcomeCounts } from './leftovers';
import { avgCookMinutes } from './recipeUtils';

/**
 * What the Stats screen can say about cooking, derived from rows the kitchen
 * already writes — `MealPlanEntry.cookedAt`, `Recipe.cookCount` and a
 * leftover's outcome. Nothing here is stored and nothing new is recorded; this
 * is a read over three sets that each already exist.
 *
 * **Counts, never a score.** No percentage, no "you wasted 11%", no
 * encouragement — the rule `describeFridgeHistory` states for the fridge,
 * applied to the whole surface, and it earns its keep twice over here: a meal
 * planned and not cooked is very often the app working rather than failing
 * (you ate the leftovers, or you went out), so a red 64% would be grading
 * someone for a good week. A fraction they can read either way is the most
 * this should say.
 *
 * Store-free and leaf-ish on purpose, like `stats.ts` and `missed.ts` beside
 * it, so jest can reach it in the `node` environment.
 */

/**
 * The span a cooking read covers, as day keys.
 *
 * `endKey` is the far end of the range actually read out of SQLite, while
 * `todayKey` is the current *logical* day — the boundary between meals that
 * have happened and meals that are still ahead. They coincide whenever the
 * window ends today (which `cookingWindow` always builds), but they answer
 * different questions and nothing below may assume one from the other.
 */
export interface CookingWindow {
  /** Inclusive first day. */
  startKey: string;
  /** Inclusive last day. */
  endKey: string;
  /** The current logical day. An entry dated here or later hasn't happened yet. */
  todayKey: string;
}

export interface MealCookCounts {
  /** How many days the window covers, inclusive of both ends. */
  days: number;
  /** Distinct days in the window with at least one meal marked cooked. */
  daysCooked: number;
  /**
   * Meals planned in the window on days that have already passed — the
   * denominator of "planned meals cooked".
   */
  planned: number;
  /** How many of `planned` were marked cooked. */
  plannedCooked: number;
}

/** One entry in the most-cooked leaderboard. */
export interface CookedRecipe {
  id: string;
  name: string;
  /** `Recipe.cookCount` — all-time, see `mostCookedRecipes`. */
  count: number;
  lastCookedAt: string | null;
  /** `avgCookMinutes`, null until a cook session has been timed or logged. */
  avgMinutes: number | null;
}

export const EMPTY_MEAL_COOK_COUNTS: MealCookCounts = {
  days: 0,
  daysCooked: 0,
  planned: 0,
  plannedCooked: 0,
};

/**
 * The last `days` logical days, ending today.
 *
 * Takes the logical today rather than reaching for `new Date()` itself, so the
 * caller supplies a `dayResetTime`-aware day (see `getLogicalToday`) and a 1am
 * read doesn't silently start a new window six hours early.
 */
export function cookingWindow(today: Date, days: number): CookingWindow {
  const span = Math.max(1, Math.round(days));
  const todayKey = dayKeyOf(today);
  return {
    startKey: dayKeyOf(subDays(today, span - 1)),
    endKey: todayKey,
    todayKey,
  };
}

/**
 * What the meal plan says about the window.
 *
 * Two rules that aren't obvious from the fields:
 *
 * **Bucketed by the entry's own `date`, never by the `cookedAt` instant.** A
 * Monday dinner cooked on Tuesday is still Monday's meal — and counting by the
 * instant would let a meal land in the window whose plan day doesn't, so the
 * numerator could escape its own denominator.
 *
 * **The denominator stops at yesterday.** Tonight's dinner is not a meal you
 * failed to cook, and neither is anything the user has planned ahead; counting
 * the days still to come would make the fraction worse the further ahead
 * someone plans, which is exactly backwards. `daysCooked` has no such problem —
 * it's a straight count of days that happened — so it does include today.
 */
export function mealCookCounts(
  entries: readonly MealPlanEntry[],
  window: CookingWindow
): MealCookCounts {
  const cookedDays = new Set<string>();
  let planned = 0;
  let plannedCooked = 0;

  for (const entry of entries) {
    // Day keys are zero-padded, so the range test is a lexical compare — the
    // same property that lets the SQLite read be a plain `date >= ? AND <= ?`.
    if (entry.date < window.startKey || entry.date > window.endKey) continue;
    if (entry.cookedAt) cookedDays.add(entry.date);
    if (entry.date >= window.todayKey) continue;
    planned += 1;
    if (entry.cookedAt) plannedCooked += 1;
  }

  return {
    days: Math.max(
      0,
      differenceInCalendarDays(dayKeyToDate(window.endKey), dayKeyToDate(window.startKey)) + 1
    ),
    daysCooked: cookedDays.size,
    planned,
    plannedCooked,
  };
}

/**
 * The containers closed out inside the window — eaten or binned, not the ones
 * still in the fridge.
 *
 * Windowed by `finishedAt` rather than by `storedAt`, because the ending is the
 * event being counted: a pot of soup stored in May and finished last week
 * belongs to last week.
 *
 * Note the ceiling this read has that the others don't: closed-out rows are
 * purged after `LEFTOVER_RETENTION_DAYS`, so a window wider than that would
 * quietly under-report.
 *
 * Handed back as rows rather than as a tally so the caller can put them through
 * `describeFridgeHistory` for the wording *and* `outcomeCounts` for the number
 * without either being restated here.
 */
export function leftoversFinishedIn(
  leftovers: readonly Leftover[],
  window: CookingWindow
): Leftover[] {
  return leftovers.filter(leftover => {
    if (!leftover.finishedAt) return false;
    const key = dayKeyOf(new Date(leftover.finishedAt));
    return key >= window.startKey && key <= window.endKey;
  });
}

/**
 * The eaten/tossed split for that set. Delegates the tally to `outcomeCounts`,
 * so the "a `finishedAt` with no outcome counts as eaten" rule lives in exactly
 * one place.
 */
export function leftoverHistoryIn(
  leftovers: readonly Leftover[],
  window: CookingWindow
): { eaten: number; tossed: number } {
  return outcomeCounts(leftoversFinishedIn(leftovers, window));
}

/**
 * The most-cooked dishes, highest first.
 *
 * **All-time, and it has to be.** `Recipe.cookCount` is a standalone counter
 * bumped once per "Mark cooked" and never recomputed by scanning entries,
 * precisely so it outlives the 180-day entry purge — so there is no way to
 * window it, and a caller must label it as the all-time number it is rather
 * than letting it sit unqualified under a 30-day heading.
 *
 * Ties break on the most recently cooked and then on name, so the order is
 * stable rather than however the library happened to be sorted.
 */
export function mostCookedRecipes(recipes: readonly Recipe[], limit = 5): CookedRecipe[] {
  return recipes
    .filter(recipe => recipe.cookCount > 0)
    .map(recipe => ({
      id: recipe.id,
      name: recipe.name,
      count: recipe.cookCount,
      lastCookedAt: recipe.lastCookedAt,
      avgMinutes: avgCookMinutes(recipe),
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      const at = a.lastCookedAt ? Date.parse(a.lastCookedAt) : 0;
      const bt = b.lastCookedAt ? Date.parse(b.lastCookedAt) : 0;
      if (bt !== at) return bt - at;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit);
}

/**
 * Whether there is anything at all to show — the gate a caller renders the
 * whole section behind.
 *
 * Deliberately not "are the counts zero": a `null` means nothing has looked
 * yet, which is a third answer and must not render as a row of zeroes (the
 * call `plannedSlotCounts` makes about an absent count rendering no chip).
 */
export function hasCookingData(
  counts: MealCookCounts | null,
  history: { eaten: number; tossed: number },
  cooked: readonly CookedRecipe[]
): boolean {
  if (cooked.length > 0) return true;
  if (history.eaten > 0 || history.tossed > 0) return true;
  return counts !== null && (counts.daysCooked > 0 || counts.planned > 0);
}
