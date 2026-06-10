import type { Task } from '../types';

export type CategoryListItem =
  | { type: 'header'; label: string }
  | { type: 'task'; task: Task };

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
    if (key !== UNCATEGORIZED) items.push({ type: 'header', label: key });
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
  const orderedTasks: Task[] = [];
  const upcomingOrdered: Task[] = [];
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
