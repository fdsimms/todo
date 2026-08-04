import type { Task, TaskGroup } from '../types';

export type CategoryListItem =
  | { type: 'header'; label: string }
  | { type: 'task'; task: Task }
  | { type: 'group'; group: TaskGroup; children: Task[] };

const UNCATEGORIZED = '';

export const LATER_TODAY_LABEL = 'Later Today';

/**
 * Group tasks into category sections for the Today list.
 *
 * Uncategorized tasks render first as a HEADER-LESS group at the top; named
 * categories follow, each with a header, in a FIXED order so dragging tasks
 * around can never reorder the categories themselves (the order is
 * `categoryOrder`, then any leftover categories alphabetically).
 *
 * There is intentionally no "Uncategorized" header: a task with no category is
 * simply one of the loose items at the top, which is also what a task dragged
 * above every section becomes (see resolveDrop). That keeps the top of the
 * list from having a header a task can be stranded "above".
 */
// Task groups (collapsible labels, see TaskGroup) are a third, optional
// input: each group renders as a 'group' item at the START of its category
// section, before that category's plain tasks. Passing groups here (rather
// than as a separate post-processing pass over the header+task output) is
// what lets a category made up ENTIRELY of a group with no loose tasks still
// get a header — the header-selection logic below already needs to know
// about every category's content once, so it might as well know about
// groups too. resolveDrop/resolveCategoryReorder/categoryHeaderRange never
// pass a `groups` argument (it defaults to none), so their own internal
// makeCategoryGroups calls keep producing header+task-only output — groups
// aren't draggable in v1 (see CLAUDE.md's ReorderableList fragility note),
// and this keeps that whole call path exactly as ignorant of groups as
// before.
export function makeCategoryGroups(
  tasks: Task[],
  categoryOrder: string[] = [],
  groups: { group: TaskGroup; children: Task[] }[] = [],
): CategoryListItem[] {
  const byCategory = new Map<string, Task[]>();
  tasks.forEach(task => {
    const key = task.category ?? UNCATEGORIZED;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(task);
  });

  const groupsByCategory = new Map<string, { group: TaskGroup; children: Task[] }[]>();
  groups.forEach(g => {
    const key = g.group.category ?? UNCATEGORIZED;
    if (!groupsByCategory.has(key)) groupsByCategory.set(key, []);
    groupsByCategory.get(key)!.push(g);
  });
  groupsByCategory.forEach(list => list.sort((a, b) => a.group.sortOrder - b.group.sortOrder));

  const hasContent = (key: string) => byCategory.has(key) || groupsByCategory.has(key);

  const order: string[] = [];
  if (hasContent(UNCATEGORIZED)) order.push(UNCATEGORIZED);
  categoryOrder.forEach(cat => {
    if (hasContent(cat)) order.push(cat);
  });
  Array.from(new Set([...byCategory.keys(), ...groupsByCategory.keys()]))
    .filter(cat => cat !== UNCATEGORIZED && !order.includes(cat))
    .sort()
    .forEach(cat => order.push(cat));

  const items: CategoryListItem[] = [];
  order.forEach(key => {
    if (key !== UNCATEGORIZED) items.push({ type: 'header', label: key });
    (groupsByCategory.get(key) ?? []).forEach(g => items.push({ type: 'group', group: g.group, children: g.children }));
    (byCategory.get(key) ?? []).forEach(task => items.push({ type: 'task', task }));
  });
  return items;
}

export interface DropResolution {
  /** Task ids in their new top-to-bottom order (for sortOrder persistence). */
  taskIds: string[];
  /** Tasks whose category changed because of where they were dropped. */
  categoryUpdates: Array<{ id: string; category: string | null }>;
  /**
   * Task groups dragged as a whole block (see TodayScreen's group `onDrag`):
   * their new category (nearest header above, same rule as tasks) and their
   * new sortOrder relative to the other groups that ended up in that same
   * category, renumbered from 1 in drop order.
   */
  groupUpdates: Array<{ id: string; category: string | null; sortOrder: number }>;
  /** The final, regrouped layout to show immediately after the drop. */
  settled: CategoryListItem[];
}

