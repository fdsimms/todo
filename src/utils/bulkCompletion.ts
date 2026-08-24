import type { Task } from '../types';
import { asksOnCompletion } from './deliverables';
import { isRecurrenceNotYetDue } from './visibilityUtils';

/**
 * Which tasks in a set would lose an answer if the set were completed in one
 * go, and how to say so.
 *
 * Completing a task from a row asks its question first (see
 * `Task.deliverableKind` and TaskItem's `asksOnComplete`), and so does the
 * Waiting screen. The paths that complete several at once didn't: the bulk
 * bar, a stack's "complete all", the focus session's Done button and the Live
 * Activity fallback all called `completeTask` with no answer, which the store
 * reads as "nobody asked" and completes unanswered. That is the right default
 * for a path with nobody there (the missed sweep, the quota rollover), and
 * wrong for every one of these, where a person just tapped something. The
 * answer went nowhere and nothing said so — and since a date answer can now
 * place the next chain step (`ChainItem.deliverableDatesNextStep`), what was
 * lost was a task's date rather than only a note.
 *
 * So a bulk path asks first, and this is the pure half of that question.
 */

/**
 * The tasks here that would stop and ask, in the order given.
 *
 * Deliberately narrower than `asksOnCompletion` alone: a task the bulk
 * completion wouldn't actually complete must not be prompted for, or the user
 * answers a question about a row that then doesn't move. `completeTask`
 * no-ops on both of these, so they are the same two guards it applies.
 *
 * A daily target below its count is *not* one of them, though a tap on its own
 * row would log a unit rather than complete it (`completionTapFor`): a bulk
 * completion of a quota task completes it outright, forcing the count to
 * target, so it reaches its question like anything else.
 */
export function tasksAskingOnCompletion(tasks: readonly Task[]): Task[] {
  return tasks.filter(t => !t.completed && !isRecurrenceNotYetDue(t) && asksOnCompletion(t));
}

/** What the confirm says, for `count` tasks that would go unanswered. */
export function unansweredCompletionCopy(count: number): { title: string; message: string } {
  return {
    title: count === 1 ? '1 task asks a question' : `${count} tasks ask a question`,
    message:
      count === 1
        ? 'You can answer it now, or complete it with no answer recorded.'
        : 'You can answer them one at a time, or complete them with no answer recorded.',
  };
}
