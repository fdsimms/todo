import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { MealPlanEntry, MealSlot, Recipe } from '../types';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useTaskStore } from '../store/useTaskStore';
import { recipeIndex } from '../utils/mealPlan';
import { dayKeyToDate } from '../utils/dateUtils';
import { prepTaskDraftsForMeal } from '../utils/recipeUtils';
import { haptics } from '../utils/haptics';

/**
 * Planning a recipe onto a night, and the prep-task offer that follows.
 *
 * Extracted from MealPlanScreen when the same action grew three more entry
 * points — the recipe detail screen, a recipe row, and the "Cook again" shelf
 * (#1360's audit, MP-11). The offer is the reason this is shared rather than
 * copied: it decides *when* a meal's prep steps are worth asking about, and
 * four copies of that judgement would drift the first time one of them moved.
 *
 * Deliberately not a store action. Nothing here writes anything a store
 * doesn't already own — it composes `planMeal` and `addTask` — and the alert
 * in the middle is a screen concern that has no business inside a Zustand
 * store, the same split `dripStalledProjects` and `findProjectStalls` keep.
 */
export function usePlanMeal() {
  const planMeal = useMealPlanStore(s => s.planMeal);
  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const addTask = useTaskStore(s => s.addTask);
  const recipesById = useMemo(() => recipeIndex(recipes), [recipes]);

  /**
   * The ask at plan time. Prep steps are the part of a recipe that has to
   * happen before the day it's cooked — "get the beef out of the freezer" is no
   * use once you're at the hob — so the moment the meal lands on a date is both
   * the first moment those days can be worked out and the last one where
   * they're all still ahead of you.
   *
   * An offer, not something planning does by itself: plenty of prep steps are
   * ones the user does from memory and doesn't want a task for. A meal with no
   * prep steps — and a leftover or a typed-in title, which have no recipe to
   * have any — asks nothing at all, so most planning is unchanged.
   *
   * **Every caller must have dismissed its own sheet first.** This raises a
   * native alert, and presenting one from underneath a live `Modal` is the
   * "already presenting" case that cost RecipePickerSheet its prep-task offer
   * (see that file's `pick`).
   *
   * `onDone`, when given, fires once this entry's offer is fully resolved —
   * shown and answered, or skipped outright because there was nothing to ask.
   * Only `offerPrepTasksForEach` passes one; a single-entry caller has nothing
   * to chain onto and can leave it off.
   */
  const offerPrepTasks = useCallback((entry: MealPlanEntry, onDone?: () => void) => {
    const recipe = entry.recipeId ? recipesById.get(entry.recipeId) : undefined;
    if (!recipe) { onDone?.(); return; }
    // A freshly planned entry has never had a choice made against it, so this
    // resolves to the defaults — same as leaving `resolution` off.
    const drafts = prepTaskDraftsForMeal(
      recipe, recipesById, dayKeyToDate(entry.date), { chosen: entry.recipeChoices }
    );
    if (drafts.length === 0) { onDone?.(); return; }
    const one = drafts.length === 1;
    Alert.alert(
      'Add prep tasks?',
      `${recipe.name} has ${drafts.length} prep step${one ? '' : 's'}. Add ${one ? 'it' : 'them'} to your tasks?`,
      [
        { text: 'Not now', style: 'cancel', onPress: onDone },
        {
          text: 'Add',
          onPress: () => {
            drafts.forEach(({ title, dueDate, reminderTime }) => addTask({ title, dueDate, reminderTime }));
            haptics.success();
            onDone?.();
          },
        },
      ]
    );
  }, [recipesById, addTask]);

  /**
   * The same offer, over a batch planned in one sitting — RecipePickerSheet's
   * multi-pick session (#1384) is the one caller today. A native alert can't
   * stack on top of another one, so each entry's offer only opens once the
   * one before it (shown and answered, or skipped) is out of the way, chained
   * through `offerPrepTasks`'s own `onDone`.
   */
  const offerPrepTasksForEach = useCallback((entries: readonly MealPlanEntry[]) => {
    const queue = [...entries];
    const next = () => {
      const entry = queue.shift();
      if (!entry) return;
      offerPrepTasks(entry, next);
    };
    next();
  }, [offerPrepTasks]);

  /**
   * Puts a recipe on a night. Returns the entry, or null if the store refused
   * it (a recipe whose name cleans to nothing).
   *
   * Does *not* offer prep tasks itself — the caller decides when its own sheet
   * is out of the way, and some callers plan several meals in a row before any
   * of that is appropriate.
   */
  const planRecipe = useCallback(
    (recipe: Recipe, dateKey: string, slot: MealSlot): MealPlanEntry | null =>
      planMeal({ date: dateKey, slot, recipeId: recipe.id, title: recipe.name }),
    [planMeal]
  );

  return { planRecipe, offerPrepTasks, offerPrepTasksForEach };
}