/**
 * Resolve a drag-and-drop drop on the Today list.
 *
 * Given the raw reordered list of headers + tasks that the drag gesture hands
 * back, work out (a) the new task order, (b) which tasks changed category, and
 * (c) the final grouped layout to render.
 *
 * Category rules — a task adopts the category of the nearest section header
 * above it:
 *   - A task above every named header becomes uncategorized (the loose group
 *     at the top): dragging a task there deliberately clears its category.
 *   - The "Later Today" header is not a category; upcoming tasks under it keep
 *     their own category and stay in their own section.
 *
 * The returned `settled` layout is rebuilt with makeCategoryGroups (using the
 * same `categoryOrder`) so it exactly matches what the store-derived list will
 * recompute to, keeping the post-drop reconcile a structural no-op.
 */
export function resolveDrop(
  reordered: CategoryListItem[],
  opts: {
    isUpcoming: (id: string) => boolean;
    showUpcoming: boolean;
    categoryOrder?: string[];
  },
): DropResolution {
  const taskIds: string[] = [];
  const categoryUpdates: Array<{ id: string; category: string | null }> = [];
  const groupUpdates: Array<{ id: string; category: string | null; sortOrder: number }> = [];
  const orderedTasks: Task[] = [];
  const upcomingOrdered: Task[] = [];
  // Groups dropped, in order, paired with their (possibly updated) new
  // category — used both to build groupUpdates (sortOrder renumbered per
  // category below) and to rebuild `settled` with the same groups.
  const orderedGroups: { group: TaskGroup; children: Task[]; category: string | null }[] = [];
  let currentSection: string | null = null;
  let inLaterToday = false;

  for (const item of reordered) {
    if (item.type === 'header') {
      if (item.label === LATER_TODAY_LABEL) {
        inLaterToday = true;
      } else {
        currentSection = item.label;
      }
      continue;
    }
    if (item.type === 'group') {
      // Groups never appear inside "Later Today" (that section is rendered
      // by a separate, non-draggable path — see TodayScreen), so they always
      // adopt the nearest real header above, same rule as a task.
      const target = currentSection;
      orderedGroups.push({ group: item.group, children: item.children, category: target });
      continue;
    }
    taskIds.push(item.task.id);
    const isUpcoming = opts.isUpcoming(item.task.id);
    // Upcoming/"Later Today" tasks keep their own category; everything else
    // adopts its section's (null above the first header = uncategorize).
    const target: string | null =
      inLaterToday || isUpcoming ? item.task.category : currentSection;
    const task = target === item.task.category ? item.task : { ...item.task, category: target };
    if (target !== item.task.category) {
      categoryUpdates.push({ id: item.task.id, category: target });
    }
    (isUpcoming ? upcomingOrdered : orderedTasks).push(task);
  }

  // Renumber sortOrder per resulting category, in drop order, so relative
  // group order persists without colliding with another category's numbers
  // (each category's groups are only ever compared against each other).
  const perCategoryCount = new Map<string | null, number>();
  const updatedGroups: { group: TaskGroup; children: Task[] }[] = orderedGroups.map(({ group, children, category }) => {
    const nextOrder = (perCategoryCount.get(category) ?? 0) + 1;
    perCategoryCount.set(category, nextOrder);
    if (category !== group.category || nextOrder !== group.sortOrder) {
      groupUpdates.push({ id: group.id, category, sortOrder: nextOrder });
    }
    return { group: { ...group, category, sortOrder: nextOrder }, children };
  });

  const settled: CategoryListItem[] = makeCategoryGroups(orderedTasks, opts.categoryOrder, updatedGroups);
  if (opts.showUpcoming && upcomingOrdered.length > 0) {
    settled.push({ type: 'header', label: LATER_TODAY_LABEL });
    upcomingOrdered.forEach(task => settled.push({ type: 'task', task }));
  }

  return { taskIds, categoryUpdates, groupUpdates, settled };
}

/**
 * Inclusive [min, max] index range a category header may be dragged across on
 * the Today list, so it can only swap positions with other category headers
 * — never land above the header-less uncategorized group at the top, nor
 * below into the trailing "Later Today" section.
 *
 * Returns null if there are fewer than two headers to reorder.
 */
