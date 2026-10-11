import type { Task } from '../types';
import { journalLogUrl } from './journalTasks';
import { MOOD_LOG_LINK_URL } from './moodTasks';
import { WEIGH_IN_LINK_URL } from './weightTasks';

/**
 * The generated tasks that ask for a record, and are answered by the record.
 *
 * "Log how you're feeling", "Write in your journal", "Write down your dream" and
 * "Record your weight" each have a sheet, and saving an entry for today
 * completes the task (`completeMoodLogTaskForToday` and its three siblings). So
 * the app already knows whether the thing was done, and a checkbox that
 * completes the task on its own can only disagree with that: it marks the
 * question answered with no answer recorded. These rows have no manual
 * completion. Their checkbox opens the sheet (`'open-log'` in `completionTap.ts`),
 * and `completeTask` refuses anything but the sheet's own save
 * (`CompletionOptions.recorded`) or a missed mark, which claims nothing.
 */
const RECORD_KINDS: ReadonlySet<string> = new Set(['moodLog', 'journalLog', 'dreamLog', 'weighIn']);

/** Whether this task is one a record answers, so its checkbox never completes it. */
export function isAnsweredByRecord(task: Pick<Task, 'generatedKind'>): boolean {
  return task.generatedKind !== null && task.generatedKind !== undefined && RECORD_KINDS.has(task.generatedKind);
}

/**
 * The sheet that records this task's answer, or null for any other task.
 *
 * Read from the kind rather than from `Task.linkUrl`, so a row written before
 * the generators set a link (or one whose link was cleared in the editor) still
 * has somewhere to send the tap.
 */
export function recordLogUrl(task: Pick<Task, 'generatedKind'>): string | null {
  switch (task.generatedKind) {
    case 'moodLog': return MOOD_LOG_LINK_URL;
    case 'journalLog': return journalLogUrl('journal');
    case 'dreamLog': return journalLogUrl('dream');
    case 'weighIn': return WEIGH_IN_LINK_URL;
    default: return null;
  }
}
