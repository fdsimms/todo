import type { ContextRow, Task, TaskGroup } from '../types';
import { beginVisibleAtPass, getVisibleAt } from './visibilityUtils';
import { formatGroupHeader, formatHHMM, getDayStart } from './dateUtils';
import type { DropZone, ScheduleInfo } from './fabDrop';

export type CategoryListItem =
  | { type: 'header'; label: string }
  | { type: 'task'; task: Task }
  | { type: 'group'; group: TaskGroup; children: Task[] };

// Today's list used to carry two extra row kinds — a 'pinned-header' with the
// pinned tasks lifted up under it, and a 'rest-header' ("Everything else")
// dividing off what was left. Both are gone: a pinned task now keeps its row
// in its own category section and is *also* rendered in a pinned block above
// the list (TodayScreen's ListHeaderComponent), which is outside this data
// entirely.
//
// What Today renders is a *superset* of what it can drag: a calendar event and
// an uncooked meal fold into the list as `context` rows (see
// src/utils/dayContextRows.ts), and they belong to their category for every
// read that groups or collapses a section. They are deliberately not
// in `CategoryListItem`, which is the drop machinery's domain — `resolveDrop`
// assigns a category and a sortOrder to everything it's handed, and neither
// means anything to a row the app doesn't own. The screen filters them out
// before a drop resolves (`withoutContextRows`) and puts them back after, so
// the two types never meet.
export type ContextListItem = { type: 'context'; row: ContextRow };
export type TodayListItem = CategoryListItem | ContextListItem;

const UNCATEGORIZED = '';

export const LATER_TODAY_LABEL = 'Later Today';

/**
 * Group tasks into category sections for the Today list.
 *
 * Uncategorized tasks render first as a HEADER-LESS group at the top; named
 * categories follow, each with a header, in a FIXED order so dragging tasks
 * around can never reorder the categories themselves (the order is
 * `categoryOrder`, then any leftover categories alphabetically). That order is
 * only ever changed deliberately, from the Today screen's "…" menu — see
 * CategoryOrderSheet.
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
// well know about groups too.
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
  // Today's "Hide categories" option strips every category header out of the
  // dropped array before it reaches here (see stripCategoryHeaders in
  // TodayScreen), so `currentSection` would never get set and every row
  // would read as "above every header" — the deliberate uncategorize rule
  // above, but firing on the whole list instead of the one dragged task.
  // With no header to derive a category from, a drop is a pure reorder: keep
  // each row's own category. A list that's genuinely all-uncategorized hits
  // this same branch and is unaffected, since there'd be nothing to change.
  const hasCategoryHeaders = reordered.some(
    item => item.type === 'header' && item.label !== LATER_TODAY_LABEL,
  );

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
      const target = hasCategoryHeaders ? currentSection : item.group.category;
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
      inLaterToday || isUpcoming || !hasCategoryHeaders ? item.task.category : currentSection;
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

export type LaterListItem =
  | { type: 'header'; label: string; key: string; dateISO: string | null }
  | {
      type: 'subheader';
      label: string;
      key: string;
      segment: string | null;
      dateISO: string | null;
      windowStart: string | null;
      windowEnd: string | null;
    }
  | { type: 'task'; task: Task; key: string };

/**
 * Flatten Later-view day sections into a single header+task list for
 * ReorderableList. Each day emits one 'header' row; a day with more than one
 * time-segment/window sub-group emits a lighter 'subheader' row per group
 * instead of a second full header — see laterSections for why the two are
 * kept as one day section rather than N independent ones.
 *
 * A task with multiple timeSegments appears once per matching sub-group, so
 * the same task id can occur more than once — each occurrence after the
 * first gets a suffixed key to keep list keys unique.
 */
export function flattenLaterSections(days: LaterDaySection[]): LaterListItem[] {
  const items: LaterListItem[] = [];
  const seen = new Map<string, number>();
  days.forEach(day => {
    items.push({ type: 'header', label: day.title, key: `h-${day.title}`, dateISO: day.dateISO });
    const showSubheaders = day.segments.length > 1;
    day.segments.forEach(segment => {
      if (showSubheaders && segment.label) {
        items.push({
          type: 'subheader',
          label: segment.label,
          key: `sh-${day.title}-${segment.label}`,
          segment: segment.segment,
          dateISO: day.dateISO,
          windowStart: segment.windowStart ?? null,
          windowEnd: segment.windowEnd ?? null,
        });
      }
      segment.data.forEach(task => {
        const count = (seen.get(task.id) ?? 0) + 1;
        seen.set(task.id, count);
        items.push({ type: 'task', task, key: count === 1 ? task.id : `${task.id}-${count}` });
      });
    });
  });
  return items;
}

