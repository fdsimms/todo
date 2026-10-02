import { addMinutes } from 'date-fns/addMinutes';
import type { Task } from '../types';
import { displayTitleFor } from './visibilityUtils';
import { createTimedEvent } from './calendarSync';
import { completionEventMatch, deleteLinkedEvent, type CalendarEventLink } from './calendarEventLink';
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

/** The completion event a task is linked to on this device. */
export function completionEventLink(task: Task): CalendarEventLink {
  return {
    eventId: task.completionCalendarEventId ?? null,
    externalId: task.completionCalendarEventExternalId ?? null,
  };
}

/**
 * Deletes a task's completion event, which reopening it does wherever it is
 * reopened (`uncompleteTask`, and the reload after a sync that reopened it). By
 * its server id when the local one names nothing here, a backup restored on a
 * new phone (#2950), narrowed by the completion calendar the way a meal's or a
 * deadline's is by theirs. Fire-and-forget, never throws.
 */
export function deleteCompletionEvent(link: CalendarEventLink): Promise<void> {
  const calendarId = useSettingsStore.getState().completionCalendarId ?? '';
  return deleteLinkedEvent(link, matches => completionEventMatch(matches, calendarId));
}
