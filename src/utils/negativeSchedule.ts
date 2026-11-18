import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import type { Task } from '../types';
import { getNextDueDate, getTaskDayStart } from './dateUtils';

// Split from negativeHabits.ts, which stays free of the settings store (and so
// of dateUtils): the recurrence walk below needs both.

/** Upper bound on the walk in scheduledDaysBetween: a year of daily steps. */
const MAX_SCHEDULE_WALK = 400;

/**
 * How many of the days from `afterDay` through `throughDay` (both inclusive)
 * are on a non-daily habit's schedule. The walk starts at the occurrence the
 * row holds, which is never older than the last day already credited, so every
 * earlier occurrence was counted by an earlier pass.
 */
export function scheduledDaysBetween(
  task: Parameters<typeof getNextDueDate>[0],
  afterDay: Date,
  throughDay: Date,
  dayResetTime: string,
): number {
  if (!task.dueDate || task.recurrenceType === 'none' || task.recurrenceType === 'hours') {
    return Math.max(0, differenceInCalendarDays(throughDay, afterDay) + 1);
  }
  if (task.recurrenceType === 'daily' && task.recurrenceInterval <= 1) {
    return Math.max(0, differenceInCalendarDays(throughDay, afterDay) + 1);
  }
  let count = 0;
  let day = getTaskDayStart(new Date(task.dueDate), dayResetTime);
  for (let i = 0; i < MAX_SCHEDULE_WALK && day <= throughDay; i++) {
    if (day >= afterDay) count++;
    const next = getNextDueDate({ ...task, dueDate: day.toISOString(), recurrenceAnchorDate: null, recurrenceFromCompletion: false, recurrenceEndDate: null, recurrenceCount: null }, dayResetTime);
    if (!next) break;
    const nextDay = getTaskDayStart(next, dayResetTime);
    if (nextDay <= day) break;
    day = nextDay;
  }
  return count;
}
