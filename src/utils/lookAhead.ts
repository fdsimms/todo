import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Task } from '../types';
import type { BusyEvent } from './calendarBusy';
import { buildDayBuckets, dayDetail, projectOccurrences, type DayBucket } from './calendarMonth';
import {
  ASSUMED_TASK_MINUTES,
  BUSY_DAY_MINUTES,
  buildDayLoads,
  weightFor,
  type DayLoad,
  type DayWeight,
} from './dayLoad';
import { dayKeyOf, getDayStart, getTaskDayStart } from './dateUtils';
import {
  SOFT_DELOAD_BLOCKERS,
  deloadBlockerFor,
  isDateAnchored,
  wouldMissDeadline,
  type DeloadBlocker,
} from './taskMoves';
import { estimatedMinutesFor, formatDuration } from './effort';

/**
 * "What lands before I go" — one read over a range instead of a day.
 *
 * The app has always been able to answer this and has never been asked to.
 * `buildDayBuckets` already places every real *and* projected occurrence on the
 * days of any span; `buildDayLoads` already weighs those days against the
 * calendar. What nobody does is point the pair at a *window* and ask whether
 * the work in it fits before some date the user cares about — a flight, a
 * project's `deadline`, a Friday.
 *
 * Nothing here is stored and nothing is written. It's a derivation over rows
 * that already exist, which is why it's a util rather than a store, and why it
 * runs in Jest's `node` environment like `dayLoad` and `calendarMonth` beside
 * it.
 *
 * Four rules run through the module, and they're the reason this isn't one
 * sorted list:
 *
 * - **The buckets are not one list, because the tasks aren't one kind of
 *   thing.** A row dated last week, a row landing on Tuesday, and a deadline
 *   falling in the middle of the trip stand in three different relations to
 *   the cutoff, and flattening them loses exactly the distinction the reader
 *   came for. `away` in particular is the bucket nothing else in the app can
 *   show: it needs a *range*, not a date, and vacation mode suppresses the
 *   reminders that would otherwise have raised it.
 * - **A past `dueDate` is carried over, never overdue.** `formatScheduledDate`
 *   settled this and `agendaCounts` names its count the same way: a do-date is
 *   the day a task becomes available, not a promise it can break. Only
 *   `Task.deadline` is ever late here, and only `formatDeadlineDate` says so.
 * - **A cue may rank; a sentence may only state.** Inherited whole from
 *   `dayLoad`, including its "at least" and its refusal to price an
 *   unestimated row. `rankedMinutes` is read here — by `tightDeadlines`, to
 *   compare a span against a threshold — and, as there, never rendered.
 * - **No reading is ever "you have plenty of time".** `describeCrowding`
 *   returns null when no day in the window is even busy, the same silence
 *   `weightFor` keeps on an ordinary day. Being wrong about a crowded window
 *   costs a line nobody needed; being wrong about a clear one costs the trip
 *   you didn't prepare for.
 */

/** The span being read, and the trip on the far side of it when there is one. */
export interface LookAheadWindow {
  /** Start of the current logical day. The window always begins now. */
  start: Date;
  /**
   * The day everything has to be done *before* — exclusive, so a cutoff of the
   * 5th means the window ends at the end of the 4th. That's the reading a
   * departure date wants: the day you leave is not a day you have.
   */
  cutoff: Date;
  /**
   * Last day of the range on the far side of the cutoff, when the cutoff came
   * from a trip with a known end. Null for a bare date, and `away` is then
   * empty — "due while you're away" is a question about a range, and a date
   * picked by hand doesn't describe one.
   */
  awayEnd: Date | null;
}

/** One day of the window, with what lands on it and how heavy it already is. */
export interface LookAheadDay {
  key: string;
  date: Date;
  load: DayLoad;
  /** The day's cue, or null for an ordinary day. See `weightFor`. */
  weight: DayWeight | null;
  /**
   * Real, outstanding rows landing here — due and returning, deduped. These
   * are tappable tasks.
   *
   * Deadline marks are deliberately not among them, for the reason
   * `buildDayLoads` skips them too: a deadline is a day to hit rather than
   * work to do on it, and the row carrying one nearly always carries a due
   * date as well, so listing both puts one task on the reader's plate twice.
   * The deadlines that need saying get said by `tight` and `away`.
   */
  tasks: Task[];
  /**
   * Occurrences with no row yet, one line per task — `dayDetail`'s own split,
   * kept for its own reason: a row is a thing you can tick, and a projection
   * has no id to tick. They caption the day; they are never rendered as rows.
   */
  expected: { taskId: string; title: string }[];
}

