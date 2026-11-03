import type { Task } from '../types';
import { taskHomeFor } from './taskHome';

/** The sub-views of Today a person can be looking at. */
export type TodayView = 'today' | 'later' | 'unscheduled' | 'inbox';

/**
 * Where a task went when saving it in the editor took it off the list the
 * person was looking at, or null when it didn't leave one.
 *
 * Setting a date, a project or a category in the editor moved the row out of
 * view with nothing to say where it had gone (a task made from quick add gets a
 * toast; an edit got none). Only the three lists a toast can point at count:
 * a task arriving on Today needs no pointer, and an archive has its own undo
 * bar. "Left the list they were on" is `before === view`, so an editor opened
 * from search or a project page, which was never in this view, says nothing.
 */
export function editedTaskMove(
  previous: Task,
  updated: Task,
  view: TodayView,
): 'later' | 'unscheduled' | 'inbox' | null {
  const before = taskHomeFor(previous);
  const after = taskHomeFor(updated);
  if (before !== view || after === before) return null;
  return after === 'later' || after === 'unscheduled' || after === 'inbox' ? after : null;
}
