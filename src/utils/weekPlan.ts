import type { MealPlanEntry, MealSlot } from '../types';
import { dayKeyOf } from './dateUtils';
import { entriesForDay } from './mealPlan';
import type { ClassifiedIngredient } from './mealPlanGroceries';

/**
 * The deciding moment, as a read (#1669).
 *
 * "Whole week" is a *lens* over the meal plan screen's own week, not a screen
 * and emphatically not a fifth store: it answers "what have I not decided yet,
 * what will it cost me at the shop, and what could I make" from exactly the
 * selectors the day-by-day list already runs. Everything here is pure and
 * node-testable, the same discipline `mealPlan.ts` next to it follows.
 *
 * Two rules run through the whole module and are worth stating once:
 *
 * - **An open night in the past is not a decision.** A Monday nobody cooked is
 *   history by Thursday, so it is never counted among the nights still to plan
 *   and never handed to a suggestion pass as somewhere to land. The day-by-day
 *   list deliberately keeps its own behaviour here — planning a meal onto a
 *   night that has passed is how you *record* what you ate, which is a real
 *   thing to want and exactly what the per-day + button is for. This lens is
 *   the deciding surface, and there is nothing left to decide about Monday.
 * - **A guess is never summed into a fact.** `needToBuy` and "already on your
 *   list" are things the catalog knows; "probably have" is `grocerySuggest`'s
 *   opinion. They ride as separate clauses and are never added together, the
 *   same shape `describeShops` and `describePantryCoverage` use, so no number
 *   on this surface asserts something the user didn't.
 *
 * `todayKey` is a parameter rather than a read of the clock, matching
 * `selectTodayMealEntries` — and it is a plain calendar day key, deliberately
 * not `dayResetTime`-aware, because a `MealPlanEntry.date` is a calendar day
 * by construction (see the field's own note) and the rest of this feature
 * already compares against `dayKeyOf(new Date())`.
 */

/** One day of the week, as the deciding surface reads it. */
export interface WeekNight {
  date: Date;
  dayKey: string;
  /** Everything planned that day, in reading order — all slots, not just the anchor. */
  entries: MealPlanEntry[];
  /** Nothing planned in the anchor slot. A night still to answer, unless it's `past`. */
  open: boolean;
  /** Before today's day key. */
  past: boolean;
  today: boolean;
}

/**
 * The week, one row per day, marked up with what the reader has to decide.
 *
 * `open` is scoped to one slot (dinner, which is what a week plan is mostly
 * about — see `daysWithoutMeal`) while `entries` is the whole day: a Tuesday
 * holding only a planned breakfast is still a Tuesday with no dinner, and a row
 * that showed the porridge without saying so would read as a night already
 * settled.
 */
export function weekNights(
  entries: readonly MealPlanEntry[],
  days: readonly Date[],
  todayKey: string,
  slot: MealSlot = 'dinner',
): WeekNight[] {
  return days.map(date => {
    const dayKey = dayKeyOf(date);
    const dayEntries = entriesForDay(entries, dayKey);
    return {
      date,
      dayKey,
      entries: dayEntries,
      open: !dayEntries.some(e => e.slot === slot),
      past: dayKey < todayKey,
      today: dayKey === todayKey,
    };
  });
}

/**
 * The nights a planning pass may actually land on, in week order.
 *
 * This is both the count the surface reports and the set it hands
 * `SuggestMealsSheet`, which has to be one answer — that sheet lands each
 * acceptance on the next day it was given without consulting the plan, so a
 * list naming a night that's already spoken for double-books it, and one
 * naming a night that has passed plans dinner for last Monday.
 */
export function decidableNights(nights: readonly WeekNight[]): Date[] {
  return nights.filter(n => n.open && !n.past).map(n => n.date);
}

/**
 * "3 nights without a dinner" — the one line under the week's rows.
 *
 * A week entirely in the past says so rather than reporting zero nights left:
 * "Every night is planned" about a week where four of them never were is the
 * kind of quiet untruth this surface can't afford.
 */