// Boundary predicate for drag confinement (see ReorderableList's dragRange):
// a subheader confines a drag to its own sub-group exactly like a full header
// used to, since each was previously its own independent section.
export const isLaterHeader = (item: LaterListItem): boolean =>
  item.type === 'header' || item.type === 'subheader';

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

/**
 * The add-button drop zones for a flattened Later list, one per row — a
 * header or subheader carries the day/segment it heads as `schedule`
 * (dropping there seeds a task's dueDate/timeSegments/windowStart/windowEnd,
 * same fields the row's own reschedule action writes); a task row inherits
 * whatever section it's rendered under, so dropping on it both schedules and
 * positions the new task at that point. A row whose day has collapsed past
 * one-per-day (LaterDaySection.dateISO null) has no single date to seed, so
 * it's a `rest` zone instead — registered rather than left out, so a drop
 * squarely on it reads as "no target" (like Today's own `rest` rows) instead
 * of reaching past it to whatever's nearest.
 */
export function laterDropZones(items: LaterListItem[]): DropZone[] {
  let current: ScheduleInfo | null = null;
  let dayLabel = '';
  return items.map((item): DropZone => {
    if (item.type === 'header') {
      dayLabel = item.label;
      current = item.dateISO
        ? { dueDate: item.dateISO, timeSegments: [], windowStart: null, windowEnd: null, label: item.label }
        : null;
      return current
        ? { kind: 'header', key: item.key, category: null, schedule: current }
        : { kind: 'rest', key: item.key };
    }
    if (item.type === 'subheader') {
      current = item.dateISO
        ? {
            dueDate: item.dateISO,
            timeSegments: item.segment ? [item.segment] : [],
            windowStart: item.windowStart,
            windowEnd: item.windowEnd,
            label: `${dayLabel} · ${item.label}`,
          }
        : null;
      return current
        ? { kind: 'header', key: item.key, category: null, schedule: current }
        : { kind: 'rest', key: item.key };
    }
    return current
      ? { kind: 'task', key: item.key, category: null, schedule: current }
      : { kind: 'rest', key: item.key };
  });
}

// Shared with the Later screen's own day/segment grouping (see laterGroupKeys
// below) so "later today" sub-headers read the same way in both places.
export const SEGMENT_LABELS: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
export const SEGMENT_ORDER = ['morning', 'afternoon', 'evening', 'night'] as const;

/**
 * The Later-view sub-group(s) a task belongs under within its day — a task
 * with multiple timeSegments belongs under more than one. `segment` is the
 * raw time-segment key (for color-coding the sub-header), null for a
 * window-label or unlabeled sub-group. `windowStart`/`windowEnd` are the raw
 * HH:MM values behind a window label, carried alongside the formatted text so
 * a drop onto that sub-group can reuse them without reparsing the label.
 */
function laterSubGroups(
  task: Task,
): { label: string | null; segment: string | null; windowStart: string | null; windowEnd: string | null }[] {
  if (task.timeSegments.length > 0) {
    return task.timeSegments.map(seg => ({
      label: SEGMENT_LABELS[seg],
      segment: seg,
      windowStart: null,
      windowEnd: null,
    }));
  }
  if (task.windowStart) {
    const windowLabel = task.windowEnd
      ? `${formatHHMM(task.windowStart)}–${formatHHMM(task.windowEnd)}`
      : formatHHMM(task.windowStart);
    return [{ label: windowLabel, segment: null, windowStart: task.windowStart, windowEnd: task.windowEnd }];
  }
  return [{ label: null, segment: null, windowStart: null, windowEnd: null }];
}

/**
 * The Later-view section title(s) a task belongs under — a task with multiple
 * timeSegments belongs under more than one. `visibleAt` is accepted so a
 * caller that already computed it (laterSections does, to sort by it) doesn't
 * pay for a second getVisibleAt call per task.
 *
 * Kept for callers that want the old flat "day — sub-group" title (e.g. as a
 * unique group identity); laterSections itself groups by day and sub-group
 * separately so same-day sub-groups can render under one header.
 */
export function laterGroupKeys(task: Task, visibleAt: Date = getVisibleAt(task)): string[] {
  const dayLabel = formatGroupHeader(visibleAt.toISOString());
  return laterSubGroups(task).map(({ label }) => (label ? `${dayLabel} — ${label}` : dayLabel));
}

export interface LaterDaySection {
  title: string;
  /**
   * The calendar day this section stands for, as a canonical (day-start) ISO
   * string — null once a section has collapsed past the one-header-per-day
   * range (formatGroupHeader falls back to a month/year label past a week
   * out), since a month bucket holds tasks due on several different days and
   * a drop onto it has no single day to mean. See laterDropZones.
   */
  dateISO: string | null;
  segments: {
    label: string | null;
    segment: string | null;
    windowStart?: string | null;
    windowEnd?: string | null;
    data: Task[];
  }[];
}

