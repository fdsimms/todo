import { useMemo } from 'react';
import { useTaskStore } from '../store/useTaskStore';
import { useTaskGroupStore } from '../store/useTaskGroupStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useTemplateStore } from '../store/useTemplateStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useSettingsStore } from '../store/useSettingsStore';
import type { TipSignals } from '../utils/tips';

/**
 * Builds the `TipSignals` snapshot a tip's `when` is tested against.
 *
 * **Only mount this once there is a tip that could use it.** It subscribes to
 * eight stores and walks the task list and the grocery catalog, which is a
 * silly amount of work to do on the Groceries screen so that a tip can decline
 * to show. `TipHost` does the cheap half of the decision first (is there an
 * unseen tip for this screen at all, and is today's slot free) and only then
 * mounts the child that calls this, so a screen whose tips are all dismissed
 * pays nothing — which, after the first few weeks, is every screen.
 *
 * The two array subscriptions plus a `useMemo` are deliberate in place of one
 * counting selector per signal: a selector returning `tasks.filter(...).length`
 * re-runs on every store write, and nine of them means nine passes over the
 * task list per write. One pass, memoized on the array identity, is the same
 * information for a ninth of the work.
 */
export function useTipSignals(): TipSignals {
  const tasks = useTaskStore(s => s.tasks);
  const tagRegistry = useTaskStore(s => s.tagRegistry);
  const groups = useTaskGroupStore(s => s.groups);
  const categories = useCategoryStore(s => s.categories);
  const projects = useProjectStore(s => s.projects);
  const templates = useTemplateStore(s => s.templates);
  const groceryItems = useGroceryStore(s => s.items);
  const shops = useGroceryStore(s => s.shops);
  const recipes = useRecipeStore(s => s.recipes);
  const mealEntries = useMealPlanStore(s => s.entries);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const hasApiKey = useSettingsStore(s => s.anthropicApiKey.length > 0);

  const taskCounts = useMemo(() => {
    let taskCount = 0;
    let completedCount = 0;
    let pinnedCount = 0;
    let recurringCount = 0;
    for (const task of tasks) {
      if (task.completed) {
        completedCount++;
        continue;
      }
      // Subtasks are excluded throughout: every count here is meant to read as
      // "how much is in this list", and the top-level selectors are what the
      // user is actually looking at.
      if (task.parentId !== null) continue;
      taskCount++;
      if (task.pinned) pinnedCount++;
      if (task.recurrenceType !== 'none') recurringCount++;
    }
    return { taskCount, completedCount, pinnedCount, recurringCount };
  }, [tasks]);

  const groceryCounts = useMemo(() => {
    let groceryItemCount = 0;
    let catalogCount = 0;
    let purchasedItemCount = 0;
    for (const item of groceryItems) {
      if (item.onList) groceryItemCount++;
      // Every row is a catalog row now — see the note in `types/index.ts` where
      // `inCatalog` used to be. Counting only the off-list ones would make this
      // *shrink* as the list fills, which is the opposite of the "your catalog
      // is getting big" signal the tips gated on it are looking for.
      catalogCount++;
      if (item.purchaseCount > 0) purchasedItemCount++;
    }
    return { groceryItemCount, catalogCount, purchasedItemCount };
  }, [groceryItems]);

  return useMemo(
    () => ({
      ...taskCounts,
      ...groceryCounts,
      stackCount: groups.length,
      categoryCount: categories.length,
      projectCount: projects.length,
      templateCount: templates.length,
      tagCount: tagRegistry.length,
      shopCount: shops.length,
      recipeCount: recipes.length,
      plannedMealCount: mealEntries.length,
      kitchenEnabled,
      hasApiKey,
    }),
    [
      taskCounts, groceryCounts, groups, categories, projects, templates,
      tagRegistry, shops, recipes, mealEntries, kitchenEnabled, hasApiKey,
    ]
  );
}
