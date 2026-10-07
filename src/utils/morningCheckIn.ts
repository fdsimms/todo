import type { Task } from '../types';
import { getDayStart, getEffectiveTaskDate, getTaskDayStart } from './dateUtils';
import { isHeldBack, isQuotaTask, isWithheld } from './visibilityUtils';
import { isNegativeTask } from './negativeHabits';

/**
 * A recurring task whose day has already come and gone with nothing said
 * about it — not completed, not marked missed, not still stuck on something
 * else. This is the set the morning check-in offers to resolve: the same row
 * that would otherwise just sit there reading as overdue, surfaced once
 * instead of left for the user to notice (or not) on their own.
 *
 * Deliberately excludes:
 * - negative habits (`isNegativeTask`) — there's nothing to complete, see
 *   Task.polarity and `logSlip`.
 * - a target (`isQuotaTask`), daily or weekly — it is resolved by counting, and
 *   `rolloverQuotas` closes it when its period ends.
 * - anything `isHeldBack` — a task waiting on a person or another task hasn't
 *   been skipped, it's still stuck, and asking "did you do this?" is the
 *   wrong question for it.
 * - anything `isWithheld` — a task vacation mode is hiding (its own pause, or
 *   a category hidden on vacation) or one in a paused project; the whole
 *   point of either is that its schedule doesn't count while it's on. The
 *   check used to read the raw `vacationPause` flag, which excluded those
 *   tasks even with vacation off and missed the category form entirely.
 *
 * A deadline is not required. It used to be, on the reasoning that asking
 * about every overdue habit was heavy-handed, but a daily habit with no
 * deadline then sat open and overdue with no miss on record, and finishing it
 * late spawned a second row for today. Every recurring task is asked about.
 *
 * One live row per recurring task (see the Recurrence note in CLAUDE.md), so
 * "yesterday's task, unresolved" is just this row's own `dueDate` sitting in
 * the past — there's no separate history to look up.
 */
export function isMorningCheckInCandidate(task: Task, dayResetTime?: string): boolean {
  if (task.parentId) return false;
  if (task.completed || task.archived) return false;
  if (task.recurrenceType === 'none') return false;
  if (isNegativeTask(task)) return false;
  // A target counts toward its own period and `rolloverQuotas` closes it out
  // when that period ends, recording the count. A weekly one keeps its spawn
  // day as `dueDate` all week, so it read as "yesterday, unanswered" every
  // morning, and a yes/no answer can't describe a 3-of-5 week anyway.
  if (isQuotaTask(task)) return false;
  if (isHeldBack(task)) return false;
  // Withheld (vacation or a paused project): nobody could have done it, so
  // asking would record a miss.
  if (isWithheld(task)) return false;
  if (!task.dueDate) return false;
  // The date the row reads as, not the raw dueDate: pushing a task writes a
  // later `deferUntil` and leaves `dueDate` on the day it was pushed from, so
  // judging by dueDate asked about a task you had chosen to move, every
  // morning until the day it came back.
  const readsAs = getEffectiveTaskDate(task, dayResetTime) ?? task.dueDate;
  return getTaskDayStart(new Date(readsAs), dayResetTime) < getDayStart(new Date(), dayResetTime);
}

/** The full set across all tasks, in no particular order — callers group it. */
export function morningCheckInTasks(tasks: Task[], dayResetTime?: string): Task[] {
  return tasks.filter(t => isMorningCheckInCandidate(t, dayResetTime));
}
