import type { Task } from '../types';
import { formatTaskDate } from './dateUtils';

/**
 * Where a newly created task landed, for the toast TodayScreen shows instead
 * of navigating there — the three sub-views other than Today itself, which
 * the screen already shows without switching anything.
 */
export type CreatedTaskDestination = 'later' | 'unscheduled' | 'inbox';

/**
 * The toast's message for a task that didn't land on Today — names where it
 * went, so staying put still answers "did that work" without having to go
 * look. `formatTaskDate` can come back null for a 'later' task placed by a
 * deadline or time-of-day alone rather than a dueDate/deferUntil, hence the
 * fallback.
 */
export function describeCreatedTaskPlacement(
  task: Pick<Task, 'title' | 'dueDate' | 'deferUntil'>,
  destination: CreatedTaskDestination,
  dayResetTime?: string,
): string {
  switch (destination) {
    case 'later':
      return `Created "${task.title}" for ${formatTaskDate(task, dayResetTime) ?? 'later'}`;
    case 'unscheduled':
      return `Created "${task.title}" in Unscheduled`;
    case 'inbox':
      return `Created "${task.title}" in Inbox`;
  }
}
