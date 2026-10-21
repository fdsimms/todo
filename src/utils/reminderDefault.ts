import type { TimeOfDay } from '../types';
import { onLogicalDay } from './clockTime';

const SEGMENT_ORDER: readonly TimeOfDay[] = ['morning', 'afternoon', 'evening', 'night'];

/** When a reminder starts out with no time of day to go on. */
export const DEFAULT_REMINDER_HHMM = '09:00';

/**
 * Where a new reminder's time starts out in the picker: when the task's time
 * of day begins on its day (the earliest, if it has several), or 9:00 for a
 * task with none. An evening task offered a 9 AM reminder was a reminder set
 * for a moment the task wasn't even showing.
 *
 * `day` is a calendar date (a due date, or the logical today). Every segment
 * but morning is placed with `onLogicalDay`, so a night that starts after
 * midnight lands at the end of the day rather than before it began; morning
 * is the first segment and is set on the date as written, the same rule
 * `getTimeOfDayThreshold` follows.
 */
export function defaultReminderAt(
  day: Date,
  segments: readonly TimeOfDay[],
  segmentStarts: Readonly<Record<TimeOfDay, string>>,
  dayResetTime: string,
): Date {
  const first = SEGMENT_ORDER.find(s => segments.includes(s));
  const hhmm = first ? segmentStarts[first] : DEFAULT_REMINDER_HHMM;
  if (!first || first === 'morning') {
    const at = new Date(day);
    const [h, m] = hhmm.split(':').map(Number);
    at.setHours(h, m, 0, 0);
    return at;
  }
  const dayStart = new Date(day);
  const [rh, rm] = dayResetTime.split(':').map(Number);
  dayStart.setHours(rh, rm, 0, 0);
  return onLogicalDay(dayStart, hhmm);
}
