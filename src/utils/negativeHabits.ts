import { differenceInCalendarDays, subDays } from 'date-fns';
import type { Task } from '../types';
import { nextStreakRecord } from './streakRecord';

/**
 * Negative habits — a commitment *not* to do something ("don't smoke").
 *
 * The whole feature is one flag (`Task.polarity`) plus the rules in this file,
 * deliberately rather than a second entity beside `Task`. A negative habit
 * wants a title, a category, a reminder, a streak, a place in the feed and a
 * row that looks like every other row; the only things it does differently are
 * that it is never completed and that its streak counts *days it survived*
 * instead of completions. Two rules is a flag, not a type.
 *
 * The one structural cost is that second rule. Everywhere else in the app a
 * streak advances inside `completeTask`, lazily — `getStreakOutcome` measures
 * the calendar gap when the next completion arrives, so nothing has to tick on
 * the passage of time. A negative streak is *made of* the passage of time: no
 * event ever arrives to measure from, because the whole success condition is
 * that nothing happened. So it is credited by a rollover pass instead
 * (`rolloverNegativeStreaks` in useTaskStore), and this module owns the
 * arithmetic that pass runs.
 *
 * Store-free and clock-injected, the same discipline rhythms.ts keeps: every
 * function takes the logical day start it should reason about rather than
 * reaching for `getCurrentDayStart()`, so the whole module is exercisable in
 * the `node` test environment and so no caller can accidentally reason about a
 * calendar day where the user has a `dayResetTime`.
 */

/** The fields these rules read. Narrow so tests can build one by hand. */
export type NegativeHabitFields = Pick<
  Task,
  | 'polarity'
  | 'slipCount'
  | 'slipDate'
  | 'streakCount'
  | 'streakDate'
  | 'previousStreakCount'
  | 'previousStreakDate'
  | 'priorBestStreak'
>;

export function isNegativeTask(task: Pick<Task, 'polarity'>): boolean {
  return task.polarity === 'negative';
}

/**
 * How many slips have been logged against this task *today*, which is the only
 * count any surface should read.
 *
 * `slipCount` alone is stale the moment the day turns, and the rollover pass is
 * not a guarantee it has been reset: the app may have been closed across the
 * boundary, or opened for the first time in a week. Gating on `slipDate` means
 * a fresh launch reads the right number before any pass has run, the same way
 * `streakDate` keeps `streakCount` honest.
 */
export function slipsToday(task: NegativeHabitFields, todayStart: Date): number {
  if (!task.slipDate) return 0;
  return differenceInCalendarDays(todayStart, new Date(task.slipDate)) === 0 ? task.slipCount : 0;
}

/** True while today carries no logged slip — the state the row calls "clean". */
export function isCleanToday(task: NegativeHabitFields, todayStart: Date): boolean {
  return slipsToday(task, todayStart) === 0;
}

/**
 * What logging a slip writes.
 *
 * The count always advances, so a frequency-logged habit ("how many
 * cigarettes") records every tap. The streak only breaks on the *first* slip of
 * the day: it is already 0 after that, and re-snapshotting `previousStreakCount`
 * on the second tap would overwrite the run undo needs to give back with a 0.
 * That asymmetry is the whole reason this returns one patch rather than the
 * caller doing two writes.
 */
export function slipPatch(task: NegativeHabitFields, todayStart: Date): Partial<Task> {
  const already = slipsToday(task, todayStart);
  const count = { slipCount: already + 1, slipDate: todayStart.toISOString() };
  if (already > 0) return count;
  return {
    ...count,
    streakCount: 0,
    // The day the run was broken on, and so the last day already accounted
    // for — see cleanDayPatch for what that means for the days after it.
    streakDate: todayStart.toISOString(),
    previousStreakCount: task.streakCount,
    previousStreakDate: task.streakDate,
    // The run that just ended folds into the record, by the same rule a
    // completion's does: a streak going down is a run ending.
    priorBestStreak: nextStreakRecord(task, 0),
  };
}

