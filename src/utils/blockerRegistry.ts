import type { Project, Task } from '../types';
import type { TaskResolver } from './blocking';
import { stepNumbersByTask } from './projectOrder';

/**
 * How visibilityUtils resolves the two things that hold a task back — the task
 * it's waiting on (Task.blockedById) and its place in a sequential project's
 * order (Project.sequential) — without importing either store.
 *
 * It can't import it directly: useTaskStore pulls in src/db/database.ts and
 * therefore expo-sqlite, which doesn't exist under Jest's node environment, and
 * the store already imports visibilityUtils at the top level. So the store
 * pushes a *getter* in here at module load and this leaf module — which imports
 * nothing but types — hands it back on demand.
 *
 * Pull-based rather than a pushed snapshot on every write: there is no listener
 * to wire up and no moment where the registry can be stale, because it reads
 * the live array each time and only rebuilds its index when that array's
 * identity changes (the store always replaces `tasks` on mutation). That keeps
 * the lookup O(1) per row — isTaskVisible runs once per row, so a find() per
 * call would make a list render O(n²).
 */

let source: (() => Task[]) | null = null;
let cachedTasks: Task[] | null = null;
let cachedById: Map<string, Task> | null = null;
let cachedCountTasks: Task[] | null = null;
let cachedCounts: Map<string, number> | null = null;
let projectSource: (() => Project[]) | null = null;
let cachedProjects: Project[] | null = null;
let cachedSequentialIds: Set<string> | null = null;
let cachedStepTasks: Task[] | null = null;
let cachedSteps: Map<string, number> | null = null;

/** Called once by useTaskStore at module load. Tests can point it at a fixture. */
export function registerTaskSource(fn: (() => Task[]) | null): void {
  source = fn;
  cachedTasks = null;
  cachedById = null;
  cachedCountTasks = null;
  cachedCounts = null;
  cachedStepTasks = null;
  cachedSteps = null;
}

/** The same, for useProjectStore — see isSequenceHeld. */
export function registerProjectSource(fn: (() => Project[]) | null): void {
  projectSource = fn;
  cachedProjects = null;
  cachedSequentialIds = null;
}

/**
 * Resolves a task id, or undefined when there's no source registered yet.
 *
 * Undefined is the safe answer: canBlock() reads it as "can't block", so a
 * context that never registered a source simply has no blocked tasks rather
 * than hiding work it can't account for.
 */
export const resolveBlocker: TaskResolver = id => {
  const tasks = source?.();
  if (!tasks) return undefined;
  if (tasks !== cachedTasks) {
    cachedTasks = tasks;
    cachedById = new Map(tasks.map(t => [t.id, t]));
  }
  return cachedById!.get(id);
};

/**
 * How many live tasks are waiting on this one — the "N waiting" chip.
 *
 * Indexed the same way and for the same reason: every visible row asks this
 * once, so counting by scanning would be O(n²) across a list render. Built once
 * per store change instead, then read O(1) per row.
 */
export function waitingCountFor(id: string): number {
  const tasks = source?.();
  if (!tasks) return 0;
  if (tasks !== cachedCountTasks) {
    cachedCountTasks = tasks;
    cachedCounts = new Map();
    for (const t of tasks) {
      if (!t.blockedById || t.completed || t.archived || t.parentId) continue;
      cachedCounts.set(t.blockedById, (cachedCounts.get(t.blockedById) ?? 0) + 1);
    }
  }
  return cachedCounts!.get(id) ?? 0;
}

/**
 * Which step a task stands at in its project's order, 1-based, or undefined if
 * it isn't a live top-level member of one.
 *
 * Indexed per store change like the two above, and for the same reason: the
 * project screen asks once per row and isTaskVisible asks once per row of every
 * *other* list, so a scan per call would be O(n²) across a render.
 */
export function stepNumberOf(task: Task): number | undefined {
  const tasks = source?.();
  if (!tasks) return undefined;
  if (tasks !== cachedStepTasks) {
    cachedStepTasks = tasks;
    cachedSteps = stepNumbersByTask(tasks);
  }
  return cachedSteps!.get(task.id);
}

function sequentialProjectIds(): Set<string> {
  const projects = projectSource?.();
  if (!projects) return new Set();
  if (projects !== cachedProjects) {
    cachedProjects = projects;
    cachedSequentialIds = new Set(projects.filter(p => p.sequential).map(p => p.id));
  }
  return cachedSequentialIds!;
}

/** True when the task's project is sequential and an earlier step is still open. */
export function isSequentialProject(projectId: string | null): boolean {
  return projectId != null && sequentialProjectIds().has(projectId);
}

/**
 * True while a sequential project is holding this task back — the second way a
 * task can be blocked, derived entirely from its position (see
 * utils/projectOrder). No sources registered means false, the same safe answer
 * resolveBlocker gives: a context that can't see the projects hides nothing.
 */
export function isSequenceHeld(task: Task): boolean {
  if (task.completed || task.archived || task.parentId) return false;
  if (!isSequentialProject(task.projectId)) return false;
  const step = stepNumberOf(task);
  // stepNumbersByTask ranks only live members, so anything past the first has
  // an unfinished step above it by construction.
  return step !== undefined && step > 1;
}
