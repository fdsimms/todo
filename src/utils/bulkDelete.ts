import type { Task } from '../types';
import { isLiveRecurring, isMissableMealPlanTask } from './visibilityUtils';

/**
 * Which tasks in a selection a bulk delete should offer to mark missed
 * instead, and how to ask.
 *
 * `bulkCompletion.ts`'s shape for the other bulk question, and the same split:
 * the hook (`useTaskSelection`) owns the alert and the store calls, and this is
 * the pure half it asks first.
 *
 * A live recurring task makes "delete" ambiguous (skip this one, or end the
 * series?), and a meal-plan task whose day has come is the same ambiguity for
 * a different reason: it has no series to end, but deleting it outright still
 * loses the record a mark-missed would have kept. For a mixed selection, "Mark
 * missed" marks just those tasks missed and deletes the rest; the destructive
 * button deletes the whole selection.
 */
export type BulkDeletePrompt =
  /** Nothing in the selection is missable: a plain confirm. */
  | { kind: 'delete' }
  | {
      kind: 'missable';
      /** The tasks a mark-missed keeps a record of, in selection order. */
      missableIds: string[];
      /** The rest of the selection, deleted on either answer. */
      restIds: string[];
      /** The question, before the undo hint the alert appends. */
      message: string;
      /** The destructive button's label. */
      deleteLabel: string;
    };

/**
 * The prompt for deleting `ids` out of `tasks`. An id with no task behind it
 * is not missable, so it goes with the rest and deletes (as a no-op) on either
 * answer.
 */
export function bulkDeletePrompt(ids: readonly string[], tasks: readonly Task[]): BulkDeletePrompt {
  const missable = ids
    .map(id => tasks.find(t => t.id === id))
    .filter((t): t is Task => !!t && (isLiveRecurring(t) || isMissableMealPlanTask(t)));
  if (missable.length === 0) return { kind: 'delete' };
  const missableIds = missable.map(t => t.id);
  const restIds = ids.filter(id => !missableIds.includes(id));

  // A single missable task knows definitively which kind it is, and a uniform
  // multi-select does too once nothing outside the missable set is along for
  // the ride. Only a genuinely mixed selection still needs the "or"; this
  // mirrors TaskEditor's own single-task delete prompts rather than hedging.
  const wholeSelectionMissable = restIds.length === 0;
  // The message has to reflect which reason(s) are actually in the missable
  // set, not just whether the selection also has non-missable tasks along for
  // the ride: a recurring task selected next to an ordinary one has no
  // meal-plan task in it at all, and saying "repeat or came from your meal
  // plan" in that case is just wrong, not merely hedged.
  const hasRecurring = missable.some(isLiveRecurring);
  const hasMealPlan = missable.some(isMissableMealPlanTask);
  const one = missable.length === 1;

  if (hasRecurring && !hasMealPlan) {
    return {
      kind: 'missable',
      missableIds,
      restIds,
      message: one
        ? 'This task repeats. Mark this one missed, or delete it and stop it repeating?'
        : 'These tasks repeat. Mark them missed, or delete them and stop them repeating?',
      deleteLabel: wholeSelectionMissable ? 'Delete and stop repeating' : 'Delete anyway',
    };
  }
  if (hasMealPlan && !hasRecurring) {
    return {
      kind: 'missable',
      missableIds,
      restIds,
      message: one
        ? 'This came from your meal plan. Mark it missed to keep a record, or delete it?'
        : 'These came from your meal plan. Mark them missed to keep a record, or delete them?',
      deleteLabel: wholeSelectionMissable ? 'Delete' : 'Delete anyway',
    };
  }
  return {
    kind: 'missable',
    missableIds,
    restIds,
    message: 'Some selected tasks repeat or came from your meal plan. Mark those missed, or delete the whole selection?',
    deleteLabel: 'Delete anyway',
  };
}
