import type { Task } from '../types';
import { activeChainStep } from './chain';
import {
  dayKeyOf,
  getDeadlineFromMonthDay,
  getDeadlineFromOffset,
  getNextDueDate,
} from './dateUtils';

/**
 * What a month grid puts on its day cells — and the one place in the app that
 * renders an occurrence with no row behind it.
 *
 * Three of a task's dates are places on a calendar, and they're the three this
 * buckets: `dueDate` (when it's on), `deadline` (what it has to be done by) and
 * `deferUntil` (when it comes back). `windowStart`/`windowEnd` are deliberately
 * not a fourth — they're clock times *within* a day, so they have no cell to
 * land in; a task carrying only a window has no date signal at all
 * (`hasNoDateSignal`), which is the same call `isTaskExpired` makes about them.
 *
 * **Placement, not visibility.** A task shows on its day whether or not it's
 * actionable there: vacation-paused, blocked, deferred past it, hidden behind a
 * time segment. The question a grid answers is "what date is this on", and the
 * answer doesn't change because the task can't be started yet — the same call
 * `pinnedTasks()` makes for the pinned block. `isTaskVisible` is for Today.
 *
 * **The reset time doesn't reach this module, on purpose.** A stored date's
 * logical day is `getTaskDayStart`, which only moves the *clock time* within
 * the date it was given and never rolls it to another day — so
 * `dayKeyOf(getTaskDayStart(d, r))` is `dayKeyOf(d)` for every `r`, and
 * threading the setting through here would be ceremony that reads like it
 * does something. Projection is the one thing that takes it, because
 * `getNextDueDate` does.
 */

export type DayMarkKind = 'due' | 'deadline' | 'defer';

/**
 * Fixed order for a cell's dots, so the same colour sits in the same position
 * on every day of the grid instead of following whatever order the task scan
 * happened to produce. A row of dots you have to re-read per cell is no faster
 * than a list.
 */
export const MARK_KINDS = ['due', 'deadline', 'defer'] as const;

export interface DayMark {
  kind: DayMarkKind;
  taskId: string;
  /**
   * Captured on the mark rather than resolved from the row at render time,
   * because a projected mark's whole point is that it has no row of its own to
   * resolve — and a caption that had to reach back to the task to name itself
   * would be one lookup away from naming the wrong occurrence.
   */
  title: string;
  /**
   * True when this occurrence exists nowhere but here — see
   * `projectOccurrences`. A projected mark may become a dot on a cell and a
   * line in the day's "expected" caption. It may never become a task row: it
   * has no id to complete, defer or edit, and the row types that would have to
   * learn that are exactly the ones the Series note in CLAUDE.md refused to
   * grow ghosts for.
   */
  projected: boolean;
  /** The row's own completion state. Always false when `projected`. */
  completed: boolean;
}

/**
 * How firmly a cell states a kind:
 *
 * - `solid` — real work still outstanding.
 * - `done` — the day has rows of this kind and every one is ticked.
 * - `projected` — nothing of this kind is in the database; it's a walk of the
 *   recurrence rule and nothing more.
 *
 * Three states rather than a boolean because a hollow dot has to mean exactly
 * one thing. Collapse "done" into "projected" and a finished Tuesday reads as
 * a guess; collapse it into "solid" and a month you've cleared looks identical
 * to one you haven't touched.
 */
export type DotState = 'solid' | 'done' | 'projected';

export interface DayDot {
  kind: DayMarkKind;
  state: DotState;
}

export interface DayBucket {
  key: string;
  /** Everything landing on this day, ordered by `MARK_KINDS`. */
  marks: DayMark[];
  /**
   * What the cell draws, in `MARK_KINDS` order. Resolved here rather than in
   * the cell because a grid re-derives it 42 times a render, and because the
   * state rules above are worth testing.
   */
  dots: DayDot[];
  /**
   * Real, incomplete rows here. Zero means there is nothing left to do on this
   * day, which is what lets a finished day render differently from an empty
   * one without the cell re-deriving it per frame.
   */
  outstanding: number;
  /** No real row lands here at all — every mark on the day is a projection. */
  projectedOnly: boolean;
}