/** Something landing between the cutoff and the end of the trip. */
export interface AwayEntry {
  task: Task;
  /** The first day inside the range it lands on. */
  date: Date;
  /** Whether that landing is the task's do-date or a deadline it can miss. */
  kind: 'due' | 'deadline';
  /**
   * How many times it lands while away — more than one only for a recurring
   * task, whose occurrences are projected across the range. The count is why
   * a daily chore reads as one line saying "8 times" instead of eight rows.
   */
  occurrences: number;
}

/**
 * A deadline inside the window whose remaining days are already spoken for.
 *
 * The comparison #1525 wants, done as a read rather than as a generated task —
 * which sidesteps every hard part of that issue at once, since a read has
 * nothing to re-arm, nothing to re-fire, and no opinion about what a postpone
 * means.
 */
export interface TightDeadline {
  task: Task;
  deadline: Date;
  /** The task's own estimate. Never null — an unestimated task can't be judged. */
  minutes: number;
  /** Days from today to the deadline, inclusive. At least 1. */
  daysLeft: number;
}

export interface LookAheadTotals {
  /** Distinct outstanding rows landing anywhere in the window. */
  taskCount: number;
  /** Minutes those rows carry an estimate for. Never a guess. */
  minutes: number;
  /** How many of `taskCount` carry no estimate, and so no minutes. */
  unestimated: number;
  /** Projected occurrences across the window, counted once per task per day. */
  projected: number;
  /** Meeting minutes across the days the calendar window actually reaches. */
  busyMinutes: number;
  /** True only when every day of the window was covered by the calendar read. */
  busyKnown: boolean;
  busyDays: number;
  fullDays: number;
}

export interface LookAhead {
  window: LookAheadWindow;
  /** Days in the window, inclusive of `start`, exclusive of `cutoff`. */
  dayCount: number;
  /**
   * Dated before today and still not done. Not "late" — see the module note.
   * Oldest first, because the one sitting longest is the one to answer for.
   */
  carriedOver: Task[];
  days: LookAheadDay[];
  away: AwayEntry[];
  tight: TightDeadline[];
  totals: LookAheadTotals;
}

export interface BuildLookAheadOptions {
  cutoff: Date;
  awayEnd?: Date | null;
  /** Events already filtered to the calendars the user picked. */
  busyEvents?: readonly BusyEvent[];
  /** The span those were read for. See `DayLoad.busyKnown`. */
  busyWindow?: { start: Date; end: Date } | null;
  dayResetTime?: string;
  /** Overridable for tests. Defaults to the current logical day. */
  now?: Date;
}

/** Every logical day from `start` up to but not including `cutoff`. */
function daysBetween(start: Date, cutoff: Date): Date[] {
  const out: Date[] = [];
  const span = differenceInCalendarDays(cutoff, start);
  for (let i = 0; i < span; i++) out.push(addDays(start, i));
  return out;
}

/** A row nothing should ever count: a step, a tombstone, or something filed away. */
function isCountable(task: Task): boolean {
  return !task.parentId && !task.completed && !task.archived;
}

/**
 * Read a window.
 *
 * `buildDayBuckets` is handed the whole span in one call rather than being
 * asked per day, for the reason it exists: bucketing is a single pass over the
 * task list, and 14 filtered passes is the shape it was written to replace.
 * The away range is walked separately because it sits on the *far* side of the
 * cutoff — one bucket build spanning both would put the trip's own days into
 * the day list the reader is trying to fit work into.
 */
