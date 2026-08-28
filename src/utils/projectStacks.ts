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
 * **A stack sits where its own `sortOrder` puts it, never where its members
 * do.** `TaskGroup.sortOrder` is the same number space as `Task.sortOrder` (see
 * the note on that field), which is what a project's order is kept in, so a
 * stack holds a slot in that order exactly like a loose task and is merged in
 * by it.
 *
 * Reading the position off the first member instead is what this used to do,
 * and it was wrong in a way that only showed up once a stack could be empty. A
 * stack member's `sortOrder` is its *within-stack* 1..K order — that's what
 * `groupTasks`, `addExistingToGroup` and `addNewGroupedTask` all write — while
 * a loose task's is `max(every task) + 1` from `addTask`, in the hundreds. So
 * members always sorted before every loose task and a stack was pinned to the
 * top of the project whatever the user dragged, while an empty stack, having
 * only its own honest slot, sat where it was put. The two placements were
 * different regimes, and a stack visibly jumped to the top the moment it took
 * its first member. Positioning every stack by the group means a drag sticks,
 * and means a stack does not move when its membership changes.
 *
 * The merge only ever *inserts*: the loose-task rows keep the order they
 * arrived in, so this can't reshuffle a project's list on its own.
 */
export function buildProjectListItems(
  incompleteProjectTasks: Task[],
  groups: TaskGroup[],
  projectId: string,
): ProjectListItem[] {
  const groupById = new Map(groups.map(g => [g.id, g]));
  const looseRows: Array<{ anchor: number; task: Task }> = [];
  const childrenByGroup = new Map<string, Task[]>();

  for (const task of incompleteProjectTasks) {
    // A groupId pointing at nothing: render the task loose rather than dropping
    // it. The stack row is what's missing, not the task.
    if (!task.groupId || !groupById.has(task.groupId)) {
      looseRows.push({ anchor: task.sortOrder, task });
      continue;
    }
    const list = childrenByGroup.get(task.groupId);
    if (list) list.push(task);
    else childrenByGroup.set(task.groupId, [task]);
  }

  // Every stack this project shows: the ones holding tasks here, and the ones
  // homed here with none. A stack homed here that also holds tasks here is in
  // the first set already, so `childrenByGroup` is what keeps it out of the
  // second rather than appearing twice.
  const groupRows = [
    ...[...childrenByGroup].map(([id, children]) => ({ group: groupById.get(id)!, children })),
    ...groups
      .filter(g => g.projectId === projectId && !childrenByGroup.has(g.id))
      .map(g => ({ group: g, children: [] as Task[] })),
  ].sort((a, b) => a.group.sortOrder - b.group.sortOrder);

  const items: ProjectListItem[] = [];
  let next = 0;
  const takeGroupsUpTo = (limit: number) => {
    while (next < groupRows.length && groupRows[next].group.sortOrder <= limit) {
      items.push({ type: 'group', ...groupRows[next] });
      next++;
    }
  };
  for (const row of looseRows) {
    takeGroupsUpTo(row.anchor);
    items.push({ type: 'task', task: row.task });
  }
  takeGroupsUpTo(Infinity);

  return items;
}
