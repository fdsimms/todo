import type { Alarm } from '../types';
import { taskAlarmUuid } from './alarmChain';
import { describeMission, hasMission } from './missions';

/**
 * Alarms of their own: a clock time, the weekdays it repeats on, and an
 * optional mission (see missions.ts), listed on the Alarms & Reminders
 * screen. Deliberately not tasks: an alarm is not something to do, so it has
 * no place on Today, in the Logbook or in a project, and it is device-only
 * (never synced, never backed up) because it belongs to the phone it rings
 * on.
 *
 * Two shapes share the type. A repeating alarm has `repeatDays` and no
 * `fireAt`, and rings on AlarmKit's own weekly schedule. A one-off (a quick
 * alarm, or a time with no days chosen) carries the instant it rings at,
 * worked out when it was set, and is spent once that instant has passed: a
 * quick alarm is deleted then, and any other one-off shows as rung until it
 * is switched on again.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The quick-alarm buttons on the screen, in minutes. */
export const QUICK_ALARM_MINUTES = [20, 30, 60] as const;

/** The choices on the quick-alarm card, in minutes. */
export const QUICK_ALARM_CHOICES = [10, 20, 30, 45, 60, 90] as const;

/**
 * How long after a ring the app still treats an unfinished mission as owed
 * when it is opened, for a ring whose Stop never ran the re-arm (see
 * `missedMissionRing`). Longer than that, and opening the app the next
 * evening would demand pushups for a morning long gone.
 */
export const MISSED_MISSION_WINDOW_MS = 12 * 60 * 60 * 1000;

