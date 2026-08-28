import { format, subDays } from 'date-fns';
import { logicalDayStart } from './clockTime';
import type { FocusSessionRecord, FocusStepRecord } from '../types';

/**
 * Reading back what focus sessions actually cost — the counterpart to
 * `focusPlan.ts`, which is about the session in flight.
 *
 * `docs/arch/focus-sessions.md` says the running session is "not a timesheet"
 * and that stats on focus time are a separate feature. This is that feature,
 * and the split it describes is why this module exists rather than the numbers
 * being derived on the Stats screen: a session keeps no per-step clock once a
 * step is behind it, so what's read here is the log written as each step was
 * retired (`FocusSession.stepLog`, closed out into a `FocusSessionRecord`).
 *
 * Pure and store-free, the same shape `rhythms.ts` has beside it — and reached
 * through `clockTime` rather than `dateUtils` for the same reason it is:
 * `dateUtils` imports the settings store, which imports the database, so a
 * pure module that used it could not be loaded in a node test at all. The
 * boundary setting arrives as an argument instead, which also means nothing
 * here can reach for `new Date()` and quietly ignore the user's `dayResetTime`
 * (see the grace-window note in CLAUDE.md).
 */

/** Matches the settings store's own default. */
const DEFAULT_DAY_RESET = '00:00';

/**
 * Below this, a set of sessions can't support a claim about a habit. The same
 * call `rhythms.ts` makes with its own `MIN_SAMPLES`, and for the same reason:
 * two stretches that both ran long are a coincidence, not a pattern, and a
 * percentage drawn from them reads as though it were measured.
 */
export const MIN_ACCURACY_SAMPLES = 3;

/**
 * A rest step that got less than this is one the user tapped straight past
 * rather than took. Not a fraction of the planned length: skipping a 5-minute
 * break and skipping a 15-minute one are the same act, and a proportional test
 * would score the long break as "half taken" for the same two idle seconds.
 */
const BREAK_TAKEN_SECONDS = 30;

export interface FocusDayTotal {
  /** `yyyy-MM-dd` of the logical day. */
  dayKey: string;
  minutes: number;
}

/**
 * Focused minutes per logical day, oldest first, with empty days present as
 * zeroes so a chart can render a fixed number of columns.
 *
 * A session counts on the day it *ended*. One that runs across the boundary is
 * rare and splitting it would mean apportioning each step against a clock the
 * record deliberately doesn't keep (it stores durations, not wall-clock step
 * boundaries) — so it lands whole, on the day the person would say they did it.
 */
export function focusMinutesByDay(
  records: readonly FocusSessionRecord[],
  dayCount: number,
  now: Date = new Date(),
  dayResetTime: string = DEFAULT_DAY_RESET,
): FocusDayTotal[] {
  const today = logicalDayStart(now, dayResetTime);
  const days: FocusDayTotal[] = [];
  for (let i = dayCount - 1; i >= 0; i--) {
    days.push({ dayKey: format(subDays(today, i), 'yyyy-MM-dd'), minutes: 0 });
  }

  const byKey = new Map(days.map(d => [d.dayKey, d]));
  for (const record of records) {
    const key = format(logicalDayStart(new Date(record.endedAt), dayResetTime), 'yyyy-MM-dd');
    const day = byKey.get(key);
    if (day) day.minutes += record.workedSeconds / 60;
  }

  return days.map(d => ({ ...d, minutes: Math.round(d.minutes) }));
}

export interface FocusSummary {
  sessions: number;
  workedMinutes: number;
  restedMinutes: number;
  /** Rounded, and 0 when there are no sessions rather than NaN. */
  averageSessionMinutes: number;
  /** The longest single session's worked minutes. */
  longestSessionMinutes: number;
  tasksCompleted: number;
}

/** Totals across every record given. Filter to a window before calling. */
export function focusSummary(records: readonly FocusSessionRecord[]): FocusSummary {
  const workedSeconds = records.reduce((total, r) => total + r.workedSeconds, 0);
  const longestSeconds = records.reduce((most, r) => Math.max(most, r.workedSeconds), 0);
  return {
    sessions: records.length,
    workedMinutes: Math.round(workedSeconds / 60),
    restedMinutes: Math.round(records.reduce((total, r) => total + r.restedSeconds, 0) / 60),
    averageSessionMinutes: records.length === 0 ? 0 : Math.round(workedSeconds / 60 / records.length),
    longestSessionMinutes: Math.round(longestSeconds / 60),
    tasksCompleted: records.reduce((total, r) => total + r.completedTaskIds.length, 0),
  };
}

/** Records that ended on or after `since`. */
export function focusRecordsSince(
  records: readonly FocusSessionRecord[],
  since: Date,
): FocusSessionRecord[] {
  const floor = since.getTime();
  return records.filter(r => new Date(r.endedAt).getTime() >= floor);
}

export interface FocusAccuracy {
  /** Work stretches counted. */
  steps: number;
  plannedMinutes: number;
  actualMinutes: number;
  /**
   * Actual over planned. 1 means the plan was right; below 1 means stretches
   * end early, above 1 means they run over.
   */
  ratio: number;
}

/**
 * How the length of a work stretch compares to what it was given.
 *
 * Null below the sample floor, so a caller can hide the section rather than
 * print a percentage drawn from one afternoon.
 *
 * Every work step counts, including the parts of a split task — the question
 * is whether a *stretch* runs to its planned length, which each part answers
 * on its own. That's the opposite restriction to `focusMeasuredMinutes`, which
 * excludes split tasks because it is asking a different question (what should
 * this whole task's estimate be), and one part can't answer that.
 */
export function focusAccuracy(records: readonly FocusSessionRecord[]): FocusAccuracy | null {
  const steps = records.flatMap(r => r.steps).filter(s => s.kind === 'work');
  if (steps.length < MIN_ACCURACY_SAMPLES) return null;

  const plannedMinutes = steps.reduce((total, s) => total + s.plannedMinutes, 0);
  const actualMinutes = steps.reduce((total, s) => total + s.actualSeconds, 0) / 60;
  // A plan of zero minutes isn't reachable through buildFocusPlan (every step
  // is positive), but a ratio is the one number here that can't shrug, so it
  // is guarded rather than left to produce Infinity in a percentage.
  if (plannedMinutes <= 0) return null;

  return {
    steps: steps.length,
    plannedMinutes: Math.round(plannedMinutes),
    actualMinutes: Math.round(actualMinutes),
    ratio: actualMinutes / plannedMinutes,
  };
}

export interface BreakUse {
  /** Rest steps the plan reached. */
  total: number;
  /** Those that got more than a tap. */
  taken: number;
}

/**
 * How many of the breaks the plan offered were actually taken.
 *
 * Only breaks the session *reached* are counted — a plan's unrun tail is not
 * a set of skipped breaks, and `FocusSessionRecord.steps` holds only what ran,
 * so this needs no filtering of its own.
 */
export function breakUse(records: readonly FocusSessionRecord[]): BreakUse {
  const rests = records.flatMap(r => r.steps).filter(s => s.kind === 'rest');
  return {
    total: rests.length,
    taken: rests.filter((s: FocusStepRecord) => s.actualSeconds >= BREAK_TAKEN_SECONDS).length,
  };
}
