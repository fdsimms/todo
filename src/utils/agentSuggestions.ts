import { format } from 'date-fns/format';
import type { CalendarRequest, ReminderKind, Task } from '../types';
import { formatTimeOfDay } from './dateUtils';
import { suggestionIsStale } from './calendarRequests';

/**
 * The Inbox's "Suggested by Claude" cards: what an agent asked for that waits
 * for the person's own tap. The rows are `CalendarRequest`s with status
 * `proposed` (see the type's doc comment for why the table is shared), and this
 * file is every rule about them that isn't drawing or database.
 *
 * Three things reach a card:
 * - a calendar event or a change to one, when the person has turned on "Ask
 *   before adding events". A tap moves the row to `pending`, and the drain does
 *   what it always did.
 * - `task_deadline`: put a task's deadline on the calendar
 *   (`Task.deadlineOnCalendar`).
 * - `task_alarm`: ring at a time (`Task.reminderTime` + `reminderKind`).
 * The last two are device effects an agent cannot write over MCP, so they are
 * always a card, and the tap applies them here through `updateTask`, which is
 * what the task editor does for the same fields.
 */

/** The cards to show now, oldest first. A suggestion for a moment that has gone is not one. */
export function liveSuggestions(requests: readonly CalendarRequest[], now: Date): CalendarRequest[] {
  return requests
    .filter(r => r.status === 'proposed' && !suggestionIsStale(r, now))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface SuggestionCardModel {
  id: string;
  /** An Ionicons glyph name. */
  icon: 'calendar-outline' | 'flag-outline' | 'alarm-outline';
  title: string;
  /** What it will do, one short line each: when, and where or how. */
  lines: string[];
  /** The accent button's label; the second button is always Skip. */
  primaryLabel: string;
}

export interface SuggestionContext {
  /** Every request, to name the event a change or removal is about. */
  requests: readonly CalendarRequest[];
  /** The task a `task_` kind names, by id. */
  taskById: (id: string) => Task | undefined;
  use24Hour: boolean;
  alarmKitAvailable: boolean;
}

const DAY_FORMAT = 'EEE, MMM d';

function dayOf(iso: string): string {
  return format(new Date(iso), DAY_FORMAT);
}

/** "Thu, Oct 29 · 3:00 to 4:00 PM", "Thu, Oct 29 · all day", or a span of days. */
export function eventWhen(r: Pick<CalendarRequest, 'startAt' | 'endAt' | 'allDay'>, use24Hour: boolean): string {
  const start = new Date(r.startAt);
  const end = new Date(r.endAt);
  if (r.allDay) {
    const lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1);
    const sameDay = lastDay.getTime() <= new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
    return sameDay ? `${dayOf(r.startAt)} · all day` : `${dayOf(r.startAt)} to ${format(lastDay, DAY_FORMAT)} · all day`;
  }
  const sameDay = format(start, 'yyyy-MM-dd') === format(end, 'yyyy-MM-dd');
  return sameDay
    ? `${dayOf(r.startAt)} · ${formatTimeOfDay(start, use24Hour)} to ${formatTimeOfDay(end, use24Hour)}`
    : `${dayOf(r.startAt)} ${formatTimeOfDay(start, use24Hour)} to ${dayOf(r.endAt)} ${formatTimeOfDay(end, use24Hour)}`;
}

/** Whether the alarm will really ring, or fall back to a notification on this phone. */
function alarmWord(ringKind: 'alarm' | 'persistent' | undefined, alarmKitAvailable: boolean): string {
  return alarmKitAvailable && ringKind !== undefined ? 'Alarm' : 'Reminder';
}

