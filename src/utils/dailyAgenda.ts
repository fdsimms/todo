import { isSameDay } from 'date-fns/isSameDay';
import type { Task } from '../types';
import { getDayStart } from './dateUtils';
import { hhmmToDate } from './clockTime';

/**
 * The daily agenda notification — what it says, and when the next one lands.
 *
 * Pure on purpose: everything here takes the tasks and a target day and
 * returns a string or a Date, so the counting and the wording can be tested
 * without a device. Scheduling it lives in utils/notifications.ts.
 */

export interface AgendaCounts {
  /** Dated for the target day. */
  due: number;
  /** Dated before it and still not done. */
  overdue: number;
  /** Hard deadlines falling on it. */
  deadlines: number;
}

/**
 * What the agenda counts, for a day that hasn't happened yet.
 *
 * Deliberately based on the dates a task carries rather than on
 * `isTaskVisible`, which answers "is this on Today *right now*" and can't
 * answer it about tomorrow morning. Counting what's dated for the day is both
 * computable ahead of time and the thing a morning summary is actually about.
 *
 * Subtasks are excluded the way every top-level list excludes them, and
 * completed or archived rows never count. The caller filters out anything
 * hidden by vacation mode before this sees it — that's a store read, and
 * keeping it out here is what leaves this testable.
 *
 * A recurring task contributes only its current row, since future occurrences
 * aren't materialised until completion. That's accurate for the next agenda —
 * the only one ever scheduled — and would drift for one further out.
 */
export function agendaCounts(tasks: Task[], targetDay: Date, dayResetTime: string): AgendaCounts {
  const target = getDayStart(targetDay, dayResetTime);
  let due = 0;
  let overdue = 0;
  let deadlines = 0;

  for (const task of tasks) {
    if (task.completed || task.archived || task.parentId) continue;

    if (task.dueDate) {
      const day = getDayStart(new Date(task.dueDate), dayResetTime);
      if (isSameDay(day, target)) due++;
      else if (day < target) overdue++;
    }

    if (task.deadline) {
      const day = getDayStart(new Date(task.deadline), dayResetTime);
      if (isSameDay(day, target)) deadlines++;
    }
  }

  return { due, overdue, deadlines };
}

/**
 * The notification body, or null when there's nothing worth waking someone for.
 *
 * Null rather than "0 tasks today" is the whole design of this feature: a
 * daily notification that fires on empty days is the one people turn off, and
 * the caller skips scheduling entirely when this returns null.
 */
export function agendaBody(counts: AgendaCounts): string | null {
  const parts: string[] = [];
  if (counts.due > 0) parts.push(`${counts.due} due`);
  if (counts.overdue > 0) parts.push(`${counts.overdue} overdue`);
  if (counts.deadlines > 0) {
    parts.push(`${counts.deadlines} deadline${counts.deadlines === 1 ? '' : 's'}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The next time the agenda should fire — today's occurrence of `hhmm` if it's
 * still ahead, otherwise tomorrow's.
 *
 * Strictly after `now`: scheduling one for the current minute races the
 * trigger and either fires immediately or is dropped for being in the past,
 * and both look like a bug from the outside.
 */
export function nextAgendaTime(now: Date, hhmm: string): Date {
  const today = hhmmToDate(hhmm, now);
  if (today > now) return today;
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow;
}
