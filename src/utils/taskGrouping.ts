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
