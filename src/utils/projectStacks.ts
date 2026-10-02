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

/**
 * Where a line goes when it's added right after another one: the order to
 * write, either the page's top-level order (`reorderProjectItems`) or, when
 * the line it follows sits in a section, that section's own order
 * (`reorderGroupChildren`). Null when `afterId` isn't on the page.
 */
export function orderWithInserted(
  items: readonly ProjectListItem[],
  afterId: string,
  newId: string,
): { groupId: null; ids: string[] } | { groupId: string; ids: string[] } | null {
  const top = items.map(item => (item.type === 'group' ? item.group.id : item.task.id));
  const at = items.findIndex(item => item.type === 'task' && item.task.id === afterId);
  if (at >= 0) return { groupId: null, ids: [...top.slice(0, at + 1), newId, ...top.slice(at + 1)] };
  for (const item of items) {
    if (item.type !== 'group') continue;
    const ids = [...item.children].sort((a, b) => a.sortOrder - b.sortOrder).map(t => t.id);
    const i = ids.indexOf(afterId);
    if (i >= 0) return { groupId: item.group.id, ids: [...ids.slice(0, i + 1), newId, ...ids.slice(i + 1)] };
  }
  return null;
}

/**
 * A list narrowed to the lines whose text holds `query` (case and accents
 * ignored). A section stays when its title matches, with all its lines, or
 * when any of its lines do, with just those. An empty query changes nothing.
 */
export function filterProjectListItems(items: readonly ProjectListItem[], query: string): ProjectListItem[] {
  const q = fold(query.trim());
  if (!q) return [...items];
  const hit = (text: string) => fold(text).includes(q);
  const out: ProjectListItem[] = [];
  for (const item of items) {
    if (item.type === 'task') {
      if (hit(item.task.title)) out.push(item);
      continue;
    }
    if (hit(item.group.title)) { out.push(item); continue; }
    const children = item.children.filter(t => hit(t.title));
    if (children.length > 0) out.push({ ...item, children });
  }
  return out;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * The same page sorted A to Z, for a list: the loose lines by title among the
 * slots loose lines hold (a section stays where it is), and each section's own
 * lines by title within it. Case and accents ignored, numbers read as numbers
 * ("Chapter 2" before "Chapter 10"). Answers the two orders to write, top-level
 * ids for `reorderProjectItems` and each section's for `reorderGroupChildren`.
 */
export function alphabeticalPageOrder(items: readonly ProjectListItem[]): {
  top: string[];
  sections: Array<{ groupId: string; ids: string[] }>;
} {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const byTitle = (a: Task, b: Task) => collator.compare(a.title.trim(), b.title.trim());
  const loose = items
    .filter((i): i is { type: 'task'; task: Task } => i.type === 'task')
    .map(i => i.task)
    .sort(byTitle);
  let next = 0;
  const top = items.map(item => (item.type === 'group' ? item.group.id : loose[next++].id));
  const sections = items
    .filter((i): i is { type: 'group'; group: TaskGroup; children: Task[] } => i.type === 'group')
    .filter(i => i.children.length > 1)
    .map(i => ({ groupId: i.group.id, ids: [...i.children].sort(byTitle).map(t => t.id) }));
  return { top, sections };
}

/**
 * A project's tasks in the order its page draws them, flattened: loose tasks
 * and sections merged by their shared order, each section's own tasks in
 * theirs. What "the first open task" means for a project worked in order.
 */
export function projectPageOrder(
  tasks: readonly Task[],
  groups: readonly TaskGroup[],
  projectId: string,
): Task[] {
  const sorted = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  return buildProjectListItems(sorted, [...groups], projectId).flatMap(item =>
    item.type === 'task'
      ? [item.task]
      : [...item.children].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)),
  );
}

/**
 * The project's open tasks as plain text, the way "Copy task names" puts them
 * on the clipboard: one line per task, in the order on screen, each section's
 * title as a heading over its own tasks, and open subtasks indented under the
 * task they belong to. It used to copy the top-level titles alone, which for a
 * list of questions for a doctor dropped both the headings and the follow-ups.
 *
 * `subtasksOf` returns a task's subtasks in any order; they're sorted here.
 * Only this project's own members are copied from a section, since a section
 * can hold tasks filed under other projects.
 */
export function projectCopyText(
  items: readonly ProjectListItem[],
  subtasksOf: (taskId: string) => readonly Task[],
  projectId: string,
): string {
  const lines: string[] = [];
  const pushTask = (task: Task, indent: string) => {
    lines.push(`${indent}${task.title}`);
    [...subtasksOf(task.id)]
      .filter(s => !s.completed)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .forEach(s => lines.push(`${indent}  ${s.title}`));
  };
  items.forEach(item => {
    if (item.type === 'task') {
      pushTask(item.task, '');
      return;
    }
    const members = item.children.filter(t => t.projectId === projectId);
    if (members.length === 0) return;
    if (lines.length > 0) lines.push('');
    lines.push(item.group.title.trim() || 'Untitled section');
    members.forEach(task => pushTask(task, '  '));
    lines.push('');
  });
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}
