import type { Task } from '../types';
import { getDayStart, getTaskDayStart } from './dateUtils';
import { isHeldBack } from './visibilityUtils';
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
 * - anything `isHeldBack` — a task waiting on a person or another task hasn't
 *   been skipped, it's still stuck, and asking "did you do this?" is the
 *   wrong question for it.
 * - a paused vacation task — the whole point of the pause is that its
 *   schedule doesn't count while it's on.
 *
 * One live row per recurring task (see the Recurrence note in CLAUDE.md), so
 * "yesterday's task, unresolved" is just this row's own `dueDate` sitting in
 * the past — there's no separate history to look up.
 */
export function isMorningCheckInCandidate(task: Task, dayResetTime?: string): boolean {
  if (task.parentId) return false;
  if (task.completed || task.archived) return false;
  if (task.recurrenceType === 'none') return false;
  if (task.vacationPause) return false;
  if (isNegativeTask(task)) return false;
  if (isHeldBack(task)) return false;
  if (!task.dueDate) return false;
  return getTaskDayStart(new Date(task.dueDate), dayResetTime) < getDayStart(new Date(), dayResetTime);
}

/** The full set across all tasks, in no particular order — callers group it. */
export function morningCheckInTasks(tasks: Task[], dayResetTime?: string): Task[] {
  return tasks.filter(t => isMorningCheckInCandidate(t, dayResetTime));
}
