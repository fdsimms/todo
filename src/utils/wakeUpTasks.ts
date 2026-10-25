import type { Alarm, Task } from '../types';
import type { BusyEvent } from './calendarBusy';
import { atTime } from './alarms';
import { eventIsRuleEligible, eventOccurrenceKey, eventOccurrenceKeys } from './eventTasks';
import { generatedSourceOf } from './generatedTasks';
import type { MorningAlarm } from './morningAlarm';
import { eventHasLocation, leadWithArrival, travelLeadFor, type TravelLeads } from './travelTasks';

/**
 * The wake-up task: when tomorrow starts earlier than usual, the time to get
 * up by, and the alarm for it.
 *
 * ## One task, and what it points at
 *
 * "Wake up at 6:20" is an ordinary synced task (a notice, like "Leave for"),
 * and it carries `alarmLink: 'next'` so its row shows whichever of the
 * device's own alarms rings tomorrow and opens the same card to keep or
 * change it (`morningAlarm.ts`). The alarm is **not** on the task: alarms are
 * device-only and a task syncs, so the alarm is set by `wakeAlarmPlan` on the
 * phone that can ring it, and the task is only the thing that says so.
 *
 * ## The time
 *
 * `event start - arrive-early - travel lead - getting ready`, floored to five
 * minutes. The travel lead and arrive-early are the Travel settings' own, and
 * an event with no place (or a video call) has no trip, so only the arrival
 * margin and the getting-ready time come off. Typed numbers only, for the
 * reason `travelTasks.ts` gives: nothing here reads a position or sends an
 * address anywhere.
 *
 * ## Which event
 *
 * Of the timed events that start on tomorrow's calendar date (the date a
 * wake-up alarm belongs to, `morningDate`), the one that needs the earliest
 * wake-up. All-day events are not a time to be up by. A task exists only when
 * that time is before the person's usual wake-up; an ordinary morning writes
 * nothing.
 */

/** Minutes after midnight, as `Settings` holds a clock time of day. */
export const WAKE_UP_DEFAULT_USUAL_MINUTES = 8 * 60;
export const WAKE_UP_DEFAULT_GET_READY_MINUTES = 45;
export const WAKE_UP_ROUND_MINUTES = 5;

