import { addMinutes } from 'date-fns/addMinutes';
import type { Task } from '../types';
import { deadlineMoment } from './dateUtils';
import type { AllDayEventFields } from './calendarSync';
import { displayTitleFor } from './visibilityUtils';
import {
  NO_EVENT_LINK,
  adoptableEventId,
  deleteLinkedEvent,
  uniqueLinks,
  writeAllDayEvent,
  type CalendarEventLink,
} from './calendarEventLink';
import { useSettingsStore } from '../store/useSettingsStore';
import { isDemoModeActive } from './demoState';
import type { ApplyReport } from './syncMerge';

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
 * ever reports what the device write produced (the event's device id and the
 * calendar server's id for it, both null when there's no event); persisting
 * the result onto the task is the caller's job.
 */
export async function syncDeadlineEvent(task: Task): Promise<CalendarEventLink> {
  // Same guard notifications.ts uses — demo-seeded tasks currently never set
  // deadlineOnCalendar, so this is latent rather than reachable today, but a
  // future seed change or a real deadline mutation while demo mode happens
  // to be on shouldn't get a free pass to write a real device event.
  if (isDemoModeActive()) return NO_EVENT_LINK;

  const { deadlineCalendarId } = useSettingsStore.getState();

  // Off, no target calendar picked, no deadline to show, or the task is
  // done/archived and has nothing left to be late for — the event (if one
  // exists) goes away, and there's nothing to link.
  if (!deadlineCalendarId || !task.deadlineOnCalendar || !task.deadline || task.completed || task.archived) {
    await deleteDeadlineEvent(deadlineEventLink(task));
    return NO_EVENT_LINK;
  }

  // Into the calendar picked *now*, not the one it was first written to: a
  // deadline written before "Write deadlines to" was switched moves across the
  // next time its task is reconciled, rather than going on being rewritten in
  // the old calendar while new deadlines land in the new one. The meal
  // mirror's rule and reasoning (#2949, `syncMealEvent`), including that
  // nothing sweeps: a task nobody touches keeps its event where it is. An id
  // that no longer resolves (deleted by hand, the calendar gone, or a backup
  // restored on a new phone, #2950) falls back to the event found by its server
  // id and then to a fresh one; `writeAllDayEvent` has the order.
  return writeAllDayEvent(
    deadlineEventLink(task),
    deadlineCalendarId,
    deadlineEventFields(task, task.deadline),
    true
  );
}

/**
 * The event a deadline writes: the whole day, or, when the deadline has a time
 * of day, a 30 minute event starting then (a deadline is a moment, and the
 * calendar has no zero-length event to show one).
 */
function deadlineEventFields(task: Task, deadline: string): AllDayEventFields {
  const title = displayTitleFor(task) || 'Deadline';
  const date = new Date(deadline);
  const start = deadlineMoment(deadline, task.deadlineTime);
  return start ? { title, date, timed: { start, end: addMinutes(start, DEADLINE_EVENT_MINUTES) } } : { title, date };
}

const DEADLINE_EVENT_MINUTES = 30;

/** The deadline event a task is linked to on this device. */
export function deadlineEventLink(task: Task): CalendarEventLink {
  return { eventId: task.calendarEventId ?? null, externalId: task.calendarEventExternalId ?? null };
}

/**
 * Deletes a task's deadline event, by its server id when the local one names
 * nothing here (a backup restored on a new phone, #2950), which is what every
 * delete of a task row calls. `deleteMealEvent`'s rule, narrowed by the
 * deadline calendar. Fire-and-forget, never throws.
 */
export function deleteDeadlineEvent(link: CalendarEventLink): Promise<void> {
  const calendarId = useSettingsStore.getState().deadlineCalendarId ?? '';
  return deleteLinkedEvent(link, matches => adoptableEventId(matches, calendarId, true));
}

/** What a sync apply asks of this device's task events. */
export interface TaskEventSyncPlan {
  /** Tasks holding a deadline event this device wrote, to bring in line through `syncDeadlineEvent`. */
  deadlines: Task[];
  /** Tasks holding a time block on this device's calendar, to retitle and resize. */
  timeBlocks: Task[];
  /**
   * Tasks another device reopened that still hold this device's completion
   * event, to delete as a local uncomplete would.
   */
  uncompleted: Task[];
  /** Deadline events whose task another device removed, to delete through `deleteDeadlineEvent`. */
  remove: CalendarEventLink[];
}