/** A deferred task paired with the moment it surfaces — see laterVisibleOrder. */
export interface LaterOrderedTask {
  task: Task;
  visibleAt: Date;
}

/**
 * Sort deferred tasks by when each surfaces. This is the half of the Later
 * grouping that is unavoidably O(every deferred task), and it is separate from
 * laterDaySections below so the screen can memoize the two independently: this
 * one on the deferred set, the grouping on whatever row budget is current.
 * Recomputing the sort every time the budget grew a page would be paying the
 * expensive half for rows that were already placed.
 *
 * getVisibleAt is the cost here — date math, settings reads and a category
 * lookup each time — so it is called once per task and carried, rather than
 * from inside the comparator (~n log n times) and again for each section
 * title. One VisibleAtPass covers the whole sort, which also fixes the clock
 * for it: getVisibleAt falls back to the current instant for a task with no
 * future gate, so a per-task clock could order the same pair differently
 * depending on when the comparison happened.
 */
export function laterVisibleOrder(deferredTasks: Task[]): LaterOrderedTask[] {
  const pass = beginVisibleAtPass();
  return deferredTasks
    .map(task => ({ task, visibleAt: getVisibleAt(task, pass) }))
    .sort((a, b) => a.visibleAt.getTime() - b.visibleAt.getTime());
}

export interface LaterSectionsResult {
  sections: LaterDaySection[];
  /** True when the budget stopped the grouping short of the full order. */
  hasMore: boolean;
}

/**
 * Group an ordered deferred list into Later-view day sections. A day with
 * tasks spread across several time-segments (or windows) is still ONE section
 * — see `segments` — so the screen renders one date header per day with
 * lighter sub-headers inside it, rather than a fully separate section per
 * segment (#1162).
 *
 * `taskLimit` stops the grouping once that many task placements are in,
 * finishing the day in progress first so a header never renders without at
 * least one of its tasks. It bounds the work as well as the output: the
 * (unvirtualized) Later list is fed a budget that starts at one screenful,
 * and this used to group every deferred task and then throw most of the
 * result away, which meant the budget bounded only how many rows mounted and
 * not what it cost to decide which. Omit it to group everything.
 */
export function laterDaySections(
  ordered: LaterOrderedTask[],
  taskLimit?: number,
): LaterSectionsResult {
  const days = new Map<
    string,
    { dayKeys: Set<string>; dateISO: string; segMap: Map<string, { label: string | null; segment: string | null; windowStart: string | null; windowEnd: string | null; data: Task[] }> }
  >();
  // formatGroupHeader is the expensive call in this pass — a date-fns format()
  // plus its own "what is today" day-start computation — and it was being paid
  // per task for a string that only ever varies per calendar day. Its output
  // depends on nothing but the calendar date of what it is handed (every
  // branch is a differenceInCalendarDays/isSameDay against today, and every
  // token it formats is a date token), so caching on that date is exact rather
  // than an approximation. Deliberately not keyed on dayKey below, which is a
  // *logical* day and can span two calendar dates under a non-midnight
  // dayResetTime.
  const labelByDate = new Map<string, string>();
  const dayLabelOf = (visibleAt: Date): string => {
    const dateKey = `${visibleAt.getFullYear()}-${visibleAt.getMonth()}-${visibleAt.getDate()}`;
    let label = labelByDate.get(dateKey);
    if (label === undefined) {
      label = formatGroupHeader(visibleAt.toISOString());
      labelByDate.set(dateKey, label);
    }
    return label;
  };

  let placed = 0;
  let hasMore = false;
  for (const { task, visibleAt } of ordered) {
    const dayLabel = dayLabelOf(visibleAt);
    const dayKey = getDayStart(visibleAt).toISOString();
    if (!days.has(dayLabel)) {
      // The budget is checked only when a new day would open, so the day in
      // progress is always finished — the same whole-sections-at-a-time rule
      // the truncation had when it ran over the finished grouping.
      if (taskLimit !== undefined && placed >= taskLimit) {
        hasMore = true;
        break;
      }
      days.set(dayLabel, { dayKeys: new Set(), dateISO: dayKey, segMap: new Map() });
    }
    const day = days.get(dayLabel)!;
    day.dayKeys.add(dayKey);
    for (const { label, segment, windowStart, windowEnd } of laterSubGroups(task)) {
      const key = label ?? '';
      if (!day.segMap.has(key)) day.segMap.set(key, { label, segment, windowStart, windowEnd, data: [] });
      day.segMap.get(key)!.data.push(task);
      // A multi-segment task is placed once per segment and counts once per
      // placement — these are rows in an unvirtualized list, and it renders
      // under each of its sub-headers.
      placed += 1;
    }
  }

  return {
    sections: Array.from(days.entries()).map(([title, day]) => ({
      title,
      // Only a single-calendar-day bucket has one date to drop a task onto —
      // see LaterDaySection.dateISO.
      dateISO: day.dayKeys.size === 1 ? day.dateISO : null,
      segments: Array.from(day.segMap.values()),
    })),
    hasMore,
  };
}

