import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import { MEAL_SLOT_LABELS, type MealPlanEntry } from '../types';
import { dayKeyToDate } from './dateUtils';

/**
 * When a recipe is next on the meal plan, for the "Planned" chips on its page,
 * each of which opens the plan on that day.
 *
 * Read from every entry for the recipe rather than the meal plan store's
 * loaded week, which is whatever week Meal plan last showed: a recipe planned
 * for next month is still planned. A leftover entry is a second meal from one
 * cook, not a plan to cook, so it's left out.
 */

/** How many upcoming meals the recipe page names before it stops. */
export const PLANNED_MEAL_LIMIT = 4;

/** The recipe's entries from today on, soonest first, at most `limit`. */
export function upcomingRecipeMeals(
  entries: readonly MealPlanEntry[],
  todayKey: string,
  limit: number = PLANNED_MEAL_LIMIT,
): MealPlanEntry[] {
  return entries
    .filter(e => !e.leftoverId && e.date >= todayKey)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, limit);
}

/**
 * "Today's dinner", "Tomorrow's lunch", "Tue dinner" within the week ahead,
 * "Oct 14 dinner" past it.
 */
export function plannedMealLabel(entry: MealPlanEntry, todayKey: string): string {
  const slot = MEAL_SLOT_LABELS[entry.slot].toLowerCase();
  const days = differenceInCalendarDays(dayKeyToDate(entry.date), dayKeyToDate(todayKey));
  if (days === 0) return `Today's ${slot}`;
  if (days === 1) return `Tomorrow's ${slot}`;
  const day = dayKeyToDate(entry.date);
  return `${days < 7 ? format(day, 'EEE') : format(day, 'MMM d')} ${slot}`;
}
