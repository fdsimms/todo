import type { Task, TaskGroup } from '../types';
import { getVisibleAt } from './visibilityUtils';
import { formatGroupHeader, formatHHMM } from './dateUtils';

export type CategoryListItem =
  | { type: 'header'; label: string }
  | { type: 'task'; task: Task }
  | { type: 'group'; group: TaskGroup; children: Task[] };

// TodayScreen's own list also carries a couple of row kinds (pinned
// section, "everything else" divider) that don't belong to a category at
// all — the category-shaping helpers below only ever look at the 'header' /
// 'task' / 'group' arms, so they accept this wider union rather than
// CategoryListItem.
export type TodayListItem =
  | { type: 'pinned-header' }
  | { type: 'pinned-task'; task: Task }
  | { type: 'rest-header' }
  | CategoryListItem;

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
// input: each group renders as a 'group' item somewhere inside its category
// section, MERGED into that category's plain tasks by sortOrder — group and
// task sort orders are one number space (see TaskGroup.sortOrder), so a stack
// holds a slot in the list the same way a loose task does. Groups used to be
// emitted at the START of their section instead, which silently discarded
// every drop that put a task above a stack: the drag animated, then the
// rebuilt layout hoisted the stack back over it.
//
// Passing groups here (rather than as a separate post-processing pass over
// the header+task output) is what lets a category made up ENTIRELY of a group
// with no loose tasks still get a header — the header-selection logic below
// already needs to know about every category's content once, so it might as
// well know about groups too. resolveCategoryReorder/categoryHeaderRange
// never pass a `groups` argument (it defaults to none), so their internal
// makeCategoryGroups calls keep producing header+task-only output.
//
// `interleaveGroups` is the escape hatch for a non-manual sort (Today's
// priority/effort/due-date/streak options): those reorder the tasks by
// something other than sortOrder, so merging by it would scatter the stacks
// arbitrarily. Passing false keeps the old groups-first layout, which at
// least stays predictable while a sort is on.
export function makeCategoryGroups(
  tasks: Task[],
  categoryOrder: string[] = [],
  groups: { group: TaskGroup; children: Task[] }[] = [],
  opts: { interleaveGroups?: boolean } = {},
): CategoryListItem[] {
  const interleaveGroups = opts.interleaveGroups ?? true;
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
    const sectionGroups = groupsByCategory.get(key) ?? [];
    const sectionTasks = byCategory.get(key) ?? [];
    const pushGroup = (g: { group: TaskGroup; children: Task[] }) =>
      items.push({ type: 'group', group: g.group, children: g.children });
    // Merge, rather than sort the two together: the tasks arrive in the order
    // the caller wants them (store order, already sortOrder-sorted) and that
    // order is what a drop just committed — a stack only needs slotting in
    // between them. Strictly-less so a stack whose sortOrder ties a task's
    // (legacy rows carry the old per-category 1..M numbering until the first
    // drag renumbers them) lands after it rather than jumping the task.
    let next = 0;
    if (interleaveGroups) {
      sectionTasks.forEach(task => {
        while (next < sectionGroups.length && sectionGroups[next].group.sortOrder < task.sortOrder) {
          pushGroup(sectionGroups[next++]);
        }
        items.push({ type: 'task', task });
      });
    }
    while (next < sectionGroups.length) pushGroup(sectionGroups[next++]);
    if (!interleaveGroups) sectionTasks.forEach(task => items.push({ type: 'task', task }));
  });
  return items;
}

export interface DropResolution {
  /**
   * Every task in the drop, with the sortOrder to persist. Explicit numbers
   * rather than bare ids in order, because the ranks skip the slots the
   * dropped stacks took (see groupUpdates) — renumbering the tasks 1..N at
   * the store would close those gaps and put every stack back on top of its
   * section.
   */
  taskOrders: Array<{ id: string; sortOrder: number }>;
  /** Tasks whose category changed because of where they were dropped. */
  categoryUpdates: Array<{ id: string; category: string | null }>;
  /**
   * Task groups dragged as a whole block (see TodayScreen's group `onDrag`):
   * their new category (nearest header above, same rule as tasks) and their
   * new sortOrder — a rank from the same running counter the tasks get, so a
   * stack sits between the two tasks it was dropped between.
   */
  groupUpdates: Array<{ id: string; category: string | null; sortOrder: number }>;
  /** The final, regrouped layout to show immediately after the drop. */
  settled: CategoryListItem[];
}