/** "30 min", "1 hr", "1.5 hr". */
export function formatAlarmMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`;
}

/** The clock time on `day`'s calendar date. */
function atTime(day: Date, hour: number, minute: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
}

/** The next instant after `now` that a clock time comes round. */
export function nextClockTime(hour: number, minute: number, now: Date): Date {
  const today = atTime(now, hour, minute);
  return today.getTime() > now.getTime() ? today : atTime(new Date(now.getTime() + DAY_MS), hour, minute);
}

export function isRepeating(alarm: Pick<Alarm, 'repeatDays'>): boolean {
  return alarm.repeatDays.length > 0;
}

/**
 * When the alarm rings next after `now`, or null for one that won't: a one-off
 * already spent. Ignores `enabled`, so a row can still say when a switched-off
 * alarm would ring.
 */
export function nextFireAt(alarm: Alarm, now: Date): Date | null {
  if (!isRepeating(alarm)) {
    if (!alarm.fireAt) return null;
    const at = new Date(alarm.fireAt);
    return at.getTime() > now.getTime() ? at : null;
  }
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    if (!alarm.repeatDays.includes(day.getDay())) continue;
    const at = atTime(day, alarm.hour, alarm.minute);
    if (at.getTime() > now.getTime()) return at;
  }
  return null;
}

/** The last time the alarm rang at or before `now`, or null if it hasn't. */
export function previousFireAt(alarm: Alarm, now: Date): Date | null {
  if (!isRepeating(alarm)) {
    if (!alarm.fireAt) return null;
    const at = new Date(alarm.fireAt);
    return at.getTime() <= now.getTime() ? at : null;
  }
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    if (!alarm.repeatDays.includes(day.getDay())) continue;
    const at = atTime(day, alarm.hour, alarm.minute);
    if (at.getTime() <= now.getTime()) return at;
  }
  return null;
}

/** A one-off whose ring has passed. A repeating alarm is never spent. */
export function isSpent(alarm: Alarm, now: Date): boolean {
  return !isRepeating(alarm) && nextFireAt(alarm, now) === null;
}

/**
 * The ring an alarm still owes a mission for, found when the app opens, or
 * null. This is the backstop for a ring whose Stop never ran the native
 * re-arm (the alert timed out on its own, say): the loop in missions.ts only
 * starts from Stop. It counts a ring that came after the alarm was last set
 * (`armedAt`), after its mission was last finished, and within
 * `MISSED_MISSION_WINDOW_MS` of now.
 */
export function missedMissionRing(alarm: Alarm, now: Date): Date | null {
  if (!alarm.enabled || !hasMission(alarm)) return null;
  const rang = previousFireAt(alarm, now);
  if (!rang) return null;
  if (rang.getTime() < new Date(alarm.armedAt).getTime()) return null;
  if (alarm.missionDoneAt && new Date(alarm.missionDoneAt).getTime() >= rang.getTime()) return null;
  if (now.getTime() - rang.getTime() > MISSED_MISSION_WINDOW_MS) return null;
  return rang;
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Every day", "Weekdays", "Weekends", "Mon, Wed, Fri", or "Once". */
export function describeRepeat(days: readonly number[], weekStartsOn: 0 | 1 = 0): string {
  const set = new Set(days);
  if (set.size === 0) return 'Once';
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && [1, 2, 3, 4, 5].every(d => set.has(d))) return 'Weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
  const order = [0, 1, 2, 3, 4, 5, 6].map(i => (i + weekStartsOn) % 7);
  return order.filter(d => set.has(d)).map(d => DAY_SHORT[d]).join(', ');
}

/** "in 28 min", "in 2 hr 5 min", for a ring under a day away. */
export function describeTimeUntil(at: Date, now: Date): string {
  const minutes = Math.max(1, Math.ceil((at.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `in ${h} hr` : `in ${h} hr ${m} min`;
}

/**
 * The secondary line under an alarm's time: its label, then when it repeats
 * or, for a one-off, how far off it is (or that it has rung).
 */
export function alarmSubtitle(alarm: Alarm, now: Date, weekStartsOn: 0 | 1 = 0): string {
  const parts: string[] = [];
  if (alarm.label.trim()) parts.push(alarm.label.trim());
  if (isRepeating(alarm)) {
    parts.push(describeRepeat(alarm.repeatDays, weekStartsOn));
  } else {
    const next = nextFireAt(alarm, now);
    if (!next) parts.push('Rang');
    else if (!alarm.enabled) parts.push('Once');
    else if (next.getTime() - now.getTime() < DAY_MS) parts.push(describeTimeUntil(next, now));
    else parts.push('Tomorrow');
  }
  return parts.join(' · ');
}

/** What the alarm's own alert says. */
export function alarmAlertTitle(alarm: Pick<Alarm, 'label'>): string {
  return alarm.label.trim() || 'Alarm';
}

/**
 * The mission line on an alarm row, or null for none: what it asks, and, for
 * a day after somebody gave up on it, that they did. Give up is the agreed way
 * out of a mission (missions.ts), and this row is where it stays visible.
 */
export function alarmMissionLine(alarm: Pick<Alarm, 'mission' | 'missionGaveUp' | 'missionDoneAt'>, now: Date): string | null {
  if (!alarm.mission) return null;
  const what = describeMission(alarm.mission);
  if (!alarm.missionGaveUp || !alarm.missionDoneAt) return what;
  const ago = now.getTime() - new Date(alarm.missionDoneAt).getTime();
  return ago >= 0 && ago < DAY_MS ? `${what} · gave up` : what;
}

/**
 * The UUID an alarm rings under natively. Through the same hash a task's ring
 * uses (AlarmKit wants a UUID and `generateId()` doesn't make one), namespaced
 * so an alarm and a task can never derive the same id.
 */
export function alarmNativeUuid(alarmId: string): string {
  return taskAlarmUuid(`alarm:${alarmId}`);
}

/**
 * A one-off alarm's fields for a clock time: the next time it comes round.
 * A repeating alarm has no `fireAt`.
 */
export function scheduleFields(
  hour: number,
  minute: number,
  repeatDays: readonly number[],
  now: Date,
): Pick<Alarm, 'hour' | 'minute' | 'repeatDays' | 'fireAt'> {
  const days = [...new Set(repeatDays)].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  return {
    hour,
    minute,
    repeatDays: days,
    fireAt: days.length > 0 ? null : nextClockTime(hour, minute, now).toISOString(),
  };
}

/**
 * A quick alarm `minutes` from now: a one-off at that instant, to the minute
 * the clock shows, since a native alarm rings on a fixed date.
 */
export function quickAlarmFields(minutes: number, now: Date): Pick<Alarm, 'hour' | 'minute' | 'repeatDays' | 'fireAt' | 'quick'> {
  const at = new Date(now.getTime() + minutes * 60_000);
  at.setSeconds(0, 0);
  return { hour: at.getHours(), minute: at.getMinutes(), repeatDays: [], fireAt: at.toISOString(), quick: true };
}

/**
 * The alarms in the order the screen lists them: by the next time each rings,
 * so the one about to go off is at the top, with the spent and the switched
 * off after, by clock time.
 */
export function sortAlarms(alarms: readonly Alarm[], now: Date): Alarm[] {
  const clock = (a: Alarm) => a.hour * 60 + a.minute;
  return [...alarms].sort((a, b) => {
    const na = a.enabled ? nextFireAt(a, now) : null;
    const nb = b.enabled ? nextFireAt(b, now) : null;
    if (na && nb) return na.getTime() - nb.getTime();
    if (na) return -1;
    if (nb) return 1;
    return clock(a) - clock(b);
  });
}
