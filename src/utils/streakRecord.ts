import type { Task } from '../types';

/**
 * A recurring task's personal best, and the one rule that maintains it.
 *
 * The stored column (`Task.priorBestStreak`) holds the longest run *before*
 * the current one, which is the counter-intuitive half and the whole reason
 * this module exists. See that field's own note for why a running all-time
 * maximum cannot work: it is raised by the very streak measured against it, so
 * "past my record" becomes true again every single day once you have passed it
 * once. Excluding the live run is what makes overtaking a single event.
 *
 * Everything a caller wants is derived from that column and `streakCount`:
 * `bestStreakOf` for the number to show, `isStreakAtRecord` for whether the
 * run standing right now is the longest there has been, and `nextStreakRecord`
 * for the fold.
 */

type StreakFields = Pick<Task, 'streakCount' | 'priorBestStreak'>;

/**
 * The record to fold forward given what the streak is about to become.
 *
 * One rule, stated over the transition rather than over the cause: **a streak
 * going down is a run ending**, so the run that just ended becomes a candidate
 * for the record. That covers every way a run can end without this module
 * having to know which happened — a miss breaking it to 0, a gap restarting it
 * at 1, a partial day closed out by the quota rollover, an archive resumed, a
 * manual reset in the editor. A streak that holds or climbs is the same run
 * continuing and folds nothing.
 *
 * Deliberately not folded on the way *up*. The live run is already counted by
 * `bestStreakOf`, so nothing is hidden by leaving it out, and leaving it out is
 * what keeps `isStreakAtRecord` from turning itself off the moment it turns on.
 */
export function nextStreakRecord(task: StreakFields, nextStreakCount: number): number {
  return nextStreakCount < task.streakCount
    ? Math.max(task.priorBestStreak, task.streakCount)
    : task.priorBestStreak;
}

/**
 * The longest run this task has ever had, live one included — the number to
 * show anywhere a record is displayed.
 *
 * Derived rather than stored precisely so the stored column can exclude the
 * current run: a run in progress that is past the old record *is* the record,
 * and reporting the superseded number while it climbs would be wrong.
 */
export function bestStreakOf(task: StreakFields): number {
  return Math.max(task.priorBestStreak, task.streakCount);
}

/**
 * Whether the run standing right now has overtaken every run before it.
 *
 * Strictly greater, so matching your best is not beating it, and gated on
 * there being a previous run at all: a first-ever streak has no record to
 * pass, and calling day one of it a personal best would make the state
 * meaningless on exactly the tasks that have no history to compare against.
 *
 * True for the whole remainder of a record-breaking run, not just the day it
 * crossed. That is what makes it a state a row can show rather than an event a
 * row would have to have caught, and the crossing is still a single moment
 * because `priorBestStreak` does not move while the run is alive.
 */
export function isStreakAtRecord(task: StreakFields): boolean {
  return task.priorBestStreak > 0 && task.streakCount > task.priorBestStreak;
}

const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/**
 * The line under "Streak" in the task editor.
 *
 * Reports the record alongside the count rather than only the count, since the
 * record is otherwise invisible anywhere but the row's chip — and the chip only
 * appears once "Show streak on row" is on, and only says anything while the run
 * is actually past the record.
 *
 * "Tap to correct" survives in the one case where there is no record to report
 * instead: a first run has nothing to compare against, and that case is also
 * the one where the row has room to say what tapping it does.
 */
export function streakHint(task: StreakFields): string {
  const best = bestStreakOf(task);
  if (task.streakCount === 0) {
    return best > 0 ? `No streak yet. Longest run: ${days(best)}` : 'No streak yet';
  }
  const current = `${task.streakCount} day streak`;
  if (isStreakAtRecord(task)) return `${current}, the longest this task has had`;
  if (best > task.streakCount) return `${current}. Longest run: ${days(best)}`;
  return `${current}, tap to correct`;
}
