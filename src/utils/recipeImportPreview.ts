import type { ExtractedPrepTask } from '../services/aiSuggestions';
import { formatOffsetLabel } from './templateUtils';

/**
 * The strings behind the Method / Prep tasks rows of a recipe-import review
 * list, shared by `RecipeCreateSheet` and `RecipeExtractSheet` (#1618).
 *
 * Both rows used to say only how *many* steps or tasks an import had found,
 * with the steps themselves arriving unseen — a count is a receipt, not a
 * review, and the one thing the sheet asks you to do is check what it's about
 * to write. So each row now unfolds the lines it would add, and this module
 * owns every string that appears in one: the row's own summary, the lines
 * inside it, and the label the disclosure reads out.
 *
 * It lives out here rather than in the row component because the counting and
 * pluralisation are the part worth testing, and neither sheet can be rendered
 * in this suite (node environment, no renderer).
 */

/** One line of an unfolded preview: what would be added, and when it happens. */
export interface ImportPreviewLine {
  /** The step's or task's own text. */
  text: string;
  /** "1 day before" for a prep task; null for a method step, which has no offset. */
  lead: string | null;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * The Method row's summary. Says what will *happen* rather than only what was
 * found: the method row is the one place a recipe can end up with two methods,
 * so the row that does it is where that has to be readable.
 */
export function methodRowMeta(stepCount: number, appendsToExisting: boolean): string {
  const count = plural(stepCount, 'step');
  return appendsToExisting ? `${count}, added after the method it already has` : count;
}

/** The Prep tasks row's summary — same appending rule as the method above. */
export function prepTasksRowMeta(taskCount: number, appendsToExisting: boolean): string {
  const count = plural(taskCount, 'task');
  return appendsToExisting ? `${count}, added after what it already has` : count;
}

/**
 * The method as preview lines. Numbering is the row's own (it renders the
 * index), so the text stays exactly the step's — a source that numbers its own
 * steps would otherwise read "1. 1. Preheat the oven".
 */
export function methodPreviewLines(steps: string[]): ImportPreviewLine[] {
  return steps.map(text => ({ text, lead: null }));
}

/**
 * Prep tasks as preview lines. The lead time is the whole reason a prep task
 * is a task rather than a step, so it's on the line rather than left to the
 * count above it — and it's worded by `formatOffsetLabel`, the same "1 day
 * before" `PrepTasksReviewSheet` shows once these are real.
 */
export function prepTaskPreviewLines(tasks: ExtractedPrepTask[]): ImportPreviewLine[] {
  return tasks.map(task => ({ text: task.title, lead: formatOffsetLabel(task.offsetDays) }));
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
