import type { Task } from '../types';
import {
  isInboxTask,
  isTaskDeferred,
  isTaskVisible,
  isUnscheduledTask,
} from './visibilityUtils';

/**
 * Where a task currently has a row to scroll to: one of Today's four lists, or
 * the Archived screen. The order is `handleTaskCreated`'s in `TodayScreen`, so a
 * task is "located" in the same list it would have landed in when it was made.
 *
 * `null` means no list holds it right now: completed (Logbook rows aren't
 * individually addressable), a subtask (its parent is the row, so resolve the
 * parent first), or held back (blocked, vacation-paused, expired, in a paused
 * project, or filed in a project with no date, whose home is the project's own
 * page). A caller falls back to the editor for those, rather than guessing a
 * list the task isn't on.
 */
export type TaskHome = 'today' | 'later' | 'unscheduled' | 'inbox' | 'archived';

export function taskHomeFor(task: Task): TaskHome | null {
  if (task.archived) return 'archived';
  if (task.completed || task.parentId) return null;
  if (isInboxTask(task)) return 'inbox';
  if (isTaskVisible(task)) return 'today';
  if (isUnscheduledTask(task)) return 'unscheduled';
  if (isTaskDeferred(task)) return 'later';
  return null;
}