export function describeWeekDecision(nights: readonly WeekNight[]): string {
  if (nights.length === 0) return '';
  if (nights.every(n => n.past)) return 'This week has already happened';
  const open = decidableNights(nights).length;
  if (open === 0) return 'Every night is planned';
  return `${open} night${open === 1 ? '' : 's'} without a dinner`;
}

/**
 * What the week still needs from the shop, counted off `classifyPlanned`'s
 * rows — the same classification `AddWeekToListSheet` commits, read rather
 * than re-derived so the number on this surface and the sheet it opens can't
 * disagree.
 */
export interface WeekShopping {
  /** No catalog row, or known and off the list. */
  needToBuy: number;
  /** On the list already, cart or not — one fact, and the cart is not a separate decision here. */
  onList: number;
  /** `grocerySuggest`'s pantry opinion. A guess, and kept apart from everything above. */
  probablyHave: number;
  /** Marked "always have". Never a decision, so nothing renders it — see describeWeekShopping. */
  staple: number;
  total: number;
}

export function summarizeWeekShopping(classified: readonly ClassifiedIngredient[]): WeekShopping {
  const summary: WeekShopping = {
    needToBuy: 0,
    onList: 0,
    probablyHave: 0,
    staple: 0,
    total: classified.length,
  };
  for (const row of classified) {
    switch (row.category) {
      case 'needToBuy': summary.needToBuy++; break;
      case 'alreadyOnList': case 'inCart': summary.onList++; break;
      case 'probablyHave': summary.probablyHave++; break;
      case 'staple': summary.staple++; break;
    }
  }
  return summary;
}

/** The two halves of the shopping line — see describeWeekShopping. */
export interface WeekShoppingCopy {
  /** The decision: "6 ingredients to buy", or that there isn't one left. */
  lead: string;
  /** Everything already settled, and the pantry guess, as its own clauses. May be empty. */
  rest: string;
}

/**
 * "6 ingredients to buy" over "3 already on your list · 2 you probably have".
 *
 * Two fields rather than one sentence because the row that renders it is a
 * title over a subtitle: the whole thing is around sixty characters, which is
 * two wrapped lines at 390pt either way, and wrapped mid-clause it reads as
 * one long shrug instead of a number and its qualifications.
 *
 * Null when the week has nothing shoppable at all — a week of free-text meals
 * has no ingredient list behind it, and a row reading "0 to buy" there would
 * be claiming the shop is done rather than that nobody asked.
 *
 * `staple` is counted and deliberately never said: "always have" is a standing
 * assertion, not something this week changes, so naming it adds a clause to
 * every reading of the line and takes no decision off the reader.
 */
export function describeWeekShopping(s: WeekShopping): WeekShoppingCopy | null {
  if (s.total === 0) return null;
  const rest: string[] = [];
  if (s.onList > 0) rest.push(`${s.onList} already on your list`);
  if (s.probablyHave > 0) rest.push(`${s.probablyHave} you probably have`);
  return {
    lead: s.needToBuy > 0
      ? `${s.needToBuy} ingredient${s.needToBuy === 1 ? '' : 's'} to buy`
      : 'Nothing left to buy',
    rest: rest.join(' · '),
  };
}

/**
 * The one line a cold week opens with, in place of a stack of empty sections
 * — the "legible when empty" constraint, answered by saying what the surface
 * is for rather than by rendering four headings with nothing under them.
 *
 * Null once anything is planned: the rows below are then the answer, and a
 * hint repeating what they already show is the seven-copies-of-"No meals
 * planned yet" mistake the day list removed.
 */
export function describeBareWeek(plannedCount: number, recipeCount: number): string | null {
  if (plannedCount > 0) return null;
  if (recipeCount === 0) {
    return 'Nothing planned this week. Tap a night to plan a meal, or add recipes so suggestions can show up here.';
  }
  return 'Nothing planned this week. Tap a night to plan a meal.';
}
