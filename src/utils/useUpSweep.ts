import type { GroceryItem, Leftover, Task } from '../types';
import { generatedSourceOf } from './generatedTasks';
import { useUpDeadlineDay, useUpTaskFields, wantsUseUpTask } from './groceryExpiry';
import { liveExpiresAt } from './groceryShelfLife';
import { liveKeepUntil } from './leftovers';

/** One source the use-up sweep visits, by the generator kind that owns its task. */
export type UseUpSweepSource =
  | { kind: 'leftoverUseUp'; id: string }
  | { kind: 'groceryUseUp'; id: string };

/**
 * The catch-up sweep over both kinds of use-up task, grocery and leftover, in
 * the order they should claim a slot under the shared cap (#2924).
 *
 * `reconcileGeneratedTask` declines a new use-up task once `useUpTaskCap` live
 * ones exist, and says the declined source gets its task from "the next
 * reconcile that finds room". For a leftover that was the foreground sweep.
 * A grocery item had nothing: every grocery reconcile runs off a mutation of
 * that one item, so the fourth perishable from a big shop under a cap of 3
 * never got a task, even after the first three were done, until something
 * happened to edit its row. And the slots went to whichever item happened to
 * be reconciled first, while the setting's hint promised "closest date first".
 *
 * So this is one list, both kinds, soonest live use-by day first (a grocery
 * item's `liveExpiresAt`, a leftover's `liveKeepUntil`), for one sweep to walk
 * in order. It never evicts: a task already showing keeps its slot, which is
 * `reconcileGeneratedTask`'s rule and stays it. It only decides who claims a
 * slot that is genuinely open.
 *
 * **What it lists, per kind:**
 *
 * - **Every live leftover**, exactly the set `reconcileAllLeftoverTasks` has
 *   always swept, so replacing that sweep with this one changes nothing about
 *   a leftover but its place in the queue.
 * - **Only the grocery items that want a task and haven't already had one for
 *   this use-by day**, plus, ahead of everything, any item still holding a
 *   live task it no longer wants, so the reconcile can drop it. Not every catalog row, since a catalog runs to hundreds
 *   and nearly all of them have no date. And not an item whose task for its
 *   current use-by day was already finished (completed or archived): only a
 *   *live* task blocks a new one on a mutation (`reconcileUseUpTask`), which is
 *   right for a mutation, because re-dating the row means a new packet. A
 *   sweep that ran on every foreground with that rule would hand "Use up
 *   spinach" straight back after it was ticked off and the resolve sheet was
 *   dismissed. The task's `deadline` is the use-by day it was derived from
 *   (see `useUpTaskDrift`), which is how "this packet's task" is told apart
 *   from last month's.
 *
 * Ties keep the order given: leftovers first (already soonest-first by
 * `sortLeftovers`), then groceries in catalog order. A source with no live day
 * (a frozen leftover) goes last, since it can't be claiming a slot anyway.
 */
export function useUpSweepOrder(
  items: readonly GroceryItem[],
  leftovers: readonly Leftover[],
  tasks: readonly Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'archived' | 'deadline'>[],
  groceryUseUpTasks: boolean
): UseUpSweepSource[] {
  const finished = new Set<string>();
  const live = new Set<string>();
  for (const task of tasks) {
    if (!task.completed && !task.archived) {
      const itemId = generatedSourceOf(task, 'groceryUseUp');
      if (itemId) live.add(itemId);
      continue;
    }
    const itemId = generatedSourceOf(task, 'groceryUseUp');
    const day = useUpDeadlineDay(task.deadline);
    if (itemId && day) finished.add(`${itemId}\u0000${day}`);
  }

  // An item still holding a live task it no longer wants (marked out of it
  // before that ended its task) is visited first, so the reconcile drops the
  // task and the slot it frees goes to whoever is next in the queue.
  const stale: UseUpSweepSource[] = [];
  const queue: Array<{ source: UseUpSweepSource; day: string | null; index: number }> = [];
  for (const leftover of leftovers) {
    if (leftover.finishedAt) continue;
    queue.push({
      source: { kind: 'leftoverUseUp', id: leftover.id },
      day: liveKeepUntil(leftover),
      index: queue.length,
    });
  }
  for (const item of items) {
    if (!wantsUseUpTask(item, groceryUseUpTasks)) {
      if (live.has(item.id)) stale.push({ kind: 'groceryUseUp', id: item.id });
      continue;
    }
    // wantsUseUpTask has already required a live day, so `expiresAt` is set.
    const day = useUpDeadlineDay(useUpTaskFields(item, 0).deadline);
    if (finished.has(`${item.id}\u0000${day}`)) continue;
    queue.push({
      source: { kind: 'groceryUseUp', id: item.id },
      day: liveExpiresAt(item),
      index: queue.length,
    });
  }

  return [...stale, ...queue
    .sort((a, b) => {
      if (a.day !== b.day) {
        if (a.day === null) return 1;
        if (b.day === null) return -1;
        return a.day.localeCompare(b.day);
      }
      return a.index - b.index;
    })
    .map(entry => entry.source)];
}
