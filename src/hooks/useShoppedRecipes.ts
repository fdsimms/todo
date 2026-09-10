import { useCallback, useEffect, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import type { GroceryItem } from '../types';
import { useGroceryStore } from '../store/useGroceryStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { dayKeyOf, getLogicalToday } from '../utils/dateUtils';
import { shoppedRecipes, type ShoppedRecipe } from '../utils/groceryRecipeFilter';
import { recipeIndex } from '../utils/mealPlan';
import { standingSwapMap } from '../utils/standingSwaps';

/**
 * The recipes the current trolley is being shopped for — the grocery list's
 * recipe strip, and the filter tapping one applies.
 *
 * Keeps `useMealPlanStore.shopWindowEntries` in step and turns it into
 * `ShoppedRecipe[]`, so the screen holds the selection and nothing else.
 *
 * **The snapshot is pulled here rather than pushed by the plan's writes**, the
 * same call `useMealPlanNudgeProgress` makes and for its reasons: a line in each
 * of `useMealPlanStore`'s mutators is the shape CLAUDE.md records failing twice,
 * and it would still miss the writes that go through no mutator at all — a
 * restored backup, a demo-mode swap, a pull from another device.
 *
 * Two triggers, because there are two ways the answer goes stale:
 *
 * - **`entries` changing** catches planning done in the week Meal plan has
 *   loaded, so a dinner planned there is offered here without a round trip.
 * - **Focus** catches everything else, and is why the first trigger is not
 *   enough: `entries` is one loaded *window*, and the next two days are
 *   routinely outside it (or, on a cold launch into Groceries, nothing is
 *   loaded at all). Landing on the list is the moment the strip is read.
 *
 * The window is the shop window the meal-shortfall generator already uses
 * (`mealShortfallLeadDays`), so the strip and the "shop for Tuesday" task it
 * sits above can never disagree about which meals are close enough to shop for.
 * It bounds the *planned* half only: a recipe added straight to the list has no
 * entry and no date, and `shoppedRecipes` finds it through the rows it stamped
 * instead. That half needs no refresh trigger of its own, since those rows are
 * `listRows`, which the caller already re-renders on.
 */
export function useShoppedRecipes(listRows: readonly GroceryItem[]): ShoppedRecipe[] {
  const leadDays = useSettingsStore(s => s.mealShortfallLeadDays);
  const refresh = useMealPlanStore(s => s.refreshShopWindowEntries);
  const windowEntries = useMealPlanStore(useShallow(s => s.shopWindowEntries));
  // The loaded window, purely as a change signal — the entries the strip reads
  // come from the snapshot above, since the window usually doesn't cover the
  // next two days.
  const loadedEntries = useMealPlanStore(useShallow(s => s.entries));
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const items = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));

  // Recomputed every render rather than memoized: it is the *logical* today, so
  // a session left open across the day boundary has to see the new day. A
  // string, so the memo below still short-circuits within one day.
  const todayKey = dayKeyOf(getLogicalToday());

  const run = useCallback(() => { refresh(todayKey, leadDays); }, [refresh, todayKey, leadDays]);
  useEffect(run, [run, loadedEntries]);
  useFocusEffect(run);

  const recipesById = useMemo(() => recipeIndex(recipes), [recipes]);
  const swaps = useMemo(() => standingSwapMap(itemSubs, items), [itemSubs, items]);

  return useMemo(
    () => shoppedRecipes(windowEntries, recipesById, listRows, todayKey, leadDays, swaps),
    [windowEntries, recipesById, listRows, todayKey, leadDays, swaps]
  );
}