/**
 * Which of this device's task events a sync apply has left stale, and what to
 * do about each (#2950). The task-side sibling of `mealEventsAfterSync`.
 *
 * A task's deadline event, time block and completion event belong to the
 * device that wrote them: their ids are kept off the wire
 * (`SYNC_DEVICE_LOCAL_COLUMNS`), and nothing but this device can rewrite or
 * delete them. Before this, a task renamed, given a new deadline or completed
 * on another device kept its old title and day on this device's calendar until
 * this device next edited it, one deleted there left its deadline event here
 * for good, and one reopened there left this device's "completed" event on
 * the calendar. So a sync is treated like the local edit it stands in for, and
 * goes through the same paths.
 *
 * - **A task the apply changed is reconciled only for the events it already
 *   holds here.** Its deadline event goes through `syncDeadlineEvent`, which
 *   moves it, or deletes it once the task is completed, archived or has lost
 *   its deadline, or no calendar is picked, exactly as a local edit would. Its
 *   time block gets the title and length and nothing else, since the block's
 *   start is the event's own (`Task.timeBlockEventId`). A task with no event of
 *   this device's is left alone, including every task that arrived new (a
 *   synced row never carries the ids), and so the successor a completion
 *   elsewhere spawned: the device that completed it writes that successor's
 *   deadline event when it has a calendar picked, possibly the same shared
 *   calendar, and writing a second one here would put the deadline there
 *   twice. Turning "Write deadlines to" on has never swept existing tasks
 *   either; the task's next local edit is what gives it an event here.
 * - **A task the apply deleted takes its deadline event with it**, as every
 *   local delete does (`deleteTask`, `bulkDeleteTasks`, the series and expiry
 *   paths). **Never its time block**: the app never deletes one, because the
 *   block is time the user set aside in their own calendar and may have shared.
 *   Nor its completion event, which records something that happened rather
 *   than mirroring the row, the same call every local delete makes.
 * - **A task the apply reopened loses this device's completion event**, as a
 *   local uncomplete does (`uncompleteTask` deletes the event and clears the
 *   id): the completion it recorded no longer happened. "Reopened" is read off
 *   the row as it now stands, not off what changed, so it is any changed task
 *   that is not completed and still holds a completion event here. A task
 *   still completed keeps its event whatever else changed, since the event is
 *   written once and never rewritten.
 * - **No purge margin, unlike the meal rule.** The meal rule needs one because
 *   the 180-day meal purge deliberately leaves each event on the calendar as a
 *   record of what was eaten, so a purge arriving from a peer must not take
 *   this device's. Nothing keeps a task's deadline event that way. Every other
 *   delete of a task row, the unattended expiry sweep included (it goes through
 *   `bulkDeleteTasks`), already deletes the event with it. The one that doesn't
 *   is the completed-task retention purge (`purgeOldCompletedTasks`), and it
 *   only ever takes completed rows (with their subtasks). A completed task has
 *   no deadline event by this very rule: `syncDeadlineEvent` deletes it at
 *   completion, on the completing device and, through the first bullet, on
 *   every device the completion syncs to. So a purge's deletion normally finds
 *   no event id to hand back, and when it does (this device never heard the
 *   completion before the row was purged elsewhere, or linked the event before
 *   this reconcile existed) the event is one the rule would already have
 *   deleted.
 * - **Nothing at all in demo mode**, for the reason `mealEventsAfterSync`
 *   gives.
 *
 * A task changed twice across a sync's transports is reconciled once, and one
 * the same sync then deleted is not reconciled (it no longer resolves), only
 * its deadline event deleted.
 */
export function taskEventsAfterSync(
  applied: Pick<ApplyReport, 'taskIds' | 'removedTaskEvents'>,
  resolve: (id: string) => Task | null
): TaskEventSyncPlan {
  if (isDemoModeActive()) return { deadlines: [], timeBlocks: [], uncompleted: [], remove: [] };

  const deadlines: Task[] = [];
  const timeBlocks: Task[] = [];
  const uncompleted: Task[] = [];
  for (const id of new Set(applied.taskIds)) {
    const task = resolve(id);
    if (!task) continue;
    if (task.calendarEventId) deadlines.push(task);
    if (task.timeBlockEventId) timeBlocks.push(task);
    if (!task.completed && task.completionCalendarEventId) uncompleted.push(task);
  }

  return { deadlines, timeBlocks, uncompleted, remove: uniqueLinks(applied.removedTaskEvents) };
}
