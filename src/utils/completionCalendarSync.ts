import { addMinutes } from 'date-fns';
import type { Task } from '../types';
import { displayTitleFor } from './visibilityUtils';
import { createTimedEvent } from './calendarSync';
import { useSettingsStore } from '../store/useSettingsStore';
import { isDemoModeActive } from './demoState';

/**
 * Writes a silent, point-in-time calendar event logging the moment a task
 * was completed — the extension of the "write to calendar" family
 * `deadlineCalendarSync.ts` started, for a different question: not "when is
 * this due" but "when did I finish this".
 *
 * Deliberately not a reconciler like `syncDeadlineEvent`. A deadline event
 * has to keep saying what's currently true about a task that can still
 * change — moved, retitled, undone. A completion log is a historical record
 * of something that already happened: there is no "the event should now say
 * something different" state to reconcile toward, so this is a one-shot
 * write, not a continuously-updated mirror. **The caller must only invoke
 * this once, at the moment a task is actually marked completed** — it does
 * not check for an existing event, so a caller that looped this into an
 * update-on-every-save path (the way `reconcileDeadlineEvent` is called on
 * every save) would write a duplicate event on every edit of an already-
 * completed row.
 */
export async function logTaskCompletionToCalendar(task: Task, completedAt: Date): Promise<string | null> {
  // Same guard every device write in this family uses — demo-seeded fiction
  // must never reach a real device calendar.
  if (isDemoModeActive()) return null;

  const { completionCalendarId } = useSettingsStore.getState();

  // Off, or no target calendar picked — nothing to write.
  if (!completionCalendarId || !task.logCompletionToCalendar) return null;

  const fields = {
    title: displayTitleFor(task) || 'Completed task',
    start: completedAt,
    end: addMinutes(completedAt, 30),
  };

  return createTimedEvent(completionCalendarId, fields);
}
