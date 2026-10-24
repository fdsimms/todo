import type { GeneratedKind, Task } from '../types';

/**
 * What a generated task says when it completes itself, by kind.
 *
 * The line is shown on the row while it plays its completion, so it says what
 * the person did that satisfied the task, which is the only explanation the
 * row's disappearing gets. It is also the list of kinds that may complete
 * themselves at all: a kind with no entry never does, whatever marks it ready.
 *
 * `blockOffer` is left out on purpose. It reads ready because a block *ran for
 * its time*, which is the clock rather than an action, and its coins are held
 * back until the person takes them (`docs/arch/generated-tasks.md`).
 */
const AUTO_COMPLETE_REASONS: Partial<Record<GeneratedKind, string>> = {
  moodLog: 'Logged your mood',
  journalLog: 'Saved your journal entry',
  dreamLog: 'Saved your dream',
  weighIn: 'Recorded your weight',
  bloodPressureLog: 'Recorded your blood pressure',
  waterShortfall: 'Logged your water',
  snackNudge: 'Logged a snack',
  produceNudge: 'Logged your produce',
  produceFloor: 'Logged your produce',
  goalTarget: 'Reached your goal',
  mealSlot: 'Meal done',
  mealCook: 'Meal cooked',
  mealLogNudge: 'Logged your meal',
  mealShortfall: 'Bought everything',
  mealThaw: 'Took it out of the freezer',
  pantryCheck: 'Checked your pantry',
  pantryReview: 'Reviewed your pantry',
  supplyReorder: 'Restocked',
  reachOut: 'Got in touch',
  projectReview: 'Reviewed the project',
  weekendNudge: 'Planned the weekend',
  bookEvent: 'Booked the event',
};

/** The line for a task that may complete itself, or null for one that may not. */
export function autoCompleteReason(task: Pick<Task, 'generatedKind'>): string | null {
  return (task.generatedKind && AUTO_COMPLETE_REASONS[task.generatedKind]) || null;
}
