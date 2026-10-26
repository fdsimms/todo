import type { Alarm, AlarmOverride } from '../types';
import { alarmMissionLine, atTime, calendarKey, isRepeating, repeatingRingOn } from './alarms';
import { logicalDayStart } from './clockTime';

/**
 * Tomorrow's alarm, as a task sees it: the rules behind a task like "Set alarm
 * for morning" pointing at the device's own alarms (`Task.alarmLink`), so its
 * row can show the alarm and a card can keep it or change its time.
 *
 * ## Which morning
 *
 * "Tomorrow" is the calendar date of the logical tomorrow. A wake-up alarm
 * belongs to a calendar morning, not a logical day: with the day starting at
 * 4 AM, a 3:30 AM alarm on Monday would otherwise count as Sunday's. Taken
 * from the logical day, the task done at 1 AM (still Sunday by the person's
 * clock) asks about Monday morning, and so does the one done at 9 PM.
 *
 * ## Changing one morning
 *
 * AlarmKit can't move one occurrence of a weekly alarm, so "just tomorrow" is
 * `Alarm.override`: the repeating alarm keeps its own time and names a
 * different one for a single date. `syncAlarmToDevice` turns that into native
 * alarms (the weekly schedule without that weekday, a one-off at the override,
 * and a one-off a week later at the usual time in case the app isn't opened
 * to put the weekly back), and `clearSpentOverrides` drops the override once
 * its day is over, which reschedules the weekly as it was.
 */

/** `Task.alarmLink` for whichever alarm rings first tomorrow. */
export const NEXT_ALARM_LINK = 'next';

/** Midnight of the calendar date the task is asking about. */
export function morningDate(now: Date, dayResetTime = '00:00'): Date {
  const start = logicalDayStart(now, dayResetTime);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
}

/**
 * When an alarm rings on `day`'s calendar date, or null if it doesn't. Ignores
 * `enabled`; the caller decides whether a switched-off alarm counts.
 */
export function ringOn(alarm: Alarm, day: Date): Date | null {
  if (isRepeating(alarm)) return repeatingRingOn(alarm, day);
  if (!alarm.fireAt) return null;
  const at = new Date(alarm.fireAt);
  return calendarKey(at) === calendarKey(day) ? at : null;
}

export interface MorningAlarm {
  /** Midnight of the morning asked about. */
  date: Date;
  /** The alarm that rings that morning, and when, or null for none. */
  ring: { alarm: Alarm; at: Date } | null;
  /** With no ring that morning, the next one after it, to say when it is. */
  next: { alarm: Alarm; at: Date } | null;
}

/**
 * The alarm a task's link means for the coming morning. `next` (or an id that
 * isn't on this device) is the first switched-on alarm to ring that date; an
 * id is that alarm alone. A ring already past (a 6 AM alarm, checked at 7 AM
 * on the morning itself) doesn't count.
 */
export function morningAlarmFor(link: string, alarms: readonly Alarm[], now: Date, dayResetTime = '00:00'): MorningAlarm {
  const date = morningDate(now, dayResetTime);
  const linked = link === NEXT_ALARM_LINK ? undefined : alarms.find(a => a.id === link);
  const pool = (linked ? [linked] : alarms).filter(a => a.enabled);
  const after = (at: Date | null) => at !== null && at.getTime() > now.getTime();

  let ring: MorningAlarm['ring'] = null;
  for (const alarm of pool) {
    const at = ringOn(alarm, date);
    if (after(at) && (!ring || at!.getTime() < ring.at.getTime())) ring = { alarm, at: at! };
  }
  if (ring) return { date, ring, next: null };

  // Nothing that morning: the first ring in the week after it, for the card's
  // "the next one is" line.
  let next: MorningAlarm['next'] = null;
  for (let offset = 1; offset <= 7 && !next; offset++) {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
    for (const alarm of pool) {
      const at = ringOn(alarm, day);
      if (after(at) && (!next || at!.getTime() < next.at.getTime())) next = { alarm, at: at! };
    }
  }
  return { date, ring: null, next };
}

/**
 * The override for ringing at `hour:minute` on `day` only, or null when that
 * is the alarm's own time (no override needed). Only a repeating alarm that
 * rings that day takes one; the caller checks.
 */
export function overrideFor(alarm: Pick<Alarm, 'hour' | 'minute'>, day: Date, hour: number, minute: number): AlarmOverride | null {
  if (hour === alarm.hour && minute === alarm.minute) return null;
  return { date: calendarKey(day), hour, minute };
}

/** Midnight of an override's date. */
export function overrideDay(override: AlarmOverride): Date {
  const [y, m, d] = override.date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** The instant an override rings. */
export function overrideAt(override: AlarmOverride): Date {
  return atTime(overrideDay(override), override.hour, override.minute);
}

/** An override whose day is over: the alarm is back on its own time. */
export function isOverrideSpent(override: AlarmOverride, now: Date): boolean {
  const day = overrideDay(override);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime() <= now.getTime();
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export type AlarmDetailIcon = 'barbell-outline' | 'volume-high-outline' | 'moon-outline';

/**
 * What an alarm's row says under its time, as a row of icons (mission, a
 * chosen sound, a one-night time) and the words for the ones that
 * need them. Null when it has none, so a plain alarm draws nothing. `clock`
 * formats a time the way the person's settings do.
 */
export function alarmDetails(
  alarm: Alarm,
  now: Date,
  clock: (at: Date) => string,
): { icons: AlarmDetailIcon[]; text: string } | null {
  const icons: AlarmDetailIcon[] = [];
  const words: string[] = [];
  const mission = alarmMissionLine(alarm, now);
  if (mission) {
    icons.push('barbell-outline');
    words.push(mission);
  }
  if (alarm.sound !== null) icons.push('volume-high-outline');
  const o = alarm.override;
  if (o && isRepeating(alarm) && !isOverrideSpent(o, now)) {
    icons.push('moon-outline');
    const day = overrideDay(o);
    const ahead = Math.round((day.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86_400_000);
    const when = ahead === 0 ? 'today' : ahead === 1 ? 'tomorrow' : DAY_SHORT[day.getDay()];
    words.push(`${clock(overrideAt(o))} ${when}`);
  }
  return icons.length === 0 ? null : { icons, text: words.join(' · ') };
}

/**
 * The chip on the task's row: "Mon 7:00 AM", or "No alarm Mon" for a morning
 * with none. `clock` formats a time the way the person's settings do.
 */
export function morningChipLabel(morning: MorningAlarm, clock: (at: Date) => string): string {
  const day = DAY_SHORT[morning.date.getDay()];
  return morning.ring ? `${day} ${clock(morning.ring.at)}` : `No alarm ${day}`;
}