/**
 * A ceiling on how many occurrences one task may contribute to one build.
 *
 * The walk has to step through every occurrence between the task's own due
 * date and the grid, so a daily task viewed a year out costs ~365 steps before
 * it reaches the first cell. That's fine once per month change in a `useMemo`,
 * and this is the backstop for the case it isn't — a rule that advances by a
 * day while the user pages to 2099. Reaching it truncates the month rather
 * than hanging it.
 */
export const MAX_PROJECTION_STEPS = 500;

/**
 * Whether a task's future occurrences may be drawn on days it has no row for.
 *
 * Four refusals, and each one is a schedule the app doesn't actually promise:
 *
 * - **A completed row.** Recurrence leaves a tombstone per completion and
 *   spawns the successor at the same moment, so the live row is already
 *   projecting the future — walking the tombstones too would draw every
 *   occurrence once per completion the task has ever had, growing without
 *   bound exactly like the raw `groupChildrenOf` rows do.
 * - **`recurrenceFromCompletion`.** Its next date is anchored to the day you
 *   finish, which hasn't happened; `getNextDueDate` answers from *today* for
 *   these, so a walk would lay a fictional every-N-days track from now to the
 *   edge of the grid and call it a schedule.
 * - **A live chain.** Completing a chained task advances `chainIndex` and
 *   spawns the next step with no date; the recurrence only advances at chain
 *   end. So its next dated occurrence isn't `getNextDueDate(task)` unless the
 *   remaining steps all land today. `activeChainStep` owns the "is it
 *   stepping" rule (a single-item chain doesn't count), so this asks it rather
 *   than re-reading `chainEnabled` itself.
 * - **An archived row**, which is filed away rather than scheduled.
 */
export function canProject(task: Task): boolean {
  if (task.parentId) return false;
  if (task.completed || task.archived) return false;
  if (task.recurrenceType === 'none') return false;
  if (task.dueDate == null) return false;
  if (task.recurrenceFromCompletion) return false;
  if (activeChainStep(task) !== null) return false;
  return true;
}

/**
 * The dates a recurring task will land on between `from` and `to`, exclusive of
 * its own stored `dueDate` — that one is a real row and buckets as one.
 *
 * The cursor carries a decremented `recurrenceCount` because that field is
 * "occurrences remaining, including this one" and `completeTask` takes one off
 * per spawn. Walking without decrementing projects a task set to repeat three
 * times all the way to the edge of the grid, since `getNextDueDate` reads the
 * count off the row it's handed and that row would never run down.
 *
 * `recurrenceEndDate` needs no such care — `getNextDueDate` already returns
 * null past it, and null is where the walk stops.
 */
export function projectOccurrences(
  task: Task,
  from: Date,
  to: Date,
  dayResetTime?: string,
): Date[] {
  if (!canProject(task)) return [];

  const fromKey = dayKeyOf(from);
  const toKey = dayKeyOf(to);
  const out: Date[] = [];

  let cursor: Task = task;
  let cursorKey = dayKeyOf(new Date(task.dueDate as string));

  for (let step = 0; step < MAX_PROJECTION_STEPS; step++) {
    const next = getNextDueDate(cursor, dayResetTime);
    // Out of occurrences: past recurrenceEndDate, or the count ran down.
    if (next == null) break;

    const nextKey = dayKeyOf(next);
    // A rule that doesn't advance is a rule that loops. Nothing in
    // getNextDueDate should produce one, and if a future recurrence type ever
    // does, truncating the month beats hanging on it.
    if (nextKey <= cursorKey) break;
    if (nextKey > toKey) break;

    if (nextKey >= fromKey) out.push(next);

    cursorKey = nextKey;
    cursor = {
      ...cursor,
      dueDate: next.toISOString(),
      recurrenceCount: cursor.recurrenceCount !== null ? cursor.recurrenceCount - 1 : null,
    };
  }

  return out;
}

