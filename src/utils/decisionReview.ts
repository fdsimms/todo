import { addMonths } from 'date-fns/addMonths';
import { addWeeks } from 'date-fns/addWeeks';
import { format } from 'date-fns/format';
import type { Task, TaskDraft } from '../types';
import { activeChainStep } from './chain';
import { formatTaskDeliverable, isTentativeAnswer } from './deliverables';

/**
 * Looking back on a decision: a task that asks a question on completion
 * ("Which contractor?") can, as it's answered, ask to come back later and ask
 * how it turned out. That second question is an ordinary task, due on the day
 * chosen, asking for text, with `Task.reviewOfTaskId` pointing at the answered
 * row; its answer is the decision's outcome.
 *
 * **The outcome is read by joining, never written onto the decision.** The
 * decision's row stays exactly as it was answered, so undoing the look-back's
 * completion, deleting it, or syncing it from another device has nothing to
 * put back on a second row. Every reader that shows an answer asks
 * `decisionOutcomes` for the one beside it.
 *
 * **It is asked for, never offered by itself.** Nothing schedules a look-back
 * unless the person picks a delay in the prompt (or Claude passes one), so it
 * isn't a generated task: it's in the list because somebody put it there.
 */

/** How long to wait before asking, as the prompt offers it. */
export type ReviewAfter = '2w' | '1m' | '3m' | '6m';

export const REVIEW_AFTER_OPTIONS: readonly { value: ReviewAfter; label: string }[] = [
  { value: '2w', label: '2 weeks' },
  { value: '1m', label: '1 month' },
  { value: '3m', label: '3 months' },
  { value: '6m', label: '6 months' },
];

export function isReviewAfter(value: unknown): value is ReviewAfter {
  return REVIEW_AFTER_OPTIONS.some(o => o.value === value);
}

/** The day the look-back is due, counted from the logical day the decision was made. */
export function reviewDueDay(decidedDayStart: Date, after: ReviewAfter): Date {
  const day = new Date(decidedDayStart);
  day.setHours(12, 0, 0, 0);
  switch (after) {
    case '2w': return addWeeks(day, 2);
    case '1m': return addMonths(day, 1);
    case '3m': return addMonths(day, 3);
    case '6m': return addMonths(day, 6);
  }
}

/**
 * Whether an answer can be looked back on: a real answer (not declined, not a
 * "Maybe" that leaves the task open) on a task that isn't itself a look-back,
 * since asking how "how did it go" went is a loop nobody wants.
 */
export function canReviewDecision(task: Pick<Task, 'reviewOfTaskId'>, value: string | null | undefined): boolean {
  if (task.reviewOfTaskId) return false;
  if (value === null || value === undefined || value.trim() === '') return false;
  return !isTentativeAnswer(value);
}

/** The question a decision was answering: the live chain step's title mid-chain, else the task's. */
function questionOf(task: Task): string {
  return activeChainStep(task)?.title ?? task.title;
}

/**
 * The look-back task for an answered decision. `answered` is the row as it
 * will be written (completed, holding the answer), so the notes quote the
 * answer exactly as the Logbook shows it. Filed where the decision was, so it
 * turns up in the same project and category.
 */
export function reviewTaskDraft(answered: Task, after: ReviewAfter, decidedDayStart: Date): TaskDraft {
  const answer = formatTaskDeliverable(answered) ?? answered.deliverableValue ?? '';
  return {
    title: `How did it turn out? ${questionOf(answered)}`,
    notes: `You answered “${answer}” on ${format(decidedDayStart, 'MMM d, yyyy')}.`,
    dueDate: reviewDueDay(decidedDayStart, after).toISOString(),
    category: answered.category,
    projectId: answered.projectId,
    tags: answered.tags,
    deliverableKind: 'text',
    reviewOfTaskId: answered.id,
  } as TaskDraft;
}

/** What a decision turned out to be, from its look-back's answer. */
export interface DecisionOutcome {
  /** The look-back's own answer, as typed. */
  text: string;
  /** When the look-back was answered. */
  at: string;
  reviewTaskId: string;
}

/**
 * Every decision's outcome, keyed by the decision's id: the latest answered
 * look-back pointing at it. A missed look-back, or one completed without an
 * answer, says nothing about how the decision went, so it isn't one.
 */
export function decisionOutcomes(tasks: readonly Task[]): Map<string, DecisionOutcome> {
  const out = new Map<string, DecisionOutcome>();
  for (const t of tasks) {
    if (!t.reviewOfTaskId || !t.completed || t.missedAt) continue;
    const text = t.deliverableValue?.trim();
    if (!text) continue;
    const at = t.completedAt ?? t.createdAt;
    const prior = out.get(t.reviewOfTaskId);
    if (!prior || prior.at < at) out.set(t.reviewOfTaskId, { text, at, reviewTaskId: t.id });
  }
  return out;
}

/** The open look-back waiting on a decision, if one is scheduled. */
export function pendingReviewOf(tasks: readonly Task[], decisionId: string): Task | null {
  return tasks.find(t => t.reviewOfTaskId === decisionId && !t.completed && !t.archived) ?? null;
}
