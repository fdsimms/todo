import type { Task, TaskGroup } from '../types';

/**
 * One row of a project's task list: a loose task, or a stack standing in for
 * however many of its members the project holds.
 */
export type ProjectListItem =
  | { type: 'task'; task: Task }
  | { type: 'group'; group: TaskGroup; children: Task[] };

/**
 * A project's task list, with stacked tasks collapsed into a single row.
 *
 * A stack reaches the list one of two ways, and the difference is the whole
 * point of this module:
 *
 * 1. **By membership** — the project holds a task carrying its `groupId`. The
 *    stack takes the slot where the first of its members falls in the
 *    project's own order, the same "a stack holds a slot among loose tasks"
 *    idea `makeCategoryGroups` follows, just without a category to merge
 *    within since this list isn't sectioned.
 * 2. **By `projectId`** — the stack was built on this project's screen and
 *    says so (see `TaskGroup.projectId`). This is what lets a stack sit here
 *    with nothing in it: an outline the user is about to fill in, or one whose
 *    members are all finished. Walking the tasks alone can't find it, because
 *    the walk only ever reaches a stack *through* a task pointing at it.
 *
 * The two overlap constantly and must not double up — a stack homed here that
 * also holds tasks here is found by the walk first, and keeps that slot rather
 * than being appended again below.
 *
 * **An empty stack holds a slot like any other row.** `TaskGroup.sortOrder` is
 * the same number space as `Task.sortOrder` (see the note on that field), which
 * is what the project's order is kept in, so an empty stack is merged in by its
 * own `sortOrder` rather than parked at the end — and can be dragged around
 * like a task, since `slotUpdates` reorders both against each other.
 *
 * The merge only ever *inserts*: rows derived from tasks keep the order they
 * arrived in, so this can't reshuffle a project's list on its own.
 */
export function buildProjectListItems(
  incompleteProjectTasks: Task[],
  groups: TaskGroup[],
  projectId: string,
): ProjectListItem[] {
  const groupById = new Map(groups.map(g => [g.id, g]));
  // Each row paired with the sortOrder it sits at, so the empty stacks below
  // can be merged in against it. A stack found through its members anchors to
  // the first of them, which is the slot it already occupies.
  const anchored: Array<{ anchor: number; item: ProjectListItem }> = [];
  const seenGroups = new Set<string>();

  for (const task of incompleteProjectTasks) {
    if (!task.groupId) {
      anchored.push({ anchor: task.sortOrder, item: { type: 'task', task } });
      continue;
    }
    if (seenGroups.has(task.groupId)) continue;
    seenGroups.add(task.groupId);
    const group = groupById.get(task.groupId);
    // A groupId pointing at nothing: render the task loose rather than
    // dropping it. The stack row is what's missing, not the task.
    if (!group) {
      anchored.push({ anchor: task.sortOrder, item: { type: 'task', task } });
      continue;
    }
    anchored.push({
      anchor: task.sortOrder,
      item: {
        type: 'group',
        group,
        children: incompleteProjectTasks.filter(t => t.groupId === task.groupId),
      },
    });
  }

  const homedEmpty = groups
    .filter(g => g.projectId === projectId && !seenGroups.has(g.id))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const items: ProjectListItem[] = [];
  let next = 0;
  const takeEmptiesUpTo = (limit: number) => {
    while (next < homedEmpty.length && homedEmpty[next].sortOrder <= limit) {
      items.push({ type: 'group', group: homedEmpty[next], children: [] });
      next++;
    }
  };
  for (const row of anchored) {
    takeEmptiesUpTo(row.anchor);
    items.push(row.item);
  }
  takeEmptiesUpTo(Infinity);

  return items;
}