/**
 * Resolve a drag-and-drop drop on the Today list.
 *
 * Given the raw reordered list of headers + tasks + stacks that the drag
 * gesture hands back, work out (a) the new order — one rank per row, stacks
 * included — (b) which tasks/stacks changed category, and (c) the final
 * grouped layout to render.
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
  const taskOrders: Array<{ id: string; sortOrder: number }> = [];
  const categoryUpdates: Array<{ id: string; category: string | null }> = [];
  const groupUpdates: Array<{ id: string; category: string | null; sortOrder: number }> = [];
  const orderedTasks: Task[] = [];
  const upcomingOrdered: Task[] = [];
  const updatedGroups: { group: TaskGroup; children: Task[] }[] = [];
  let currentSection: string | null = null;
  let inLaterToday = false;
  // One counter for tasks and groups alike: the drop order IS the new list
  // order, and both kinds of row occupy a slot in it. Handing groups their
  // own separate numbering (as this used to) is what made "task above stack"
  // unrepresentable — the two orders had nothing to compare.
  let rank = 0;

  for (const item of reordered) {
    if (item.type === 'header') {
      if (item.label === LATER_TODAY_LABEL) {
        inLaterToday = true;
      } else {
        currentSection = item.label;
      }
      continue;
    }
    rank += 1;
    if (item.type === 'group') {
      // Groups never appear inside "Later Today" (that section is rendered
      // by a separate, non-draggable path — see TodayScreen), so they always
      // adopt the nearest real header above, same rule as a task.
      const target = currentSection;
      if (target !== item.group.category || rank !== item.group.sortOrder) {
        groupUpdates.push({ id: item.group.id, category: target, sortOrder: rank });
      }
      updatedGroups.push({
        group: { ...item.group, category: target, sortOrder: rank },
        children: item.children,
      });
      continue;
    }
    taskOrders.push({ id: item.task.id, sortOrder: rank });
    const isUpcoming = opts.isUpcoming(item.task.id);
    // Upcoming/"Later Today" tasks keep their own category; everything else
    // adopts its section's (null above the first header = uncategorize).
    const target: string | null =
      inLaterToday || isUpcoming ? item.task.category : currentSection;
    if (target !== item.task.category) {
      categoryUpdates.push({ id: item.task.id, category: target });
    }
    // Carrying the new sortOrder (not just the new category) is what keeps
    // `settled` identical to the layout the store will recompute: it's the
    // number makeCategoryGroups slots the stacks against.
    (isUpcoming ? upcomingOrdered : orderedTasks).push({ ...item.task, category: target, sortOrder: rank });
  }

  const settled: CategoryListItem[] = makeCategoryGroups(orderedTasks, opts.categoryOrder, updatedGroups);
  if (opts.showUpcoming && upcomingOrdered.length > 0) {
    settled.push({ type: 'header', label: LATER_TODAY_LABEL });
    upcomingOrdered.forEach(task => settled.push({ type: 'task', task }));
  }

  return { taskOrders, categoryUpdates, groupUpdates, settled };
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

// Shared with the Later screen's own day/segment grouping (see laterGroupKeys
// below) so "later today" sub-headers read the same way in both places.
export const SEGMENT_LABELS: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
export const SEGMENT_ORDER = ['morning', 'afternoon', 'evening', 'night'] as const;

/**
 * The Later-view section title(s) a task belongs under — a task with multiple
 * timeSegments belongs under more than one. `visibleAt` is accepted so a
 * caller that already computed it (laterSections does, to sort by it) doesn't
 * pay for a second getVisibleAt call per task.
 */
