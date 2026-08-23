import type { MealPlanEntry, MealSlot } from '../types';
import { dayKeyOf } from './dateUtils';
import { entriesForDay } from './mealPlan';

/**
 * Which nights of a week are still to answer.
 *
 * Everything here is pure and node-testable, the same discipline `mealPlan.ts`
 * next to it follows. It was written for the "Whole week" lens (#1669) and
 * outlived it: the lens is gone, its dense reading of the week is now the meal
 * plan list's own compact density, and what's left is the part the day list
 * always used — which nights a suggestion pass may land on.
 *
 * **An open night in the past is not a decision.** A Monday nobody cooked is
 * history by Thursday, so it is never counted among the nights still to plan
 * and never handed to a suggestion pass as somewhere to land. The day list
 * deliberately keeps its own behaviour here — planning a meal onto a night
 * that has passed is how you *record* what you ate, which is a real thing to
 * want and exactly what the per-day + button is for.
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
