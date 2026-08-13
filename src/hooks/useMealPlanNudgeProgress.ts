import { useCallback, useEffect, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useTaskStore } from '../store/useTaskStore';
import { liveGeneratedTasksOfKind } from '../utils/generatedTasks';
import { mealPlanNudgeDayKey } from '../utils/mealPlanNudge';

/**
 * Keeps `useMealPlanStore.plannedSlotCounts` in step with whatever the weekly
 * nudge's live tasks are asking about, so their rows can show "2/3 planned"
 * (#1585).
 *
 * **The counts are pulled here rather than pushed by the writes**, which is the
 * one structural decision in this file. The alternative was a line in each of
 * `useMealPlanStore`'s ~15 mutators; that's the shape CLAUDE.md records failing
 * twice already (the stack's `completedAt` stamp needed clearing at four call
 * sites and still missed one), and it would still miss the writes that don't go
 * through a mutator at all — a restored backup, a demo-mode swap, a pull from
 * another device. Refreshing where the number is about to be *read* covers all
 * of them for one query.
 *
 * Two triggers, because there are two ways the answer goes stale:
 *
 * - **`entries` changing** catches planning done in the week Meal plan has
 *   loaded, which is the common case — plan Tuesday's dinner, come back to
 *   Today, the row has moved to 3/3 without a round trip through anything.
 * - **Focus** catches everything else, and is why it's needed even though the
 *   first trigger looks sufficient. `entries` is a single loaded *window*: a
 *   meal planned onto a day outside it (a recipe planned from the recipe box, a
 *   week copied forward, a sync) changes nothing this component subscribes to.
 *   Landing back on the screen is the moment the number is looked at.
 *
 * Cheap enough to run on both: one indexed range read over seven days, and
 * `refreshPlannedSlotCounts` returns without touching state when the counts
 * come back the same — so an unrelated meal moving doesn't re-render a stack of
 * seven rows.
 */
export function useMealPlanNudgeProgress(): void {
  const refresh = useMealPlanStore(s => s.refreshPlannedSlotCounts);
  // The window, purely as a change signal — the counts themselves come from the
  // range read, since the window usually doesn't cover the week being nudged.
  const entries = useMealPlanStore(useShallow(s => s.entries));
  const tasks = useTaskStore(useShallow(s => s.tasks));

  const dayKeys = useMemo(
    () =>
      liveGeneratedTasksOfKind(tasks, 'mealPlanNudge')
        .map(mealPlanNudgeDayKey)
        .filter((key): key is string => !!key),
    [tasks]
  );

  // Depend on the contents rather than the array, which is rebuilt on every
  // task-store change — otherwise this re-queries on every completion, edit and
  // reorder anywhere in the app.
  const signature = dayKeys.join(',');

  const run = useCallback(() => {
    refresh(signature ? signature.split(',') : []);
  }, [signature, refresh]);

  useEffect(run, [run, entries]);
  useFocusEffect(run);
}
