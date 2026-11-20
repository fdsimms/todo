import type { Task } from '../types';

const byProjectCache = new WeakMap<readonly Task[], Map<string, Task[]>>();
const NONE: readonly Task[] = [];

/**
 * The rows of `tasks` filed under one project, in their original order, with
 * the whole array bucketed once per task array.
 *
 * A reader that wants one project's rows used to filter every task for them,
 * history included, and a screen listing projects did that once per project
 * on every task write: projects times tasks. Bucketing is one pass, shared by
 * every project asked about until the array changes.
 *
 * Keyed on the array's identity, like `openTasksOf`, and sound for the same
 * reason: the store never mutates the array or a task in place.
 */
export function projectTasksOf(tasks: readonly Task[], projectId: string): readonly Task[] {
  let byProject = byProjectCache.get(tasks);
  if (!byProject) {
    byProject = new Map();
    for (const task of tasks) {
      if (!task.projectId) continue;
      const rows = byProject.get(task.projectId);
      if (rows) rows.push(task);
      else byProject.set(task.projectId, [task]);
    }
    byProjectCache.set(tasks, byProject);
  }
  return byProject.get(projectId) ?? NONE;
}

const bySeriesCache = new WeakMap<readonly Task[], Map<string, Task[]>>();

/**
 * The rows of `tasks` that share a series (`Task.seriesId`), in their original
 * order, bucketed once per array for the same reason as `projectTasksOf`: a
 * row that names the other dates of its series asked every task for them, and
 * a list showing several such rows asked once per row on every task write.
 */
export function seriesTasksOf(tasks: readonly Task[], seriesId: string): readonly Task[] {
  let bySeries = bySeriesCache.get(tasks);
  if (!bySeries) {
    bySeries = new Map();
    for (const task of tasks) {
      if (!task.seriesId) continue;
      const rows = bySeries.get(task.seriesId);
      if (rows) rows.push(task);
      else bySeries.set(task.seriesId, [task]);
    }
    bySeriesCache.set(tasks, bySeries);
  }
  return bySeries.get(seriesId) ?? NONE;
}

