import type { Task } from '../types';

export type CategoryListItem =
  | { type: 'header'; label: string }
  | { type: 'task'; task: Task };

const UNCATEGORIZED = '';

/** Header label for tasks with no category. */
export const OTHER_LABEL = 'Uncategorized';
export const LATER_TODAY_LABEL = 'Later Today';

/**
 * Group tasks into category sections for the Today list.
 *
 * Groups render in a FIXED order so dragging tasks around can never reorder
 * the categories themselves: the Uncategorized group first (when it has
 * tasks), then named categories in `categoryOrder`, then any categories
 * present on tasks but missing from `categoryOrder`, alphabetically.
 * Uncategorized sits first so that dropping a task above every section (which
 * uncategorizes it — see resolveDrop) renders it right where it was dropped
 * instead of teleporting it down the list.
 *
 * Every group — including the uncategorized group — always gets a header. That
 * guarantees a task is never rendered in a header-less region and the headings
 * can't all disappear (e.g. once every task is uncategorized), which were both
 * reachable broken states before.
 */
export function makeCategoryGroups(
  tasks: Task[],
  categoryOrder: string[] = [],
): CategoryListItem[] {
  const byCategory = new Map<string, Task[]>();
  tasks.forEach(task => {
    const key = task.category ?? UNCATEGORIZED;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(task);
  });

  const order: string[] = [];
  if (byCategory.has(UNCATEGORIZED)) order.push(UNCATEGORIZED);
  categoryOrder.forEach(cat => {
    if (byCategory.has(cat)) order.push(cat);
  });
  Array.from(byCategory.keys())
    .filter(cat => cat !== UNCATEGORIZED && !order.includes(cat))
    .sort()
    .forEach(cat => order.push(cat));

  const items: CategoryListItem[] = [];
  order.forEach(key => {
    items.push({ type: 'header', label: key === UNCATEGORIZED ? OTHER_LABEL : key });
    byCategory.get(key)!.forEach(task => items.push({ type: 'task', task }));
  });
  return items;
}

export interface DropResolution {
  /** Task ids in their new top-to-bottom order (for sortOrder persistence). */
  taskIds: string[];
  /** Tasks whose category changed because of where they were dropped. */
  categoryUpdates: Array<{ id: string; category: string | null }>;
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
 *   - A task above the FIRST header becomes uncategorized: dragging a task to
 *     the very top of the list deliberately clears its category, and the
 *     Uncategorized group renders first so it stays where it was dropped.
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
  const orderedTasks: Task[] = [];
  const upcomingOrdered: Task[] = [];
  let currentSection: string | null = null;
  let inLaterToday = false;

  for (const item of reordered) {
    if (item.type === 'header') {
      if (item.label === LATER_TODAY_LABEL) {
        inLaterToday = true;
      } else {
        currentSection = item.label === OTHER_LABEL ? null : item.label;
      }
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

  const settled: CategoryListItem[] = makeCategoryGroups(orderedTasks, opts.categoryOrder);
  if (opts.showUpcoming && upcomingOrdered.length > 0) {
    settled.push({ type: 'header', label: LATER_TODAY_LABEL });
    upcomingOrdered.forEach(task => settled.push({ type: 'task', task }));
  }

  return { taskIds, categoryUpdates, settled };
}
