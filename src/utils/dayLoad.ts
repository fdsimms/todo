import type { Task } from '../types';
import type { BusyEvent } from './calendarBusy';
import { busyMinutesIn } from './calendarBusy';
import type { DayBucket } from './calendarMonth';
import { dayKeyOf, dayKeyToDate, getDayStart } from './dateUtils';
import { estimatedMinutesFor, formatDuration } from './effort';

/**
 * How full a day already is, for every day of a grid (#1791).
 *
 * The app has always known this. `snoozeEngine` scores every candidate day on
 * exactly these inputs — dated tasks, projected recurrences, meeting minutes —
 * and `deloadPlan` picks destinations with it. What neither does is *say* it:
 * Suggest highlights one cell and the other forty-one stay silent, so a date
 * picked by hand is picked blind. This is that same reading, handed to the two
 * grids that draw days.
 *
 * Nothing here is stored and nothing is written — it's a derivation over rows
 * that already exist, which is why it's a util rather than a store, and why it
 * runs in Jest's `node` environment like `calendarMonth` beside it.
 *
 * Two rules run through the whole module and are the reason it isn't just a
 * sum:
 *
 * - **A cue may rank; a sentence may only state.** `rankedMinutes` folds in
 *   everything that will occupy the day — meetings, projected occurrences, and
 *   a stand-in for tasks carrying no estimate — because it feeds a three-state
 *   cue, which is a rank, and `snoozeEngine` already ranks on exactly that
 *   basis. `describeDayLoad` folds in none of it: it names real rows and their
 *   real estimates, keeps meeting time as its own clause, and says "at least"
 *   the moment a counted row has no estimate to contribute. The same split
 *   `summarizeDay` makes when it leaves projections out of "3 due" and lets
 *   them caption themselves below.
 * - **No cue is never "this day is free".** A day the calendar window doesn't
 *   reach (`busyKnown: false`) is a day nothing is known about, and an
 *   unmarked cell means "nothing to say" everywhere else too — the silence
 *   `tripMarkerFor` runs on. Which is what licenses marking only the heavy
 *   end: being wrong about a busy day costs a cue nobody needed, being wrong
 *   about a free one costs the appointment you booked over.
 *
 * The constants are not imported from `projectPull`, which owns the app's
 * other "is a day already full" number, because that module reaches
 * `snoozeEngine` → `useSettingsStore` → the db → `expo-sqlite`, which throws on
 * sight in the `node` environment. Same reason `missed.ts` is its own leaf.
 */

/**
 * Above this much, a day reads as already busy.
 *
 * `PULL_TODAY_BUDGET_MINUTES` (projectPull.ts) is the same judgement about
 * today — above three hours already planned, a pull lands somewhere else — and
 * a cue that disagreed with where the app is willing to put work would be two
 * answers to one question. Kept in step by hand; see the note above for why
 * it can't be imported.
 */
export const BUSY_DAY_MINUTES = 180;

/** Above this much, a day is not merely busy but spoken for. */
export const FULL_DAY_MINUTES = BUSY_DAY_MINUTES * 2;

/**
 * What a task with no estimate is worth *to the cue*.
 *
 * `snoozeEngine.effortUnits` already assumes exactly this half hour when it
 * ranks days, and a cue is the same kind of claim — coarse, comparative, and
 * never rendered as a number. Nothing this stand-in touches reaches
 * `describeDayLoad`, which counts such a task and declines to price it.
 */
export const ASSUMED_TASK_MINUTES = 30;

/** How heavy a day is, when it's heavy enough to be worth saying. */
export type DayWeight = 'busy' | 'full';

export interface DayLoad {
  key: string;
  /**
   * Outstanding real rows landing here, deduped per task — a row that is both
   * due and returning on one day is one thing to do, not two.
   */
  taskCount: number;
  /** Minutes those rows carry an estimate for. Never a guess. */
  taskMinutes: number;
  /** How many of `taskCount` carry no estimate, and so no minutes. */
  unestimated: number;
  /** Recurring occurrences projected onto this day. No row exists for these yet. */
  projected: number;
  /**
   * Whether the calendar window reaches this day at all. False means nothing
   * is known about its events — emphatically not that it has none, the same
   * distinction `useCalendarStore.loaded` draws for the window as a whole.
   */
  busyKnown: boolean;
  /** Meeting minutes on the day; 0 when unknown. */
  busyMinutes: number;
  /**
   * Everything that will occupy the day, in minutes, with a stand-in for what
   * isn't estimated. **For ranking only** — `weightFor` reads it for a day's
   * cue, and `lookAhead.tightDeadlines` sums it across a span to compare
   * against the same threshold. Neither renders it, and nothing should:
   * stating it would put a number in front of the user half of which they
   * never typed.
   */
  rankedMinutes: number;
}

export interface BuildDayLoadsOptions {
  /** Rows by id, for the estimates the buckets' marks don't carry. */
  taskById: ReadonlyMap<string, Task>;
  /**
   * Events to weigh, already filtered to the calendars the user picked.
   * Omitted — or paired with no window — leaves every day `busyKnown: false`,
   * which is what a caller with calendar read off or unloaded should pass.
   */
  busyEvents?: readonly BusyEvent[];
  /** The span those events were actually read for. See `DayLoad.busyKnown`. */
  busyWindow?: { start: Date; end: Date } | null;
  dayResetTime?: string;
}

const emptyLoad = (key: string): DayLoad => ({
  key,
  taskCount: 0,
  taskMinutes: 0,
  unestimated: 0,
  projected: 0,
  busyKnown: false,
  busyMinutes: 0,
  rankedMinutes: 0,
});

