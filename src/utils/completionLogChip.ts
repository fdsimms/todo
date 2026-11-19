import type { Task } from '../types';
import { offersMealLogOnCompletion } from './completionTap';
import { formatDose, medicationsFor } from './medicationLog';

/**
 * The chips a task row shows to say that ticking it records something: a dose
 * in the medication log, or a meal in the food log. Without them a row that
 * logs a dose looks exactly like one that doesn't, and the tick is the only
 * way to find out.
 *
 * Each answer comes from the function the completion itself reads, never a
 * lookalike: `medicationsFor` (which already prefers the active chain step's
 * medicine over the task's) for doses, and `offersMealLogOnCompletion` for the
 * sheet that asks what you ate. A saved meal (`logSavedMealId`) is written by
 * the tick with no sheet. One whose saved meal has since been deleted falls
 * back to the sheet at completion time; a list row can't know that, so it
 * still says "Logs to food log".
 */
export interface CompletionLogChip {
  kind: 'dose' | 'food';
  text: string;
}

export function completionLogChips(task: Task, mealLogPromptEnabled: boolean): CompletionLogChip[] {
  if (task.completed) return [];
  const chips: CompletionLogChip[] = [];

  const doses = medicationsFor(task);
  if (doses.length === 1) {
    const phrase = formatDose({ amount: doses[0].amount, unit: doses[0].unit, strength: null });
    chips.push({ kind: 'dose', text: phrase ? `Logs ${phrase}` : 'Logs dose' });
  } else if (doses.length > 1) {
    chips.push({ kind: 'dose', text: `Logs ${doses.length} doses` });
  }

  if (task.logSavedMealId) {
    chips.push({ kind: 'food', text: 'Logs to food log' });
  } else if (offersMealLogOnCompletion(task, mealLogPromptEnabled)) {
    chips.push({ kind: 'food', text: 'Asks what you ate' });
  }
  return chips;
}
