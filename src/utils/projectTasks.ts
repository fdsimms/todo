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