export function laterGroupKeys(task: Task, visibleAt: Date = getVisibleAt(task)): string[] {
  const dayLabel = formatGroupHeader(visibleAt.toISOString());
  if (task.timeSegments.length > 0) {
    return task.timeSegments.map(seg => `${dayLabel} — ${SEGMENT_LABELS[seg]}`);
  }
  if (task.windowStart) {
    const windowLabel = task.windowEnd
      ? `${formatHHMM(task.windowStart)}–${formatHHMM(task.windowEnd)}`
      : formatHHMM(task.windowStart);
    return [`${dayLabel} — ${windowLabel}`];
  }
  return [dayLabel];
}

/** Group deferred tasks into Later-view sections, sorted by when each becomes visible. */
export function laterSections(deferredTasks: Task[]): { title: string; data: Task[] }[] {
  const grouped = new Map<string, Task[]>();
  // getVisibleAt is the expensive call in this pass — date math, a settings
  // read and a category lookup every time — so compute it once per task and
  // carry it through, rather than calling it from inside the comparator
  // (~n log n times) and then again for each task's section title. It also
  // makes the comparator consistent: getVisibleAt falls back to `new Date()`
  // for a task with no future gate, so re-calling it mid-sort could order the
  // same pair differently depending on when the comparison happened.
  deferredTasks
    .map(task => ({ task, visibleAt: getVisibleAt(task) }))
    .sort((a, b) => a.visibleAt.getTime() - b.visibleAt.getTime())
    .forEach(({ task, visibleAt }) => {
      for (const key of laterGroupKeys(task, visibleAt)) {
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(task);
      }
    });
  return Array.from(grouped.entries()).map(([title, data]) => ({ title, data }));
}

/**
 * Truncate Later-view sections to a task budget, whole sections at a time, so
 * a header never renders without at least one of its tasks. Used to keep the
 * initial mount of the (unvirtualized) Later ReorderableList cheap.
 */
export function visibleLaterSections(
  sections: { title: string; data: Task[] }[],
  taskLimit: number,
): { title: string; data: Task[] }[] {
  const result: typeof sections = [];
  let count = 0;
  for (const section of sections) {
    result.push(section);
    count += section.data.length;
    if (count >= taskLimit) break;
  }
  return result;
}

export type LaterTodaySectionData = {
  key: string;
  // null for tasks with no time segment (e.g. plain windowStart/deferUntil) —
  // they render without a sub-header rather than under a manufactured one.
  label: string | null;
  tasks: Task[];
  groups: { group: TaskGroup; children: Task[] }[];
};

/**
 * Sub-groups Later Today's tasks/groups by time segment, mirroring the Later
 * screen's own segment sub-headers. A task with no timeSegments falls into
 * the 'none' bucket, which renders without a header. A group is assigned to
 * every segment bucket any of its later-today children belong to, but only
 * once per bucket — with its full later-today children roster underneath,
 * not just the ones matching that segment — so a stack doesn't fragment into
 * duplicate headers when its children have mixed segments.
 */
export function laterTodaySections(
  upcomingUngroupedTasks: Task[],
  laterGroupItems: { group: TaskGroup; children: Task[] }[],
): LaterTodaySectionData[] {
  type Bucket = { tasks: Task[]; groups: Map<string, { group: TaskGroup; children: Task[] }> };
  const bySegment = new Map<string, Bucket>();
  const ensure = (key: string): Bucket => {
    let bucket = bySegment.get(key);
    if (!bucket) {
      bucket = { tasks: [], groups: new Map() };
      bySegment.set(key, bucket);
    }
    return bucket;
  };

  upcomingUngroupedTasks.forEach(task => {
    const segs = task.timeSegments.length > 0 ? task.timeSegments : ['none'];
    segs.forEach(seg => ensure(seg).tasks.push(task));
  });

  laterGroupItems.forEach(({ group, children }) => {
    const segs = new Set<string>();
    children.forEach(child => {
      (child.timeSegments.length > 0 ? child.timeSegments : ['none']).forEach(seg => segs.add(seg));
    });
    segs.forEach(seg => {
      const bucket = ensure(seg);
      if (!bucket.groups.has(group.id)) bucket.groups.set(group.id, { group, children });
    });
  });

  return [...SEGMENT_ORDER, 'none']
    .filter(key => bySegment.has(key))
    .map(key => ({
      key,
      label: key === 'none' ? null : SEGMENT_LABELS[key],
      tasks: bySegment.get(key)!.tasks,
      groups: Array.from(bySegment.get(key)!.groups.values()),
    }));
}

