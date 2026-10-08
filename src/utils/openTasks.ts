import type { Task } from '../types';

const openTasksCache = new WeakMap<readonly Task[], Task[]>();

/**
 * The rows of `tasks` that aren't completed, in their original order, computed
 * once per task array.
 *
 * Every completion leaves its row behind and completed rows are kept forever by
 * default, so on a phone that has been used for a few months completed history
 * is most of the array (nine rows in ten, and growing every day), while every
 * list lens (Today, Later, Inbox, Unscheduled, Waiting, Pinned, Expired) only
 * ever shows open ones. Those lenses ran their full gate over every row, on
 * every store write and several times per render. Filtering on `completed`
 * first is the same answer, since each of those gates is false for a completed
 * row, and the filter itself is shared across all of them.
 *
 * Keyed on the array's identity, which is sound because the store never
 * mutates it or a task in place: every write produces a new array.
 */
export function openTasksOf(tasks: readonly Task[]): Task[] {
  let open = openTasksCache.get(tasks);
  if (!open) {
    open = tasks.filter(t => !t.completed);
    openTasksCache.set(tasks, open);
  }
  return open;
}
