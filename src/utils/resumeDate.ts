import type { Task } from '../types';
import { getCurrentDayStart, getLogicalToday, getTaskDayStart } from './dateUtils';

/** A resumed task's day: keep what it had, move it to today, or clear it. */
export type ResumeDate = 'keep' | 'today' | 'none';

/** True when the task would come back on a day that has already gone by. */
export function hasStaleDate(task: Pick<Task, 'dueDate'>, dayResetTime?: string): boolean {
  if (!task.dueDate) return false;
  return getTaskDayStart(new Date(task.dueDate), dayResetTime) < getCurrentDayStart();
}

/**
 * What `unarchiveTask` should be handed as `dueDate` for this task and answer:
 * undefined keeps the stored day. A day that hasn't passed is never touched, so
 * one answer can cover a selection that mixes stale and upcoming tasks.
 */
export function resumeDueDateFor(task: Pick<Task, 'dueDate'>, choice: ResumeDate, dayResetTime?: string): string | null | undefined {
  if (choice === 'keep' || !hasStaleDate(task, dayResetTime)) return undefined;
  return choice === 'today' ? getLogicalToday(dayResetTime).toISOString() : null;
}