export function describeSuggestion(r: CalendarRequest, ctx: SuggestionContext): SuggestionCardModel {
  const kind = r.kind ?? 'event';

  if (kind === 'task_deadline') {
    const task = r.taskId ? ctx.taskById(r.taskId) : undefined;
    const name = task?.title ?? r.title;
    const lines: string[] = [];
    if (task?.deadline) {
      const time = task.deadlineTime;
      lines.push(time
        ? `Due ${format(new Date(task.deadline), 'MMM d')} at ${formatClockString(time, ctx.use24Hour)}`
        : `Due ${format(new Date(task.deadline), 'MMM d')} · all-day event`);
    }
    return { id: r.id, icon: 'flag-outline', title: `Add “${name}” deadline to calendar`, lines, primaryLabel: 'Add to calendar' };
  }

  if (kind === 'task_alarm') {
    const task = r.taskId ? ctx.taskById(r.taskId) : undefined;
    const name = task?.title ?? r.title;
    const word = alarmWord(r.payload?.ringKind, ctx.alarmKitAvailable);
    const at = r.payload?.alarmAt ? new Date(r.payload.alarmAt) : null;
    const lines: string[] = [];
    if (at) lines.push(`${format(at, DAY_FORMAT)} · ${formatTimeOfDay(at, ctx.use24Hour)}`);
    if (ctx.alarmKitAvailable && r.payload?.ringKind === 'persistent') lines.push('Repeats until you finish the task');
    return { id: r.id, icon: 'alarm-outline', title: `${word} for “${name}”`, lines, primaryLabel: `Set ${word.toLowerCase()}` };
  }

  if (r.action === 'delete' || r.action === 'update') {
    const target = r.targetRequestId ? ctx.requests.find(x => x.id === r.targetRequestId) : undefined;
    const name = target?.title ?? r.title;
    if (r.action === 'delete') {
      return { id: r.id, icon: 'calendar-outline', title: `Remove “${name}”`, lines: ['Takes it off your calendar'], primaryLabel: 'Remove from calendar' };
    }
    const c = r.changes ?? {};
    const lines: string[] = [];
    if (c.title) lines.push(`New name: ${c.title}`);
    if (c.startAt && c.endAt) lines.push(eventWhen({ startAt: c.startAt, endAt: c.endAt, allDay: c.allDay ?? r.allDay }, ctx.use24Hour));
    if (c.location) lines.push(c.location);
    return { id: r.id, icon: 'calendar-outline', title: `Change “${name}”`, lines, primaryLabel: 'Change event' };
  }

  const lines = [eventWhen(r, ctx.use24Hour)];
  if (r.location) lines.push(r.location);
  return { id: r.id, icon: 'calendar-outline', title: r.title, lines, primaryLabel: 'Add to calendar' };
}

/** "HH:MM" as the person reads the clock. */
function formatClockString(hhmm: string, use24Hour: boolean): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  return formatTimeOfDay(new Date(2000, 0, 1, h, m), use24Hour);
}

export interface TaskSuggestionContext {
  now: Date;
  /** `deadlineCalendarId` on this device, or null when none is picked. */
  deadlineCalendarId: string | null;
  alarmKitAvailable: boolean;
}

export type TaskSuggestionPlan =
  /** Write this patch with `updateTask`. */
  | { kind: 'apply'; patch: Partial<Task> }
  /** Nothing to write: the task is already the way the card asked. */
  | { kind: 'already' }
  /** The deadline kind needs a calendar picked first; the card asks for one and then plays this again. */
  | { kind: 'needsCalendar' }
  | { kind: 'fail'; reason: string };

export const SUGGESTION_TASK_GONE_REASON = 'That task is gone.';
export const SUGGESTION_TASK_DONE_REASON = 'That task is already done.';
export const SUGGESTION_NO_DEADLINE_REASON = 'The task no longer has a deadline.';
export const SUGGESTION_TIME_PASSED_REASON = 'That time has passed.';

/**
 * What a tap on a `task_` card does. The reminder patch is what the task
 * editor writes for a reminder (`reminderUtcOffsetMinutes` is not filled in by
 * `updateTask`), and it clears a rule-based reminder because a fixed time
 * replaces a rule rather than sitting beside it. Where AlarmKit is missing the
 * ring falls back to a notification, the way `scheduleTaskReminder` does, and
 * the card has already said "Reminder" instead of "Alarm".
 */
export function planTaskSuggestion(r: CalendarRequest, task: Task | undefined, ctx: TaskSuggestionContext): TaskSuggestionPlan {
  if (!task) return { kind: 'fail', reason: SUGGESTION_TASK_GONE_REASON };
  if (task.completed || task.archived) return { kind: 'fail', reason: SUGGESTION_TASK_DONE_REASON };

  if (r.kind === 'task_deadline') {
    if (!task.deadline) return { kind: 'fail', reason: SUGGESTION_NO_DEADLINE_REASON };
    if (task.deadlineOnCalendar && ctx.deadlineCalendarId) return { kind: 'already' };
    if (!ctx.deadlineCalendarId) return { kind: 'needsCalendar' };
    return { kind: 'apply', patch: { deadlineOnCalendar: true } };
  }

  const alarmAt = r.payload?.alarmAt;
  const at = alarmAt ? new Date(alarmAt) : null;
  if (!at || Number.isNaN(at.getTime()) || at.getTime() <= ctx.now.getTime()) {
    return { kind: 'fail', reason: SUGGESTION_TIME_PASSED_REASON };
  }
  const kind: ReminderKind = ctx.alarmKitAvailable ? (r.payload?.ringKind ?? 'alarm') : 'notification';
  return {
    kind: 'apply',
    patch: {
      reminderTime: at.toISOString(),
      reminderKind: kind,
      reminderUtcOffsetMinutes: at.getTimezoneOffset(),
      reminderTimeAnchor: 'wallClock',
      reminderOffsetDays: null,
      reminderTracksVisibility: false,
    },
  };
}
