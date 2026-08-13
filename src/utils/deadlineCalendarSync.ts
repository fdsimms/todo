import type { Task } from '../types';
import { displayTitleFor } from './visibilityUtils';
import { createDeadlineEvent, updateDeadlineEvent, deleteDeadlineEvent } from './calendarSync';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * What a task's deadline should look like on the device calendar right now,
 * and the device write to get there — the decision half of #1493. The raw
 * EventKit calls live in `calendarSync.ts`; this file owns the rule for
 * when to create, update or delete one.
 *
 * Deliberately free of any dependency on `useTaskStore` — it's the store
 * that calls this, from every mutation that could change what a deadline's
 * event should say (see `reconcileDeadlineEvent` in `useTaskStore.ts`),
 * so a dependency back on the store would be circular. This function only
 * ever reports what the device write produced; persisting the result onto
 * the task is the caller's job.
 */
export async function syncDeadlineEvent(task: Task): Promise<string | null> {
  const { deadlineCalendarId } = useSettingsStore.getState();

  // Off, no target calendar picked, no deadline to show, or the task is
  // done/archived and has nothing left to be late for — the event (if one
  // exists) goes away, and there's nothing to link.
  if (!deadlineCalendarId || !task.deadlineOnCalendar || !task.deadline || task.completed || task.archived) {
    if (task.calendarEventId) await deleteDeadlineEvent(task.calendarEventId);
    return null;
  }

  const fields = { title: displayTitleFor(task) || 'Deadline', date: new Date(task.deadline) };

  if (task.calendarEventId) {
    if (await updateDeadlineEvent(task.calendarEventId, fields)) return task.calendarEventId;
    // The id didn't resolve to a live event — deleted by hand, or the
    // calendar itself is gone. Resolve-or-shrug: fall through and write a
    // fresh one rather than leaving the task pointing at nothing.
  }

  return createDeadlineEvent(deadlineCalendarId, fields);
}