export function buildLookAhead(
  tasks: readonly Task[],
  options: BuildLookAheadOptions,
): LookAhead {
  const {
    cutoff,
    awayEnd = null,
    busyEvents = [],
    busyWindow = null,
    dayResetTime,
    now,
  } = options;

  const start = getDayStart(now ?? new Date(), dayResetTime);
  const cutoffDay = getTaskDayStart(cutoff, dayResetTime);
  const days = daysBetween(start, cutoffDay);
  const taskById = new Map(tasks.map(t => [t.id, t]));

  // An empty window still has to answer — a cutoff of today is a legitimate
  // "what's left before I go" the morning of a flight — so everything below
  // handles a zero-day span rather than returning early on one.
  const lastDay = days.length > 0 ? days[days.length - 1] : start;
  const buckets = buildDayBuckets(tasks, {
    from: start,
    to: lastDay,
    dayResetTime,
    projecting: true,
  });
  const loads = buildDayLoads(days, buckets, { taskById, busyEvents, busyWindow, dayResetTime });

  const lookAheadDays: LookAheadDay[] = days.map(date => {
    const key = dayKeyOf(date);
    const bucket: DayBucket | undefined = buckets.get(key);
    const detail = dayDetail(bucket, taskById);
    // buildDayLoads emits an entry for every day it is handed, so this is
    // total for any key that came out of `days` above.
    const load = loads.get(key)!;
    // Due and returning are both "this lands here today"; a task carrying both
    // dates on one day is one thing to do, the same dedupe buildDayLoads makes.
    const seen = new Set<string>();
    const rows: Task[] = [];
    for (const task of [...detail.due, ...detail.defer]) {
      if (task.completed || seen.has(task.id)) continue;
      seen.add(task.id);
      rows.push(task);
    }
    return {
      key,
      date,
      load,
      weight: weightFor(load),
      tasks: rows,
      expected: detail.expected,
    };
  });

  // Totals are taken over the distinct rows of the window, not by summing the
  // per-day loads: those dedupe within a day, and a task whose deferUntil and
  // dueDate fall on different days of the same window would otherwise be
  // counted — and priced — twice.
  const windowTasks = new Map<string, Task>();
  for (const day of lookAheadDays) {
    for (const task of day.tasks) windowTasks.set(task.id, task);
  }
  let minutes = 0;
  let unestimated = 0;
  for (const task of windowTasks.values()) {
    const m = estimatedMinutesFor(task);
    if (m == null) unestimated += 1;
    else minutes += m;
  }

  const totals: LookAheadTotals = {
    taskCount: windowTasks.size,
    minutes,
    unestimated,
    projected: lookAheadDays.reduce((sum, d) => sum + d.load.projected, 0),
    busyMinutes: lookAheadDays.reduce((sum, d) => sum + d.load.busyMinutes, 0),
    busyKnown: lookAheadDays.length > 0 && lookAheadDays.every(d => d.load.busyKnown),
    busyDays: lookAheadDays.filter(d => d.weight === 'busy').length,
    fullDays: lookAheadDays.filter(d => d.weight === 'full').length,
  };

  return {
    window: { start, cutoff: cutoffDay, awayEnd },
    dayCount: days.length,
    carriedOver: carriedOverTasks(tasks, now ?? new Date(), dayResetTime),
    days: lookAheadDays,
    away: awayEntries(tasks, cutoffDay, awayEnd, dayResetTime),
    tight: tightDeadlines(tasks, lookAheadDays, start, dayResetTime),
    totals,
  };
}

/**
 * Rows dated before today and still outstanding, oldest first.
 *
 * `now` is a moment, not a day — it gets anchored here.
 *
 * These are deliberately *not* in the day list: they're dated outside the
 * window, so `buildDayBuckets` never places them, and they claim the window's
 * hours all the same. Naming them separately is the only way both facts stay
 * true at once.
 */
export function carriedOverTasks(
  tasks: readonly Task[],
  now: Date,
  dayResetTime?: string,
): Task[] {
  // Anchored here rather than taken pre-anchored: double-anchoring is not
  // idempotent under a non-midnight reset (getDayStart would roll an
  // already-anchored midnight back a whole day), so a parameter that silently
  // required one was a trap for the next caller.
  const start = getDayStart(now, dayResetTime);
  return tasks
    .filter(task => {
      if (!isCountable(task) || !task.dueDate) return false;
      return getTaskDayStart(new Date(task.dueDate), dayResetTime) < start;
    })
    .sort(
      (a, b) => new Date(a.dueDate as string).getTime() - new Date(b.dueDate as string).getTime(),
    );
}

/**
 * What lands between the cutoff and the end of the trip.
 *
 * Empty without an `awayEnd`, and that's the design: this bucket answers a
 * question about a *range*, and a cutoff picked by hand describes only a
 * boundary. Offering it anyway would mean guessing how long the reader is
 * gone, which is the one fact a bare date doesn't carry.
 *
 * A deadline outranks a do-date for the same task — both may land in the
 * range, and the deadline is the half with a cost to missing it, so that's the
 * one the row should be about.
 */
