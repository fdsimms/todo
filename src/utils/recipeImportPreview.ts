import type { ExtractedPrepTask } from '../services/aiSuggestions';

/**
 * The strings behind the Method / Prep tasks rows of a recipe-import review
 * list, shared by `RecipeCreateSheet` and `RecipeExtractSheet` (#1618).
 *
 * Both rows used to say only how *many* steps or tasks an import had found,
 * with the steps themselves arriving unseen — a count is a receipt, not a
 * review, and the one thing the sheet asks you to do is check what it's about
 * to write. So each row unfolds the lines it would add, every one of them
 * correctable and droppable in place, and this module owns every string that
 * appears in one: the row's own summary, the lines inside it, and the label
 * the disclosure reads out.
 *
 * It lives out here rather than in the row component because the counting and
 * pluralisation are the part worth testing, and neither sheet can be rendered
 * in this suite (node environment, no renderer).
 */

/** One line of an unfolded preview: what would be added, and when it happens. */
export interface ImportPreviewLine {
  /** The step's or task's own text. */
  text: string;
  /**
   * A prep task's days-before offset; null for a method step, which has no
   * timing of its own. Carried as the number rather than as
   * `formatOffsetLabel`'s string because the line is editable — the row shows
   * the label and hands the number to a stepper, and a string would have to be
   * parsed back to do that.
   */
  offsetDays: number | null;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * How many of a row's lines are ticked, out of how many were found. Reads as a
 * plain count while they all are, because "7 of 7 steps" is a fraction nobody
 * asked for; it only becomes a fraction once some have been dropped, which is
 * exactly when the collapsed row has to say so — the whole point of being able
 * to untick a line is lost if the folded row still claims all seven.
 */
function chosenCount(chosen: number, total: number, noun: string): string {
  if (chosen === total) return plural(total, noun);
  if (chosen === 0) return `none of ${plural(total, noun)}`;
  return `${chosen} of ${plural(total, noun)}`;
}

/**
 * The Method row's summary. Says what will *happen* rather than only what was
 * found: the method row is the one place a recipe can end up with two methods,
 * so the row that does it is where that has to be readable.
 *
 * The appending clause is dropped once nothing is ticked, since a row that
 * adds no steps doesn't add them after anything.
 */
export function methodRowMeta(chosen: number, total: number, appendsToExisting: boolean): string {
  const count = chosenCount(chosen, total, 'step');
  return appendsToExisting && chosen > 0 ? `${count}, added after the method it already has` : count;
}

/** The Prep tasks row's summary — same appending rule as the method above. */
export function prepTasksRowMeta(chosen: number, total: number, appendsToExisting: boolean): string {
  const count = chosenCount(chosen, total, 'task');
  return appendsToExisting && chosen > 0 ? `${count}, added after what it already has` : count;
}

/**
 * The method as preview lines. Numbering is the row's own (it renders the
 * index), so the text stays exactly the step's — a source that numbers its own
 * steps would otherwise read "1. 1. Preheat the oven".
 */
export function methodPreviewLines(steps: string[]): ImportPreviewLine[] {
  return steps.map(text => ({ text, offsetDays: null }));
}

/**
 * Prep tasks as preview lines. The lead time is the whole reason a prep task
 * is a task rather than a step, so it rides on the line rather than being left
 * to the count above it.
 */
export function prepTaskPreviewLines(tasks: ExtractedPrepTask[]): ImportPreviewLine[] {
  return tasks.map(task => ({ text: task.title, offsetDays: task.offsetDays }));
}


/**
 * What the disclosure control reads out. Names the count as well as the
 * direction, because a chevron with no label on a row that already has a
 * checkbox is otherwise two unexplained controls in one row.
 */
export function previewToggleLabel(expanded: boolean, lineCount: number, noun: string): string {
  const verb = expanded ? 'Hide' : 'Show';
  // "Show the 1 step" is how a count reads when it was never meant to be
  // spoken; a lone line is just "the step".
  return lineCount === 1 ? `${verb} the ${noun}` : `${verb} the ${plural(lineCount, noun)}`;
}