/**
 * Read a grid's days as weight.
 *
 * Takes `buildDayBuckets`' own output rather than the task list, which is the
 * point: "what lands on this day" is a question with one answer in this app,
 * including all four of `canProject`'s refusals, and a second walk here would
 * be a third copy of it to keep in step (`snoozeEngine` has the other).
 *
 * **Iterates the days, not the buckets.** A day with six hours of meetings and
 * no task dated to it has no bucket at all — it draws no dot, which is right,
 * and it is exactly the day this feature exists to warn about.
 *
 * **Deadline marks are skipped.** A deadline is a day to hit, not a block of
 * work to do on it, and the row carrying one almost always carries a due date
 * too — counting both would charge one task to a day twice.
 */
export function buildDayLoads(
  days: readonly Date[],
  buckets: ReadonlyMap<string, DayBucket>,
  options: BuildDayLoadsOptions,
): Map<string, DayLoad> {
  const { taskById, busyEvents = [], busyWindow = null, dayResetTime } = options;
  const loads = new Map<string, DayLoad>();

  for (const day of days) {
    const key = dayKeyOf(day);
    if (loads.has(key)) continue;
    const bucket = buckets.get(key);
    const load = emptyLoad(key);
    const countedReal = new Set<string>();
    const countedProjected = new Set<string>();
    let projectedMinutes = 0;

    for (const mark of bucket?.marks ?? []) {
      if (mark.kind === 'deadline') continue;
      const task = taskById.get(mark.taskId);

      if (mark.projected) {
        if (countedProjected.has(mark.taskId)) continue;
        countedProjected.add(mark.taskId);
        load.projected += 1;
        projectedMinutes += (task ? estimatedMinutesFor(task) : null) ?? ASSUMED_TASK_MINUTES;
        continue;
      }

      // A finished row is history the day already accounts for — the same
      // reading `bucket.outstanding` and the grid's own dots give it.
      if (mark.completed) continue;
      if (countedReal.has(mark.taskId)) continue;
      countedReal.add(mark.taskId);
      load.taskCount += 1;
      const minutes = task ? estimatedMinutesFor(task) : null;
      if (minutes == null) load.unestimated += 1;
      else load.taskMinutes += minutes;
    }

    if (busyWindow && busyEvents.length > 0) {
      // Anchored from noon, never from the key's own midnight: under a 02:00
      // reset `getDayStart(midnight)` belongs to the *previous* logical day, so
      // a day's meetings would be read from the day before it. Same normalising
      // `snoozeEngine` does to its candidates before asking the same question.
      const noon = dayKeyToDate(key);
      noon.setHours(12, 0, 0, 0);
      const dayStart = getDayStart(noon, dayResetTime);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      if (dayStart >= busyWindow.start && dayEnd <= busyWindow.end) {
        load.busyKnown = true;
        load.busyMinutes = busyMinutesIn(busyEvents, dayStart, dayEnd);
      }
    }

    load.rankedMinutes =
      load.taskMinutes + load.unestimated * ASSUMED_TASK_MINUTES + projectedMinutes + load.busyMinutes;
    loads.set(key, load);
  }

  return loads;
}

/**
 * The cue a day's cell draws, or null for the ordinary days — which is most of
 * them, and is the whole reason this reads as a signal rather than decoration.
 */
export function weightFor(load: DayLoad | undefined): DayWeight | null {
  if (!load) return null;
  if (load.rankedMinutes >= FULL_DAY_MINUTES) return 'full';
  if (load.rankedMinutes >= BUSY_DAY_MINUTES) return 'busy';
  return null;
}

/** How a cue is spoken, for the cells that draw one. */
export function describeDayWeight(weight: DayWeight): string {
  return weight === 'full' ? 'already full' : 'already busy';
}

/**
 * "~2.5h · 1h of events" — how much of a day is spoken for, in the app's own
 * duration vocabulary (`formatDuration`, so this can't drift into a second
 * spelling of the same hour).
 *
 * Three things it will not do:
 *
 * - **Price what it can't.** A day whose rows carry no estimates at all gets no
 *   minutes clause; a day where only some do says "at least", which is exactly
 *   what a partial total is. Neither borrows `ASSUMED_TASK_MINUTES`. And a
 *   *partial* total under half an hour is dropped outright: "4 due · at least
 *   2m" is true and reads as an empty day, because the two minutes it can see
 *   describe a corner of one. Below one ordinary task's worth of time, the
 *   count above has already said more than the floor can.
 * - **Sum a guess into a fact.** Meeting minutes ride as their own clause and
 *   are never added to the task total — `describeShops`' rule, and the reason
 *   `weekPlan` keeps "probably have" out of its numbers.
 * - **Count occurrences that have no row.** They're captioned where they're
 *   listed, and a number here that no list underneath accounts for is the thing
 *   `summarizeDay` already declines to print.
 *
 * Returns '' for a day with nothing to report, so a one-line consumer renders
 * nothing at all rather than an empty row.
 */
export function describeDayLoad(load: DayLoad | undefined): string {
  if (!load) return '';
  const parts: string[] = [];

  const partial = load.unestimated > 0;
  if (load.taskMinutes > 0 && (!partial || load.taskMinutes >= ASSUMED_TASK_MINUTES)) {
    const total = formatDuration(load.taskMinutes);
    parts.push(partial ? `at least ${total}` : `~${total}`);
  }
  if (load.busyMinutes > 0) parts.push(`${formatDuration(load.busyMinutes)} of events`);

  return parts.join(' · ');
}