export function categoryHeaderRange(
  data: Array<{ type: string; label?: string }>,
): [number, number] | null {
  const headerIndices = data
    .map((item, i) => (item.type === 'header' && item.label !== LATER_TODAY_LABEL ? i : -1))
    .filter(i => i >= 0);
  if (headerIndices.length === 0) return null;
  return [headerIndices[0], headerIndices[headerIndices.length - 1]];
}

export interface CategoryReorderResolution {
  /** Category names in their new top-to-bottom order (for reorderCategories). */
  categoryOrder: string[];
  /** The final, regrouped layout to show immediately after the drop. */
  settled: CategoryListItem[];
}

/**
 * Resolve a category-header drag on the Today list: unlike resolveDrop (which
 * moves tasks between sections), this only changes the ORDER of the sections
 * themselves — no task ever changes category here.
 *
 * The dragged header's raw new position doesn't matter beyond that: since
 * `dragRange` (via categoryHeaderRange) already confines it to the header
 * run, and tasks are regrouped by their own (untouched) category regardless
 * of where they momentarily sit in `reordered`, reading off the header
 * sequence is enough to recover the new category order.
 *
 * Only categories with at least one *visible* task today get a header to
 * drag, so `fullCategoryOrder` (the complete, previously-known order) is
 * threaded through and used as the base: categories currently absent from
 * Today keep their existing relative position, and only the ones that were
 * actually dragged adopt the new sequence. Without this, persisting just the
 * visible subset's order would silently reshuffle every other category's
 * sortOrder too.
 */
export function resolveCategoryReorder(
  reordered: CategoryListItem[],
  opts: { isUpcoming: (id: string) => boolean; showUpcoming: boolean; fullCategoryOrder?: string[] },
): CategoryReorderResolution {
  const draggedOrder: string[] = [];
  const mainTasks: Task[] = [];
  const upcomingTasks: Task[] = [];

  for (const item of reordered) {
    if (item.type === 'header') {
      if (item.label !== LATER_TODAY_LABEL) draggedOrder.push(item.label);
      continue;
    }
    // See the matching note in resolveDrop — groups never actually reach
    // this function.
    if (item.type === 'group') continue;
    (opts.isUpcoming(item.task.id) ? upcomingTasks : mainTasks).push(item.task);
  }

  const draggedSet = new Set(draggedOrder);
  const queue = [...draggedOrder];
  const base = opts.fullCategoryOrder ?? draggedOrder;
  const categoryOrder = base.map(name => (draggedSet.has(name) ? queue.shift()! : name));
  // Any dragged category missing from fullCategoryOrder (shouldn't normally
  // happen) still needs to be persisted, so tack it on at the end.
  categoryOrder.push(...queue);

  const settled = makeCategoryGroups(mainTasks, categoryOrder);
  if (opts.showUpcoming && upcomingTasks.length > 0) {
    settled.push({ type: 'header', label: LATER_TODAY_LABEL });
    upcomingTasks.forEach(task => settled.push({ type: 'task', task }));
  }

  return { categoryOrder, settled };
}

export type LaterListItem =
  | { type: 'header'; label: string; key: string }
  | { type: 'task'; task: Task; key: string };

/**
 * Flatten Later-view sections (grouped by visibility date/time-segment) into
 * a single header+task list for ReorderableList.
 *
 * A task with multiple timeSegments appears once per matching section, so the
 * same task id can occur more than once — each occurrence after the first
 * gets a suffixed key to keep list keys unique.
 */
export function flattenLaterSections(sections: { title: string; data: Task[] }[]): LaterListItem[] {
  const items: LaterListItem[] = [];
  const seen = new Map<string, number>();
  sections.forEach(section => {
    items.push({ type: 'header', label: section.title, key: `h-${section.title}` });
    section.data.forEach(task => {
      const count = (seen.get(task.id) ?? 0) + 1;
      seen.set(task.id, count);
      items.push({ type: 'task', task, key: count === 1 ? task.id : `${task.id}-${count}` });
    });
  });
  return items;
}

export const isLaterHeader = (item: LaterListItem): boolean => item.type === 'header';

/** Task ids in flattened order, deduped (a multi-segment task keeps its first position). */
export function laterTaskOrder(items: LaterListItem[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const item of items) {
    if (item.type !== 'task' || seen.has(item.task.id)) continue;
    seen.add(item.task.id);
    ids.push(item.task.id);
  }
  return ids;
}
