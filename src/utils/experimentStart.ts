/**
 * Starting a planned experiment from the app: the one place the phone's
 * "Start today" buttons (a task row, the Mood list, the experiment's page)
 * all go through, so they begin it the same way. Not pure (it writes two
 * stores), which is why it is not in `experiments.ts`.
 *
 * The start day is the logical today unless a caller names an earlier one
 * ("I actually started 3 days ago"). Open tasks that start this experiment are
 * checked off with it, except `exceptTaskId`: the row that was tapped runs its
 * own completion, with its own animation.
 */
import type { Experiment } from '../types';
import { useExperimentStore } from '../store/useExperimentStore';
import { useTaskStore } from '../store/useTaskStore';
import { getLogicalToday } from './dateUtils';

export function startPlannedExperiment(
  id: string,
  options: { startDate?: Date; days?: number | null; exceptTaskId?: string } = {},
): Experiment | null {
  const startDate = options.startDate ?? getLogicalToday();
  const started = useExperimentStore.getState().startExperiment(id, {
    startDate,
    ...(options.days !== undefined ? { days: options.days } : {}),
  });
  if (!started) return null;
  const { tasks, completeTask } = useTaskStore.getState();
  for (const task of tasks) {
    if (task.experimentId !== id || task.completed || task.archived || task.id === options.exceptTaskId) continue;
    completeTask(task.id);
  }
  return started;
}
