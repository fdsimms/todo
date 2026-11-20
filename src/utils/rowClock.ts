import type { Task } from '../types';
import { logicalDayStart } from './clockTime';

/**
 * Whether a task's row shows anything that can change within a day with no
 * write to say so, and so has to follow the shared heartbeat (`nowTick.ts`).
 *
 * Every row used to follow it, so every row on Today and Later rendered in
 * full every half minute, whatever it showed, and most show nothing finer than
 * which day it is. A row this says no for still renders again when the logical
 * day changes (`useRowClock`), which covers "Tomorrow" becoming "Today" and a
 * date going overdue.
 *
 * It errs towards yes: a wrong yes costs one render per tick, a wrong no is a
 * row showing a stale time until something else renders it. So it asks whether
 * the task *carries* anything timed, not whether the row happens to print it:
 *
 * - a window, a time of day, a snooze, a deadline, a reminder, or a date that
 *   names a time, each of which the row words against the clock;
 * - a timer, running or paused with time on it;
 * - a target, which paces through the day, and an hourly repeat;
 * - a "don't do this" habit, whose slips and holds are told by the hour;
 * - anything the app wrote (`generatedKind`): leave-by, event, review and
 *   study rows all carry clock text of their own;
 * - a linked alarm, or an import waiting to be answered;
 * - a category with hours, which opens and closes its tasks on the clock.
 *
 * A new field that makes a row say something about the time of day is added
 * here in the same change, or that row keeps the text it was drawn with.
 */
export function rowFollowsClock(
  task: Task,
  dayResetTime: string,
  /** The task's category is limited to hours of the day (`Category.scheduleStart`). */
  categoryHasHours: boolean,
): boolean {
  if (task.windowStart || task.windowEnd) return true;
  if (task.timeSegments.length > 0) return true;
  if (task.deferUntil != null || task.deadline != null || task.reminderTime != null) return true;
  if (task.timerStartedAt !== null || task.timerElapsedSeconds > 0) return true;
  if (task.targetCount !== null) return true;
  if (task.recurrenceType === 'hours') return true;
  if (task.polarity !== 'positive') return true;
  if (task.generatedKind != null) return true;
  if (task.alarmLink || task.pendingImport) return true;
  if (categoryHasHours) return true;
  return task.dueDate != null && namesATime(task.dueDate, dayResetTime);
}

/** A stamp that is neither midnight nor the start of its logical day: a date somebody gave a time. */
function namesATime(iso: string, dayResetTime: string): boolean {
  const at = new Date(iso);
  const ms = at.getTime();
  if (Number.isNaN(ms)) return true;
  if (at.getHours() === 0 && at.getMinutes() === 0) return false;
  return logicalDayStart(at, dayResetTime).getTime() !== ms;
}
