import type { Task } from '../types';
import { formatTaskDate } from './dateUtils';

/**
 * Where a newly created task landed, for the toast TodayScreen shows instead
 * of navigating there — the three sub-views other than Today itself, which
 * the screen already shows without switching anything, and 'project' for an
 * undated project task, which is on none of them and lives on its project's
 * page.
 */
export type CreatedTaskDestination = 'later' | 'unscheduled' | 'inbox' | 'project';

/**
 * The toast's message for a task that didn't land on Today — names where it
 * went, so staying put still answers "did that work" without having to go
 * look. `formatTaskDate` can come back null for a 'later' task placed by a
 * deadline or time-of-day alone rather than a dueDate/deferUntil, hence the
 * fallback. `projectName` is for 'project'; a project that can't be found
 * reads as "its project".
 */
export function describeCreatedTaskPlacement(
  task: Pick<Task, 'title' | 'dueDate' | 'deferUntil'>,
  destination: CreatedTaskDestination,
  dayResetTime?: string,
  projectName?: string,
): string {
  switch (destination) {
    case 'later':
      return `Created “${task.title}” for ${formatTaskDate(task, dayResetTime) ?? 'later'}`;
    case 'unscheduled':
      return `Created “${task.title}” in Unscheduled`;
    case 'inbox':
      return `Created “${task.title}” in Inbox`;
    case 'project':
      return `Created “${task.title}” in ${projectName ?? 'its project'}`;
  }
}

/**
 * Same toast, for a task that was already in the Inbox and left it by taking
 * an in-row suggestion (see TaskItem's importSuggestion chip) rather than
 * being created. `destination` is never 'inbox' here in practice — a task
 * already in the Inbox that took a suggestion and stayed there has nowhere
 * to go, so nothing calls this for it — but the case is handled rather than
 * assumed away.
 */
export function describeMovedTaskPlacement(
  task: Pick<Task, 'title' | 'dueDate' | 'deferUntil'>,
  destination: CreatedTaskDestination,
  dayResetTime?: string,
  projectName?: string,
): string {
  switch (destination) {
    case 'later':
      return `Moved “${task.title}” to ${formatTaskDate(task, dayResetTime) ?? 'Later'}`;
    case 'unscheduled':
      return `Moved “${task.title}” to Unscheduled`;
    case 'inbox':
      return `Moved “${task.title}” to Inbox`;
    case 'project':
      return `Moved “${task.title}” to ${projectName ?? 'its project'}`;
  }
}