/**
 * Taking back a slip logged by mistake — the tap costs a run that may be weeks
 * long, and a mis-tap with no way back is not a thing to ship.
 *
 * Only today's slips can be undone: yesterday's is history, and the rollover
 * pass has already credited days on top of the reset it caused. Returns null
 * when there is nothing to take back.
 *
 * `priorBestStreak` is deliberately left folded, exactly as `uncompleteTask`
 * leaves it. `bestStreakOf` is a max, so a record that was genuinely reached
 * stays reported at its real value, and the alternative is a second snapshot
 * column to unwind a number that was true.
 */
export function undoSlipPatch(task: NegativeHabitFields, todayStart: Date): Partial<Task> | null {
  const already = slipsToday(task, todayStart);
  if (already === 0) return null;
  const count = { slipCount: already - 1, slipDate: todayStart.toISOString() };
  if (already > 1) return count;
  return {
    ...count,
    // Back to the run this slip ended. The snapshot is what a completion's undo
    // restores from too, so a negative habit needs no undo machinery of its own.
    streakCount: task.previousStreakCount,
    streakDate: task.previousStreakDate,
  };
}

/**
 * What the day-rollover pass writes: the clean days that have completed since
 * this task was last accounted for.
 *
 * **`streakDate` means "the last day already accounted for"** — credited as
 * clean, spent on a slip, or the partial day the habit was created on. So the
 * days available to credit are the ones strictly between it and today, and
 * today is excluded because it isn't over: `diff - 1`.
 *
 * Working an example in each direction, since the off-by-one here is the whole
 * function. Slip on Monday leaves `streakDate` = Monday; on Tuesday `diff` is 1
 * and nothing is credited, which is right — the only completed day since the
 * break is Monday itself, and Monday is the day you smoked. On Wednesday `diff`
 * is 2 and Tuesday credits, because Tuesday is now a whole day that went by
 * untouched. A habit created at 3pm on Monday behaves the same way and for the
 * same reason: its first creditable day is Tuesday, because half of Monday
 * happened before the commitment existed.
 *
 * A gap is credited in full rather than a day at a time — reopening the app
 * after a week away credits six clean days. That is the honest reading and not
 * a shortcut: for a negative habit "clean" is defined as *no slip was reported*,
 * so days nobody logged anything against are days that count. The user is the
 * only sensor, which is a real limitation of the feature and not of this pass.
 *
 * Returns null when there is nothing to write, so the pass touches no rows on
 * the common path of being called twice in a day.
 */
export function cleanDayPatch(
  task: NegativeHabitFields,
  todayStart: Date,
  opts: { paused?: boolean } = {},
): Partial<Task> | null {
  if (!isNegativeTask(task)) return null;

  // No anchor at all — a row that predates the column, or one whose anchor was
  // cleared. Nothing can be credited without knowing what has already been
  // counted, so this takes today as the anchor and starts counting tomorrow,
  // which is what a habit created right now would do.
  if (!task.streakDate) {
    return { streakDate: todayStart.toISOString() };
  }

  const diff = differenceInCalendarDays(todayStart, new Date(task.streakDate));
  // Same day (nothing to do), or a clock that went backwards — a device whose
  // date was corrected, or a timezone flight. Crediting a negative number would
  // eat a run the user did nothing to lose.
  if (diff < 1) return null;

  // Nothing has completed since the anchor: `diff` of 1 means the anchor *is*
  // yesterday, so the run is already up to date and the write below would be a
  // no-op. This is the branch the pass takes on almost every launch.
  const cleanDays = diff - 1;
  if (cleanDays === 0) return null;

  // Everything up to yesterday is now accounted for, whether it was credited or
  // paused past. Anchoring at yesterday rather than today is what keeps this
  // idempotent: run it again in an hour and `diff` is back to 1.
  const streakDate = subDays(todayStart, 1).toISOString();

  // Vacation protects a run rather than growing it — the same call every other
  // streak here makes. The anchor still moves, so the days away are consumed
  // rather than banked up to land in one lump when vacation ends.
  if (opts.paused) return { streakDate };

  const streakCount = task.streakCount + cleanDays;
  return {
    streakCount,
    streakDate,
    // Folded for symmetry with slipPatch, though it can never fire here: the
    // rule is "the run went down", and a run only grows on this path.
    priorBestStreak: nextStreakRecord(task, streakCount),
  };
}
