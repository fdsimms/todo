/**
 * What a `Task` looks like once it leaves the server.
 *
 * `Task` has north of a hundred fields and most of them are machinery: pace
 * ramps, supply counters, sync bookkeeping, three separate recurrence anchors.
 * Handing one over raw is not "complete", it is a tool result that spends its
 * whole budget on `supplyDeclinedAtCount` and has no room left for the other
 * nineteen tasks. So this is a deliberate projection, and the rule for what
 * earns a place is: **what a row shows, plus the state a question could be
 * about.**
 *
 * Adding a field here costs every task in every list. `get_task` is where a
 * field that only matters once you have singled a task out belongs.
 *
 * Null is dropped rather than serialized. Forty tasks each carrying
 * `"deadline": null` is a page of nothing, and absence reads the same way.
 *
 * `src/types` is the one app module `mcp/src` may import for its values (see
 * replica.ts's rule and why): nothing can reach `database.ts` from it, because
 * the dependency runs the other way.
 */
import { PRIORITY_LABELS } from '../../src/types';
import type { Task } from '../../src/types';
import type { Replica } from './replica';

export interface SerializedTask {
  id: string;
  title: string;
  completed: boolean;
  notes?: string;
  category?: string;
  tags?: string[];
  projectId?: string;
  dueDate?: string;
  deadline?: string;
  deferUntil?: string;
  timeSegments?: string[];
  /** 'Low' | 'Medium' | 'High' | 'Urgent'. Absent for the 'None' default. */
  priority?: string;
  estimatedMinutes?: number;
  /** Present only mid-chain, and then it is where `title` came from. */
  chainStep?: string;
  /** The question this task asks when it is completed, if it asks one. */
  asksOnCompletion?: string;
  recurring?: boolean;
  pinned?: boolean;
  /**
   * Held by something rather than merely not due yet — waiting on another task
   * or on a person. Worth its own field because the two are easy to conflate
   * and only one of them is the user's to act on.
   */
  blocked?: boolean;
}

/** Drops keys whose value is null, undefined, or an empty array. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v != null && !(Array.isArray(v) && v.length === 0))
  ) as T;
}

export function serializeTask(replica: Replica, task: Task): SerializedTask {
  const steps = task.chainItems ?? [];
  // A single-item chain is not a chain (see `activeChainStep`), so it gets no
  // step line — the title already is the step.
  const step = steps.length > 1 ? steps[task.chainIndex ?? 0] : undefined;

  return compact({
    id: task.id,
    // Not `task.title`. Mid-chain the live step owns the title, which is what
    // `displayTitleFor` is for and why every reader in the app goes through it.
    title: replica.displayTitle(task),
    completed: task.completed,
    notes: task.notes || undefined,
    category: task.category ?? undefined,
    tags: task.tags,
    projectId: task.projectId ?? undefined,
    dueDate: task.dueDate ?? undefined,
    deadline: task.deadline ?? undefined,
    deferUntil: task.deferUntil ?? undefined,
    timeSegments: task.timeSegments,
    priority: task.priority > 0 ? PRIORITY_LABELS[task.priority] : undefined,
    estimatedMinutes: replica.estimatedMinutes(task) ?? undefined,
    chainStep: step?.title,
    asksOnCompletion: replica.deliverableKind(task) ?? undefined,
    recurring: task.recurrenceType !== 'none' ? true : undefined,
    pinned: task.pinned ? true : undefined,
    blocked: replica.isBlocked(task) ? true : undefined,
  });
}

/**
 * A whole list, in the order the caller established. Kept separate from
 * `serializeTask` so a tool that has already sorted, capped and filtered does
 * not get quietly re-ordered on the way out.
 */
export function serializeTasks(replica: Replica, tasks: Task[]): SerializedTask[] {
  return tasks.map(t => serializeTask(replica, t));
}
