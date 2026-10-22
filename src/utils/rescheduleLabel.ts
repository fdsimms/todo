import type { Task, TimeOfDay } from '../types';
import { formatScheduledDate, getEffectiveTaskDate, getTaskDayStart } from './dateUtils';
import { sameTimeSegments } from './visibilityUtils';

/** Where a reschedule put a task, for the undo bar: "tomorrow", "Thursday", "Oct 22". */
export function movedDayLabel(date: Date, dayResetTime?: string): string {
  const day = formatScheduledDate(date.toISOString(), dayResetTime);
  return day === 'Today' || day === 'Tomorrow' ? day.toLowerCase() : day;
}

/**
 * The undo bar's message for a When pick, shared by the row's picker and the
 * bulk bar. A pick that leaves every task on the day it was already on and only
 * changes the time of day names the segments: "Moved X to today" would claim a
 * move that didn't happen. `tasks` are the rows as they were before the write.
 */
export function describeReschedule(
  tasks: Pick<Task, 'title' | 'dueDate' | 'deferUntil' | 'timeSegments'>[],
  date: Date | null,
  timeSegments: TimeOfDay[],
  dayResetTime?: string,
): string {
  const subject = tasks.length === 1 ? `“${tasks[0].title}”` : `${tasks.length} tasks`;
  if (!date) return `Took the date off ${subject}`;
  const pickedDay = getTaskDayStart(date, dayResetTime).getTime();
  const staysOnDay = tasks.every(t => {
    const prev = getEffectiveTaskDate(t, dayResetTime);
    return prev !== null && getTaskDayStart(new Date(prev), dayResetTime).getTime() === pickedDay;
  });
  const segmentsChanged = tasks.some(t => !sameTimeSegments(t.timeSegments, timeSegments));
  if (staysOnDay && timeSegments.length > 0 && segmentsChanged) {
    return `Moved ${subject} to ${timeSegments.join(', ')}`;
  }
  return `Moved ${subject} to ${movedDayLabel(date, dayResetTime)}`;
}