/** A typed number of minutes, whole and inside `min`..`max`, or `fallback` for anything that isn't one. */
export function clampWakeUpMinutes(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** The settings a sweep reads, as `useSettingsStore` holds them. */
export interface WakeUpSettings {
  travelLeadMinutes: number;
  travelArriveEarlyMinutes: number;
  travelLeadByCalendar: TravelLeads['byCalendar'];
  wakeUpUsualMinutes: number;
  wakeUpGetReadyMinutes: number;
}

export function wakeUpInputs(s: WakeUpSettings): { leads: TravelLeads; prefs: WakeUpPrefs } {
  return {
    leads: { defaultMinutes: s.travelLeadMinutes, byCalendar: s.travelLeadByCalendar, arriveEarlyMinutes: s.travelArriveEarlyMinutes },
    prefs: { usualMinutes: s.wakeUpUsualMinutes, getReadyMinutes: s.wakeUpGetReadyMinutes },
  };
}

export interface WakeUpPrefs {
  /** The usual wake-up, minutes after midnight. Only a wake-up before this is worth a task. */
  usualMinutes: number;
  /** How long getting ready takes. */
  getReadyMinutes: number;
}

/** The wake-up task's title. `clock` formats a time the way the person's settings do. */
export function wakeUpTitle(wakeAt: Date, clock: (at: Date) => string): string {
  return `Wake up at ${clock(wakeAt)}`;
}

/** The occurrence key of the event a wake-up task was written for. */
export function wakeUpSourceId(event: Pick<BusyEvent, 'id' | 'start' | 'externalId'>): string {
  return eventOccurrenceKey(event);
}

/** The occurrence key a wake-up task was written for, or null for any other task. */
export function wakeUpSourceOf(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): string | null {
  return generatedSourceOf(task, 'wakeUp');
}

/** A timed event that is still ahead. */
export function eventIsWakeUpEligible(event: BusyEvent, now: Date): boolean {
  return !event.allDay && eventIsRuleEligible(event, now);
}

/**
 * When to be up for an event, floored to five minutes (a native alarm rings on
 * the minute, and "6:17" is not a time anybody sets), or null for a start that
 * doesn't parse.
 */
export function wakeUpAt(event: BusyEvent, leads: TravelLeads, getReadyMinutes: number): Date | null {
  const start = Date.parse(event.start);
  if (!Number.isFinite(start)) return null;
  const trip = !event.videoCall && eventHasLocation(event) ? travelLeadFor(event, leads) : 0;
  // Arrive-early applies to any event: being there before it starts doesn't
  // need a place, only the margin the person asked for.
  const lead = leadWithArrival(trip, leads.arriveEarlyMinutes) + Math.max(0, getReadyMinutes);
  const step = WAKE_UP_ROUND_MINUTES * 60_000;
  return new Date(Math.floor((start - lead * 60_000) / step) * step);
}

export interface WakeUpMatch {
  sourceId: string;
  event: BusyEvent;
  wakeAt: Date;
  /** The event's end, which is how long the handled record keeps the occurrence. */
  endsAt: string;
  handled: boolean;
}

/**
 * The one event tomorrow morning that needs the earliest wake-up, or null when
 * none needs one before the usual time. `morning` is midnight of the calendar
 * date asked about (`morningDate`).
 */
export function matchedWakeUp(
  leads: TravelLeads,
  prefs: WakeUpPrefs,
  events: readonly BusyEvent[],
  now: Date,
  morning: Date,
  handled: Readonly<Record<string, string>>,
): WakeUpMatch | null {
  const dayStart = morning.getTime();
  const dayEnd = new Date(morning.getFullYear(), morning.getMonth(), morning.getDate() + 1).getTime();
  const usual = atTime(morning, Math.floor(prefs.usualMinutes / 60), prefs.usualMinutes % 60).getTime();

  let best: WakeUpMatch | null = null;
  for (const event of events) {
    if (!eventIsWakeUpEligible(event, now)) continue;
    const start = Date.parse(event.start);
    if (!(start >= dayStart && start < dayEnd)) continue;
    const wakeAt = wakeUpAt(event, leads, prefs.getReadyMinutes);
    if (!wakeAt || wakeAt.getTime() >= usual) continue;
    if (best && best.wakeAt.getTime() <= wakeAt.getTime()) continue;
    const keys = eventOccurrenceKeys(event);
    const sourceId = keys.find(k => k in handled) ?? keys[0];
    best = { sourceId, event, wakeAt, endsAt: event.end, handled: sourceId in handled };
  }
  return best;
}

/**
 * Whether a live wake-up task should be cleared. Before the event starts, a
 * task whose occurrence is no longer the match means the event moved, was
 * cancelled, or an earlier one appeared, and the sweep writes the right one.
 * After the start nothing is read into the occurrence leaving the set (it is
 * happening), for `isTravelTaskStale`'s reason.
 */
export function isWakeUpTaskStale(sourceId: string, match: WakeUpMatch | null, now: Date): boolean {
  const i = sourceId.lastIndexOf('|');
  const start = i < 0 ? NaN : Date.parse(sourceId.slice(i + 1));
  if (!Number.isFinite(start)) return true;
  if (start <= now.getTime()) return false;
  return match === null || !eventOccurrenceKeys(match.event).includes(sourceId);
}

// ---- The alarm on the device ----

/** What setting tomorrow's alarm for `wakeAt` means given what already rings. */
export type WakeAlarmPlan =
  | { kind: 'none' }
  /** An alarm already rings at or before that time. */
  | { kind: 'covered' }
  /** A repeating alarm rings later: move that one morning (`Alarm.override`). */
  | { kind: 'override'; alarm: Alarm }
  /** Nothing rings that morning: a one-off that deletes itself. */
  | { kind: 'add' };

/**
 * What to do about the alarm, from `morningAlarmFor`'s answer for the morning.
 * A one-off alarm the person set by hand that rings too late is left alone:
 * moving it would rewrite something they made for another reason, and the task
 * on Today still offers the change.
 */
export function wakeAlarmPlan(morning: MorningAlarm, wakeAt: Date, now: Date): WakeAlarmPlan {
  if (wakeAt.getTime() <= now.getTime()) return { kind: 'none' };
  if (!morning.ring) return { kind: 'add' };
  if (morning.ring.at.getTime() <= wakeAt.getTime()) return { kind: 'covered' };
  return morning.ring.alarm.repeatDays.length > 0 ? { kind: 'override', alarm: morning.ring.alarm } : { kind: 'none' };
}

/**
 * The key a device remembers having set an alarm under. It carries the time,
 * so a moved event (or a changed lead) is a new answer and sets the alarm
 * again, while an unchanged one is never set twice: a person who deleted or
 * changed the alarm after it was set is not overruled on the next sweep.
 */
export function wakeAlarmKey(sourceId: string, wakeAt: Date): string {
  return `${sourceId}@${wakeAt.getHours()}:${wakeAt.getMinutes()}`;
}