export function awayEntries(
  tasks: readonly Task[],
  cutoff: Date,
  awayEnd: Date | null,
  dayResetTime?: string,
): AwayEntry[] {
  if (!awayEnd) return [];
  const end = getTaskDayStart(awayEnd, dayResetTime);
  if (end < cutoff) return [];

  const inRange = (iso: string): Date | null => {
    const day = getTaskDayStart(new Date(iso), dayResetTime);
    return day >= cutoff && day <= end ? day : null;
  };

  const out: AwayEntry[] = [];
  for (const task of tasks) {
    if (!isCountable(task)) continue;

    const deadlineDay = task.deadline ? inRange(task.deadline) : null;
    const dueDay = task.dueDate ? inRange(task.dueDate) : null;
    // Occurrences the recurrence will produce inside the range. The stored row
    // is excluded by projectOccurrences itself, so a task both dated into the
    // range and repeating through it counts its own landing once, here.
    const projected = projectOccurrences(task, cutoff, end, dayResetTime);

    if (deadlineDay) {
      out.push({ task, date: deadlineDay, kind: 'deadline', occurrences: 1 });
      continue;
    }
    if (dueDay || projected.length > 0) {
      const first = dueDay ?? projected[0];
      out.push({
        task,
        date: first,
        kind: 'due',
        occurrences: (dueDay ? 1 : 0) + projected.length,
      });
    }
  }

  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Deadlines in the window that the days before them are already too full for.
 *
 * The threshold is `BUSY_DAY_MINUTES` per day — the app's own existing
 * judgement about when a day is spoken for, kept in step with
 * `PULL_TODAY_BUDGET_MINUTES` — rather than a capacity constant invented here.
 * Above it, a day is one the app already declines to put more work on, so a
 * span averaging above it is a span with nowhere left to put this.
 *
 * The comparison reads `rankedMinutes`, which folds in meetings, projections
 * and a stand-in for unestimated rows. That is a rank and it stays one: the
 * number never reaches the caller, and `TightDeadline` carries only the task's
 * own estimate — which it typed — and the days it has left.
 *
 * **An estimate is required.** A task with no estimate can't be said not to
 * fit, and guessing one with `ASSUMED_TASK_MINUTES` to fill the gap would put
 * the app's own stand-in at the centre of a claim about the user's week. That
 * restraint is also what keeps this quiet: it needs both fields, the same
 * coverage limit #1525 flagged as the thing to watch.
 */
export function tightDeadlines(
  tasks: readonly Task[],
  days: readonly LookAheadDay[],
  /** The window's already-anchored first day — `LookAhead.window.start`. */
  start: Date,
  dayResetTime?: string,
): TightDeadline[] {
  const out: TightDeadline[] = [];
  const lastDay = days.length > 0 ? days[days.length - 1].date : start;

  // Scanned over every task rather than over the ones landing in the window:
  // a task due next month whose deadline falls this Friday never appears on a
  // day of it, and is exactly the one nobody is looking at.
  for (const task of tasks) {
    if (!isCountable(task) || !task.deadline) continue;
    const minutes = estimatedMinutesFor(task);
    if (minutes == null || minutes <= 0) continue;

    const deadline = getTaskDayStart(new Date(task.deadline), dayResetTime);
    if (deadline < start || deadline > lastDay) continue;

    const daysLeft = Math.max(1, differenceInCalendarDays(deadline, start) + 1);
    const committed = days
      .filter(d => d.date <= deadline)
      .reduce((sum, d) => sum + d.load.rankedMinutes, 0);

    if (committed > daysLeft * BUSY_DAY_MINUTES) {
      out.push({ task, deadline, minutes, daysLeft });
    }
  }

  return out.sort((a, b) => a.deadline.getTime() - b.deadline.getTime());
}

// ==== moving work out of the window ====

/**
 * One task's offer to move to the far side of the window.
 *
 * Shares `DeloadBlocker` and the `mode` split with `deloadPlan` deliberately —
 * "which tasks may be swept off a day, and what moving one means" is one rule,
 * and a second copy of `deloadBlockerFor` living here is exactly the drift the
 * shared-primitive notes in CLAUDE.md exist to prevent. What differs is only
 * the destination: `buildDeloadPlan` spreads a day across the best nearby days
 * via the snooze engine, where this puts everything on one date the user has
 * already named. Spreading is wrong here by construction — every day between
 * now and then is inside the window they're trying to empty.
 */
export interface PushProposal {
  task: Task;
  minutes: number;
  mode: 'defer' | 'reschedule';
  /** Where it goes, or null when nothing can move it there. */
  destination: Date | null;
  selected: boolean;
  blocker: DeloadBlocker | null;
  blockerLabel: string | null;
}

/**
 * Propose moving the window's work past `after`.
 *
 * `after` is the first day on the far side — the day the trip ends, so the
 * destination is the day after that. A task whose deadline falls before then
 * can't go: that's `wouldMissDeadline`, and here it's the common case rather
 * than the edge one, which is why the caller labels it in the trip's own terms
 * instead of "Deadline too close".
 */
export function buildPushPlan(
  tasks: readonly Task[],
  after: Date,
  dayResetTime?: string,
): PushProposal[] {
  const destination = addDays(getTaskDayStart(after, dayResetTime), 1);
  destination.setHours(12, 0, 0, 0);

  return tasks
    .filter(isCountable)
    .map(task => {
      const minutes = estimatedMinutesFor(task) ?? 0;
      const mode: 'defer' | 'reschedule' = isDateAnchored(task) ? 'defer' : 'reschedule';
      const found = deloadBlockerFor(task);
      const hardBlocked = found !== null && !SOFT_DELOAD_BLOCKERS.has(found.blocker);

      if (hardBlocked) {
        return {
          task, minutes, mode,
          destination: null,
          selected: false,
          blocker: found.blocker,
          blockerLabel: found.label,
        };
      }

      if (wouldMissDeadline(task, destination, dayResetTime)) {
        return {
          task, minutes, mode,
          destination: null,
          selected: false,
          blocker: 'deadline' as const,
          blockerLabel: 'Deadline lands before you are back',
        };
      }

      return {
        task, minutes, mode,
        destination,
        selected: found === null,
        blocker: found?.blocker ?? null,
        blockerLabel: found?.label ?? null,
      };
    })
    .sort((a, b) => b.minutes - a.minutes);
}

// ==== copy ====

/**
 * "38 tasks land in the next 14 days" — the window's one headline.
 *
 * A count, not a duration, and that ordering is the point: an estimate is
 * optional and most tasks don't carry one, so hours are the half that can be
 * missing. A headline that led with them would read as a light fortnight
 * whenever the reader simply hadn't estimated anything.
 */
export function describeLookAheadLead(la: LookAhead): string {
  const { taskCount } = la.totals;
  const dayPart =
    la.dayCount <= 0
      ? 'before you go'
      : la.dayCount === 1
        ? 'in the last day'
        : `in the next ${la.dayCount} days`;
  if (taskCount === 0) return `Nothing is scheduled ${dayPart}`;
  return `${taskCount} task${taskCount === 1 ? '' : 's'} land${taskCount === 1 ? 's' : ''} ${dayPart}`;
}

/**
 * "At least 26h of work planned · 9 with no estimate" — the qualifying line.
 *
 * Every rule here is `describeDayLoad`'s, applied to a window instead of a
 * day: say "at least" the moment a counted row has no estimate to contribute,
 * drop a partial total too small to mean anything, and never fold
 * `ASSUMED_TASK_MINUTES` into a number the reader will see. Returns '' when
 * there's nothing honest to say, so the consumer renders no line at all.
 */
export function describeLookAheadLoad(la: LookAhead): string {
  const { minutes, unestimated } = la.totals;
  const parts: string[] = [];
  const partial = unestimated > 0;

  if (minutes > 0 && (!partial || minutes >= ASSUMED_TASK_MINUTES)) {
    const total = formatDuration(minutes);
    parts.push(partial ? `At least ${total} of work planned` : `~${total} of work planned`);
  }
  if (unestimated > 0) {
    parts.push(`${unestimated} with no estimate`);
  }
  return parts.join(' · ');
}

/**
 * "11h of events on your calendar", or '' when the window has none or the
 * calendar read didn't reach it.
 *
 * Its own line rather than a clause of the load above, because meeting minutes
 * are a different kind of fact and adding them to task estimates would state a
 * total the reader never planned — `describeDayLoad`'s rule, and
 * `describeShops`' before it.
 */
export function describeLookAheadEvents(la: LookAhead): string {
  const { busyMinutes } = la.totals;
  if (busyMinutes <= 0) return '';
  return `${formatDuration(busyMinutes)} of events on your calendar`;
}

/**
 * "4 days are already full before anything moves", or null.
 *
 * Null on a window with no heavy day at all — never "you have room". A window
 * the calendar hasn't been read for is not a clear one, and an unmarked
 * reading means "nothing to say" here exactly as it does on a grid cell.
 */
export function describeCrowding(la: LookAhead): string | null {
  const { fullDays, busyDays } = la.totals;
  if (fullDays > 0) {
    return `${fullDays} ${fullDays === 1 ? 'day is' : 'days are'} already full before anything moves.`;
  }
  if (busyDays > 0) {
    return `${busyDays} ${busyDays === 1 ? 'day is' : 'days are'} already busy.`;
  }
  return null;
}

/**
 * "8 times while away", "Deadline lands Sep 8" — what an away row says under
 * its title.
 *
 * The deadline half uses the word `formatDeadlineDate` reserves for the field
 * that can actually be missed; the do-date half never does.
 */
export function describeAwayEntry(entry: AwayEntry): string {
  if (entry.kind === 'deadline') return 'Deadline lands while you are away';
  if (entry.occurrences > 1) return `${entry.occurrences} times while you are away`;
  return 'Due while you are away';
}
