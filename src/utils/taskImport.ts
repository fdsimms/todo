import type { ExtractedTask } from '../services/aiSuggestions';
import type { TaskDraft } from '../types';

/**
 * One row of `TaskImportSheet`'s review list: what the model read, plus the
 * two things the person can change before anything is saved.
 *
 * `id` is the row's position in the read, not a task id. The title and date are
 * editable, so nothing about the text can key a row.
 */
export interface ImportCandidate {
  id: string;
  title: string;
  /** The day it lands on, or null for a task with no date (it goes to Unscheduled or Inbox like any other). */
  dueDate: Date | null;
  notes: string;
  included: boolean;
}

/**
 * The review list for a read. Every row starts ticked: the person chose to
 * import from this source, so the work is untick what they don't want, not
 * tick what they do.
 *
 * `dueDate` lands at noon on the day the model read, the same "safe for
 * display" convention `draftFromExtractedEvent` uses. Every number comes off
 * what the model read, never the device clock, so this is not a scheduling
 * decision in the `dayResetTime` sense.
 */
export function candidatesFromExtracted(tasks: ExtractedTask[]): ImportCandidate[] {
  return tasks.map((task, index) => {
    const match = task.date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(task.date) : null;
    return {
      id: String(index),
      title: task.title,
      dueDate: match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0) : null,
      notes: task.notes,
      included: true,
    };
  });
}

/** What "Add N" will create: ticked rows that still have a title once it's trimmed. */
export function candidatesToAdd(candidates: ImportCandidate[]): ImportCandidate[] {
  return candidates.filter(c => c.included && c.title.trim().length > 0);
}

/** The draft `addTask` takes for one row. */
export function draftFromCandidate(candidate: ImportCandidate): Partial<TaskDraft> {
  return {
    title: candidate.title.trim(),
    ...(candidate.notes ? { notes: candidate.notes } : {}),
    ...(candidate.dueDate ? { dueDate: candidate.dueDate.toISOString() } : {}),
  };
}