/**
 * The deadline a projected occurrence would carry, or null when the task's
 * deadline doesn't move with its due date.
 *
 * A *relative* deadline (`deadlineOffsetDays`, or `deadlineMonthDay` for
 * monthly rules) is recomputed against each new occurrence by `completeTask`,
 * so projecting the occurrence without projecting its deadline would draw half
 * a schedule. A fixed `deadline` is a one-off date that doesn't carry forward,
 * so it has nothing to project. Both branches reuse the store's own helpers
 * rather than restating the arithmetic — the direction of the offset is the
 * whole meaning of that field and reads backwards the moment it's rewritten.
 */
export function projectedDeadlineFor(task: Task, occurrence: Date): Date | null {
  if (task.deadlineOffsetDays !== null) return getDeadlineFromOffset(occurrence, task.deadlineOffsetDays);
  if (task.deadlineMonthDay !== null) return getDeadlineFromMonthDay(occurrence, task.deadlineMonthDay);
  return null;
}

export interface BuildBucketsOptions {
  /** First day of the grid — occurrences before it are walked past, not kept. */
  from: Date;
  /** Last day of the grid. The projection walk stops here. */
  to: Date;
  dayResetTime?: string;
  /**
   * Whether to draw occurrences that have no row yet. Off, the grid shows only
   * what's in the database — which is what the day detail's real-row list is
   * built from either way.
   */
  projecting?: boolean;
}

/**
 * Bucket every task onto the days of a grid, once.
 *
 * Built as a single pass over the task list into a `Map` keyed by day rather
 * than having each of the 42 cells filter the list, which is O(days × tasks)
 * per render — the shape `snoozeEngine` already uses for `recurringByDay`.
 *
 * Subtasks are skipped: a subtask is a step of its parent, the parent already
 * occupies the day, and every top-level list in the app filters them the same
 * way. Archived rows are skipped too — the Archived screen owns those, and a
 * grid that keeps drawing what you filed away is one you stop trusting.
 */
export function buildDayBuckets(
  tasks: readonly Task[],
  options: BuildBucketsOptions,
): Map<string, DayBucket> {
  const { from, to, dayResetTime, projecting = true } = options;
  const fromKey = dayKeyOf(from);
  const toKey = dayKeyOf(to);
  const buckets = new Map<string, DayBucket>();

  const add = (key: string, mark: DayMark) => {
    if (key < fromKey || key > toKey) return;
    const bucket = buckets.get(key);
    if (bucket) bucket.marks.push(mark);
    else buckets.set(key, { key, marks: [mark], dots: [], outstanding: 0, projectedOnly: true });
  };

  for (const task of tasks) {
    if (task.parentId) continue;
    if (task.archived) continue;

    const base = { taskId: task.id, title: task.title, projected: false, completed: task.completed };

    if (task.dueDate) add(dayKeyOf(new Date(task.dueDate)), { ...base, kind: 'due' });
    if (task.deadline) add(dayKeyOf(new Date(task.deadline)), { ...base, kind: 'deadline' });
    // A completed task doesn't resurface, so its spent deferUntil is noise on a
    // day that has already happened — where the due and deadline marks above
    // are exactly the history you came to a past month to read.
    if (task.deferUntil && !task.completed) {
      add(dayKeyOf(new Date(task.deferUntil)), { ...base, kind: 'defer' });
    }

    if (!projecting) continue;
    for (const occurrence of projectOccurrences(task, from, to, dayResetTime)) {
      const ghost = { taskId: task.id, title: task.title, projected: true, completed: false };
      add(dayKeyOf(occurrence), { ...ghost, kind: 'due' });
      const deadline = projectedDeadlineFor(task, occurrence);
      if (deadline) add(dayKeyOf(deadline), { ...ghost, kind: 'deadline' });
    }
  }

  for (const bucket of buckets.values()) {
    bucket.marks.sort((a, b) => MARK_KINDS.indexOf(a.kind) - MARK_KINDS.indexOf(b.kind));
    bucket.dots = dotsFor(bucket.marks);
    bucket.outstanding = bucket.marks.filter(m => !m.projected && !m.completed).length;
    bucket.projectedOnly = bucket.marks.every(m => m.projected);
  }

  return buckets;
}

