import type { Task } from '../types';

export type CategoryListItem =
  | { type: 'header'; label: string }
  | { type: 'task'; task: Task };

const UNCATEGORIZED = '';

/**
 * Group tasks into category sections for the Today list.
 *
 * Each group is emitted in the order its category first appears in the
 * incoming (sortOrder-ordered) list — including the uncategorized "Other"
 * group. This keeps the displayed order in sync with the drag order: a task
 * dragged above a named section stays where it was dropped instead of snapping
 * back down, because group order follows task order rather than forcing
 * uncategorized tasks to the bottom.
 *
 * The "Other" header is only emitted when there's at least one named category
 * to distinguish it from; a list with no categories renders as a plain,
 * header-less list.
 */
export function makeCategoryGroups(tasks: Task[]): CategoryListItem[] {
  const order: string[] = [];
  const byCategory = new Map<string, Task[]>();
  tasks.forEach(task => {
    const key = task.category ?? UNCATEGORIZED;
    if (!byCategory.has(key)) {
      byCategory.set(key, []);
      order.push(key);
    }
    byCategory.get(key)!.push(task);
  });

  const hasNamedCategory = order.some(key => key !== UNCATEGORIZED);
  const items: CategoryListItem[] = [];
  order.forEach(key => {
    if (key === UNCATEGORIZED) {
      if (hasNamedCategory) items.push({ type: 'header', label: 'Other' });
    } else {
      items.push({ type: 'header', label: key });
    }
    byCategory.get(key)!.forEach(task => items.push({ type: 'task', task }));
  });
  return items;
}

export const LATER_TODAY_LABEL = 'Later Today';
export const OTHER_LABEL = 'Other';

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
 * Given the raw reordered list of headers + tasks that the drag library hands
 * back, work out (a) the new task order, (b) which tasks changed category, and
 * (c) the final grouped layout to render.
 *
 * Category rules — a task adopts the category of the nearest section header
 * above it, with two deliberate exceptions that keep dragging predictable:
 *   - Tasks above the first header keep their own category, so dragging a task
 *     to the very top doesn't spawn a surprise "Other" section.
 *   - The "Later Today" header is not a category; upcoming tasks under it keep
 *     their own category and stay in their own section.
 *
 * The returned `settled` layout is rebuilt with makeCategoryGroups so it
 * exactly matches what the store-derived list will recompute to, letting the
 * caller show it once and skip the redundant resync.
 */
export function resolveDrop(
  reordered: CategoryListItem[],
  opts: { isUpcoming: (id: string) => boolean; showUpcoming: boolean },
): DropResolution {
  const taskIds: string[] = [];
  const categoryUpdates: Array<{ id: string; category: string | null }> = [];
  const orderedTasks: Task[] = [];
  const upcomingOrdered: Task[] = [];
  let currentSection: string | null | undefined = undefined;
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
    // Tasks above the first header, under "Later Today", or upcoming keep their
    // own category; everything else adopts its section's category.
    const target: string | null =
      inLaterToday || isUpcoming || currentSection === undefined
        ? item.task.category
        : currentSection;
    const task = target === item.task.category ? item.task : { ...item.task, category: target };
    if (target !== item.task.category) {
      categoryUpdates.push({ id: item.task.id, category: target });
    }
    (isUpcoming ? upcomingOrdered : orderedTasks).push(task);
  }

  const settled: CategoryListItem[] = makeCategoryGroups(orderedTasks);
  if (opts.showUpcoming && upcomingOrdered.length > 0) {
    settled.push({ type: 'header', label: LATER_TODAY_LABEL });
    upcomingOrdered.forEach(task => settled.push({ type: 'task', task }));
  }

  return { taskIds, categoryUpdates, settled };
}