/** Both halves at once, unbudgeted. */
export function laterSections(deferredTasks: Task[]): LaterDaySection[] {
  return laterDaySections(laterVisibleOrder(deferredTasks)).sections;
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
 * Shared traversal behind applyCategoryCollapse and findTaskJumpTarget — they
 * used to walk the list independently and could drift.
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
      (item.type === 'task' || item.type === 'group' || item.type === 'context') &&
      spans[i] !== null &&
      collapsedCategories.has(spans[i]!)
    ) {
      return false;
    }
    return true;
  });
}

/**
 * The task ids under each section header, keyed by the header's label.
 *
 * Today's headers are rendered from the same list their rows are, but nothing
 * else ties the two together: a header simply stops being emitted once its
 * section has no content. That's a frame, not an animation, so a category whose
 * last tasks were just ticked off sat on alone until the completion hold expired
 * and then popped — the rows had faded and closed their gaps a beat earlier.
 * Handing each header the ids beneath it lets it leave with them (see
 * CompletionCollapse).
 *
 * A section holding a stack is deliberately absent rather than empty-listed: the
 * stack's tray is a row with its own children and its own hold, so collapsing
 * the header over it would leave the tray stranded under the section above.
 * Same for the header-less loose group at the top, which has no header to take
 * away.
 */
export function sectionTaskIds(items: TodayListItem[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let label: string | null = null;
  for (const item of items) {
    if (item.type === 'header') {
      label = item.label;
      sections.set(label, []);
      continue;
    }
    if (label === null) continue;
    if (item.type === 'task') {
      sections.get(label)!.push(item.task.id);
      continue;
    }
    if (item.type === 'group') {
      sections.delete(label);
      label = null;
    }
  }
  // An empty section can't be emitted by makeCategoryGroups, but a caller's own
  // filtering (a collapsed category drops its rows) can leave one — and a header
  // with nothing under it must not read as "everything under me is going".
  for (const [key, ids] of sections) {
    if (ids.length === 0) sections.delete(key);
  }
  return sections;
}

/**
 * The tasks sitting under each category header, keyed by the header's label.
 *
 * This is the scope of anything a header does to its own section — today, the
 * pin toggle on its long-press. Read the category out of the store instead and
 * the answer is every live task filed under it, dated weeks out included; since
 * `pinnedTasks()` ignores visibility on purpose (see the Pinning note in
 * CLAUDE.md), each of those then arrives in the Pinned block and stays there.
 * A header can only speak for the rows beneath it.
 *
 * A stack's children count towards the header its *tray* sits under, which is
 * `group.category` and need not be the children's own — the tray is the row on
 * screen, so that's the section they're in. Context rows (a calendar event, an
 * uncooked meal) aren't tasks and are skipped; a category holding nothing else
 * maps to an empty array, which is how a header with nothing to pin says so.
 *
 * Resolve this against the list BEFORE the collapse filters are applied: a
 * collapsed header still speaks for the rows it has folded away.
 *
 * Not to be confused with `sectionTaskIds` above, which answers a different
 * question (what has to finish for this header to leave) and deliberately
 * abandons a section the moment it hits a stack.
 */
export function sectionTasksByLabel(items: TodayListItem[]): Map<string, Task[]> {
  const sections = new Map<string, Task[]>();
  let label: string | null = null;
  for (const item of items) {
    if (item.type === 'header') {
      label = item.label;
      if (!sections.has(label)) sections.set(label, []);
      continue;
    }
    if (label === null) continue;
    if (item.type === 'task') sections.get(label)!.push(item.task);
    else if (item.type === 'group') sections.get(label)!.push(...item.children);
  }
  return sections;
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
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isMatch =
      item.type === 'task'
        ? item.task.id === taskId
        : item.type === 'group'
          ? item.children.some(child => child.id === taskId)
          : false;
    if (!isMatch) continue;
    return {
      key: listItemKey(item),
      category: spans[i],
      groupId: item.type === 'group' ? item.group.id : null,
    };
  }
  return null;
}