/** One dot per kind present, stated as firmly as the day's marks allow. */
export function dotsFor(marks: readonly DayMark[]): DayDot[] {
  const dots: DayDot[] = [];
  for (const kind of MARK_KINDS) {
    const ofKind = marks.filter(m => m.kind === kind);
    if (ofKind.length === 0) continue;
    const state: DotState = ofKind.some(m => !m.projected && !m.completed)
      ? 'solid'
      : ofKind.some(m => !m.projected)
        ? 'done'
        : 'projected';
    dots.push({ kind, state });
  }
  return dots;
}

export interface DayDetail {
  key: string;
  /** Real rows, by kind — these are tappable, completable, editable tasks. */
  due: Task[];
  deadline: Task[];
  defer: Task[];
  /**
   * Occurrences with no row yet, deduped to one line per task. Deliberately
   * `{id, title}` and not `Task`: the day list is real rows, and handing a
   * caption a Task is how it ends up rendered as one.
   */
  expected: { taskId: string; title: string }[];
  isEmpty: boolean;
}

/**
 * Resolve a day's bucket into what its detail pane renders.
 *
 * The split is the boundary the whole feature turns on. A dot on a cell may be
 * projected; a *row* in the day's list is always real, because a row is a thing
 * you can tick, swipe and open, and a projected occurrence has no id behind it
 * to do any of that to. What the projection gets instead is a caption — named,
 * so a dot never goes unexplained when you tap into the day, and shaped so
 * nothing about it invites a tap.
 *
 * A mark whose row has gone (deleted between build and read) resolves to
 * nothing, the same resolve-or-shrug every cross-row pointer in this app does.
 */
export function dayDetail(
  bucket: DayBucket | undefined,
  taskById: ReadonlyMap<string, Task>,
): DayDetail {
  const key = bucket?.key ?? '';
  const real = (kind: DayMarkKind): Task[] => {
    const seen = new Set<string>();
    const out: Task[] = [];
    for (const mark of bucket?.marks ?? []) {
      if (mark.kind !== kind || mark.projected || seen.has(mark.taskId)) continue;
      const task = taskById.get(mark.taskId);
      if (!task) continue;
      seen.add(mark.taskId);
      out.push(task);
    }
    return out;
  };

  const expected: { taskId: string; title: string }[] = [];
  const seenGhosts = new Set<string>();
  for (const mark of bucket?.marks ?? []) {
    if (!mark.projected || seenGhosts.has(mark.taskId)) continue;
    seenGhosts.add(mark.taskId);
    expected.push({ taskId: mark.taskId, title: mark.title });
  }

  const due = real('due');
  const deadline = real('deadline');
  const defer = real('defer');

  return {
    key,
    due,
    deadline,
    defer,
    expected,
    isEmpty: due.length === 0 && deadline.length === 0 && defer.length === 0 && expected.length === 0,
  };
}

/**
 * "3 due · 1 deadline" — the one-line summary above a day's detail.
 *
 * Counts real, *outstanding* rows — the same "still work to do" reading the
 * grid's own dots and `DayBucket.outstanding` already give a day, so a day
 * you've cleared says so instead of reporting every row that ever landed on
 * it as if none were done. The expected lines caption themselves right below
 * and folding them in here would put a number on the day that no list under
 * it accounts for.
 */
export function summarizeDay(detail: DayDetail): string {
  const parts: string[] = [];
  const due = detail.due.filter(t => !t.completed).length;
  const deadline = detail.deadline.filter(t => !t.completed).length;
  if (due > 0) parts.push(`${due} due`);
  if (deadline > 0) parts.push(`${deadline} deadline${deadline === 1 ? '' : 's'}`);
  if (detail.defer.length > 0) parts.push(`${detail.defer.length} returning`);
  return parts.join(' · ');
}
