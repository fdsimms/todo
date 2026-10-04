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
  /** The stack it is filed in (list_stacks names it). */
  stackId?: string;
  dueDate?: string;
  deadline?: string;
  deferUntil?: string;
  timeSegments?: string[];
  /** 'Low' | 'Medium' | 'High' | 'Urgent'. Absent for the 'None' default. */
  priority?: string;
  /** 'easy' | 'normal' | 'hard'. Absent when the task was never rated. */
  difficulty?: string;
  estimatedMinutes?: number;
  /** Present only mid-chain, and then it is where `title` came from. */
  chainStep?: string;
  /** The question this task asks when it is completed, if it asks one. */
  asksOnCompletion?: string;
  /** The answers a Yes/No or Pick one question offers; complete_task takes one of these. */
  answerOptions?: string[];
  /**
   * The answer recorded against this occurrence, where one was given.
   *
   * Absent both when the task asks nothing and when it asks but was completed
   * without an answer, which is the same absence the app draws — a declined
   * question leaves no value. Per-occurrence rather than per-task: a recurring
   * decision task's log is the log of its answers, not one answer copied
   * forward.
   */
  answer?: string;
  /** Why that answer was given, where it was recorded with it. */
  why?: string;
  /** What would reopen the decision, where it was recorded with it. */
  revisitIf?: string;
  recurring?: boolean;
  pinned?: boolean;
  /** On a repeating task: every occurrence it spawns starts pinned. */
  pinsEachOccurrence?: boolean;
  /**
   * Held by something rather than merely not due yet — waiting on another task
   * or on a person. Worth its own field because the two are easy to conflate
   * and only one of them is the user's to act on.
   */
  blocked?: boolean;
  /**
   * On a branch that wasn't taken (see `onlyIfAnswer` on get_task): another
   * answer was picked, so this will never be done. Off every list, and left
   * out of its project's count.
   */
  notNeeded?: boolean;
  /**
   * A repeating task's occurrence that was marked missed. It is also
   * `completed: true`, because a miss is history rather than a live row, so
   * without this a missed occurrence reads as done. Not a completion.
   */
  missed?: boolean;
  /** Which of the app's generators wrote this task unasked (weather, birthday, meal...). Absent on anything a person typed. */
  generatedBy?: string;
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
    stackId: task.groupId ?? undefined,
    dueDate: task.dueDate ?? undefined,
    deadline: task.deadline ?? undefined,
    deferUntil: task.deferUntil ?? undefined,
    timeSegments: task.timeSegments,
    priority: task.priority > 0 ? PRIORITY_LABELS[task.priority] : undefined,
    difficulty: task.difficulty ?? undefined,
    estimatedMinutes: replica.estimatedMinutes(task) ?? undefined,
    chainStep: step?.title,
    asksOnCompletion: replica.deliverableKind(task) ?? undefined,
    answerOptions: (() => {
      const offered = replica.deliverableOptions(task);
      return offered.length > 0 ? offered : undefined;
    })(),
    answer: task.deliverableValue ?? undefined,
    why: task.deliverableWhy ?? undefined,
    revisitIf: task.deliverableRevisitIf ?? undefined,
    recurring: task.recurrenceType !== 'none' ? true : undefined,
    pinned: task.pinned ? true : undefined,
    pinsEachOccurrence: task.pinEachOccurrence ? true : undefined,
    blocked: replica.isBlocked(task) ? true : undefined,
    notNeeded: replica.isNotNeeded(task) ? true : undefined,
    missed: task.missedAt ? true : undefined,
    generatedBy: task.generatedKind ?? undefined,
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
