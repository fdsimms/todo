import type { Task } from '../types';
import { isQuotaTask, isRecurrenceNotYetDue } from './visibilityUtils';
import { asksOnCompletion } from './deliverables';

/**
 * What a tap on a task's checkbox should do, for the surfaces that show a
 * task's completion state without being the task row itself — Search, and the
 * quick-search palette.
 *
 * TaskItem doesn't use this: its own tap handler is tangled up with the
 * completion animation, the pace send-off and the hold window, none of which
 * these surfaces have. But the *decision* — tick, ask first, log one unit,
 * refuse — is the same one, and it was the part that got copied wrong when a
 * second surface wanted it, so it lives here with tests rather than being
 * re-derived from `task.targetCount` at each call site.
 */
export type CompletionTap =
  /** Ordinary tick: complete it. */
  | 'complete'
  /** A decision task (see Task.deliverableKind) — ask for the answer first. */
  | 'ask'
  /** A daily target below its count: this tap logs one unit, not the lot. */
  | 'log-unit'
  /** Already done: put it back on the list. */
  | 'uncomplete'
  /** A recurring task whose day hasn't come round yet; it can't be ticked early. */
  | 'locked';

/**
 * Order matters here, and each step is load-bearing:
 *
 * - `completed` first, because `isQuotaTask` is a shape test (targetCount > 1)
 *   and stays true for a finished target — asked later it would offer to log a
 *   ninth glass onto a task that closed out yesterday.
 * - `locked` before anything that writes, so a recurring task showing early in
 *   a search result can't be completed ahead of its day. Same gate TaskItem's
 *   box uses (`completionLocked`). Being *blocked* by another task is
 *   deliberately not a lock: TaskItem lets a blocked task be ticked too, and
 *   search is one of the two places a blocked task is even listed.
 * - `log-unit` before `ask`, so the unit that *meets* the target still gets the
 *   question a decision task is owed. Below the target there's nothing to ask
 *   about: the task isn't finishing.
 * - `allowOvershoot` never auto-completes at the target — logging past it just
 *   keeps counting, and the rollover sweep closes the task out (see
 *   sweepOvershootQuotas).
 */
export function completionTapFor(task: Task): CompletionTap {
  if (task.completed) return 'uncomplete';
  if (isRecurrenceNotYetDue(task)) return 'locked';
  if (isQuotaTask(task)) {
    const reachesTarget = !task.allowOvershoot && task.progressCount + 1 >= task.targetCount!;
    if (!reachesTarget) return 'log-unit';
  }
  if (asksOnCompletion(task)) return 'ask';
  return 'complete';
}
