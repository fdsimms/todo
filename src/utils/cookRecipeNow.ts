import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { cookEntryForRecipe, earliestUnplannedSlot } from './mealPlan';
import { dayKeyOf, getLogicalToday } from './dateUtils';
import { slotForHour } from './mealLog';

/**
 * Logs a recipe as cooked from somewhere with no meal-plan entry to hang the
 * post-cook sheet off: the recipe library, and a cook timer's Done on the Lock
 * Screen. Plans it onto today first (when today has no unlogged entry for it),
 * so `finishCookForRecipe` finds a row to pair and `CookRecap` opens with its
 * leftovers question. Without that row the cooking only moved the recipe's
 * counters and nothing asked.
 *
 * **Into the meal the clock says it is**, when that meal is one the person
 * plans (`slotForHour`), and only otherwise into the earliest unplanned slot:
 * earliest-unplanned alone filed a dinner cooked at 7 PM as that morning's
 * breakfast.
 */
export function cookRecipeNow(recipeId: string): void {
  const meals = useMealPlanStore.getState();
  const recipe = useRecipeStore.getState().recipes.find(r => r.id === recipeId);
  const dayKey = dayKeyOf(getLogicalToday());
  const todayEntries = meals.entriesForDayLive(dayKey);
  if (recipe && !cookEntryForRecipe(todayEntries, recipeId, dayKey)) {
    const slots = useSettingsStore.getState().mealSlotsEnabled;
    // The real clock, not a logical one: this is the time of eating.
    const byClock = slotForHour(new Date().getHours());
    meals.planMeal({
      date: dayKey,
      slot: slots.includes(byClock) ? byClock : earliestUnplannedSlot(todayEntries, dayKey, slots),
      recipeId,
      title: recipe.name,
    });
  }
  meals.finishCookForRecipe(recipeId);
}