/**
 * The category (or null, for the header-less loose group / Later Today) each
 * item in a Today-list belongs to, aligned index-for-index with `items`.
 * Shared traversal behind applyCategoryCollapse and categorySectionKeys —
 * they used to walk the list independently and could drift.
 */
export function categorySpan(items: TodayListItem[]): (string | null)[] {
  const spans: (string | null)[] = [];
  let currentCategory: string | null = null;
  for (const item of items) {
    if (item.type === 'header') {
      currentCategory = item.label === LATER_TODAY_LABEL ? null : item.label;
    }
    spans.push(currentCategory);
  }
  return spans;
}

/**
 * Hide task/group rows under a collapsed category header, leaving the header
 * itself in place so it stays tappable to re-expand. The "Later Today"
 * header is a time section, not a category, so it's never collapsible.
 */
export function applyCategoryCollapse(
  items: TodayListItem[],
  collapsedCategories: Set<string>,
): TodayListItem[] {
  if (collapsedCategories.size === 0) return items;
  const spans = categorySpan(items);
  return items.filter((item, i) => {
    if (item.type === 'header') return true;
    if (
      (item.type === 'task' || item.type === 'group') &&
      spans[i] !== null &&
      collapsedCategories.has(spans[i]!)
    ) {
      return false;
    }
    return true;
  });
}

/**
 * Where a task's row sits in a Today list, for scrolling to it from something
 * outside the list (the new-todos banner).
 *
 * Resolve this against the list BEFORE the collapse filters are applied —
 * a task in a collapsed section is exactly the one the caller most needs to
 * find, and the point of the extra fields is to say what has to be opened
 * before the scroll can land on it.
 */
export interface TaskJumpTarget {
  /** Key of the row to scroll to: the task's own row, or the stack heading it. */
  key: string;
  /** Category section the row sits in, or null for the loose group at the top. */
  category: string | null;
  /** The stack the task belongs to, if it's a member of one. */
  groupId: string | null;
  /** Whether the row sits under the "Everything else" divider (pinned layout). */
  inRest: boolean;
}

/**
 * Find the row that stands for `taskId`. A stacked task has no row of its own
 * in this list — its stack's header does — so that's what comes back for one,
 * along with the group id so the caller can open the stack.
 *
 * Returns null when the task isn't in the list at all, which a priority/effort
 * filter is enough to cause.
 */
export function findTaskJumpTarget(
  items: TodayListItem[],
  taskId: string,
  listItemKey: (item: TodayListItem) => string,
): TaskJumpTarget | null {
  const spans = categorySpan(items);
  let inRest = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type === 'rest-header') {
      inRest = true;
      continue;
    }
    const isMatch =
      item.type === 'task' || item.type === 'pinned-task'
        ? item.task.id === taskId
        : item.type === 'group'
          ? item.children.some(child => child.id === taskId)
          : false;
    if (!isMatch) continue;
    // A pinned row sits above the category sections entirely, so it's never
    // collapsed away and never inside "Everything else".
    const pinned = item.type === 'pinned-task';
    return {
      key: listItemKey(item),
      category: pinned ? null : spans[i],
      groupId: item.type === 'group' ? item.group.id : null,
      inRest: pinned ? false : inRest,
    };
  }
  return null;
}

/**
 * Keys of task/group rows that sit under a real category header (i.e. not
 * the header-less loose group at top, and not "Later Today", which is a time
 * section rather than a category). Used to decide what to hide while a
 * category header is being dragged.
 */
export function categorySectionKeys(
  data: TodayListItem[],
  listItemKey: (item: TodayListItem) => string,
): Set<string> {
  const spans = categorySpan(data);
  const keys = new Set<string>();
  data.forEach((item, i) => {
    if ((item.type === 'task' || item.type === 'group') && spans[i] !== null) {
      keys.add(listItemKey(item));
    }
  });
  return keys;
}
