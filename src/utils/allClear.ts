import type { Task } from '../types';
import { getLogicalDayKey } from './dateUtils';
import { isRealCompletion } from './missed';

/**
 * What Today's empty state says, and the count behind it.
 *
 * An empty Today has always read "All clear / Nothing to do right now", which
 * covers two quite different days with the same sentence: one where nothing
 * was ever on the list, and one where you finished everything that was. The
 * screen knows the difference — it already counts the day's completions for
 * the header's "40m done · 2h 15m planned" — and the second of those is the
 * only moment in the app where finishing a whole day is acknowledged at all.
 */

/**
 * The top-level tasks genuinely finished within one logical day.
 *
 * `dayKey` rather than a Date so the comparison is an equality on the day a
 * completion *belongs to*, which is what `getLogicalDayKey` is for: a task
 * ticked off at 1am under a 4am reset belongs to the day before, the same way
 * every other day-boundary read in the app treats it. A calendar-day check
 * (date-fns `isToday`) drops those completions at midnight instead, three
 * hours before the day they belong to is over.
 *
 * Excludes subtasks, since a checked-off step under a live parent isn't a task
 * finished, and anything marked missed rather than done (`isRealCompletion`).
 */
export function completedOnDay(tasks: Task[], dayKey: string, dayResetTime?: string): Task[] {
  return tasks.filter(t =>
    !t.parentId
    && isRealCompletion(t)
    && t.completedAt != null
    && getLogicalDayKey(new Date(t.completedAt), dayResetTime) === dayKey,
  );
}

/**
 * The subtitle under "All clear".
 *
 * Only the finished-the-day case is named. The other two are deliberately left
 * on one sentence: an empty Today can also mean everything left is *later*
 * today (a time-of-day segment that hasn't opened, a daily target on pace —
 * those render in the Later Today section below the empty state, not as rows),
 * so "nothing scheduled" would be wrong there and "nothing to do right now" is
 * true of both.
 *
 * The count alone, no time: the header directly above already reads "40m done"
 * from the same completions whenever the estimates exist, and saying it twice
 * on one screen is worse than saying it once.
 */
export function describeAllClear(opts: { filtered: boolean; doneToday: number }): string {
  if (opts.filtered) return 'No tasks match these filters';
  if (opts.doneToday > 0) {
    return `${opts.doneToday} task${opts.doneToday === 1 ? '' : 's'} done today`;
  }
  return 'Nothing to do right now';
}
