import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';

// Local copies of `dayKeyToDate`/`dayKeyOf`/`shiftDayKey`: those live in
// modules that pull in the settings store and with it the database, which a
// pure rule about day keys has no business loading.
function dayKeyToDate(key: string): Date {
  return new Date(`${key}T00:00:00`);
}

function shiftDayKey(key: string, days: number): string {
  return format(addDays(dayKeyToDate(key), days), 'yyyy-MM-dd');
}

/**
 * The days a regular medicine is taken on.
 *
 * A medicine taken "on schedule" used to mean only a tag on its doses; it never
 * said which days. This is that answer, kept with the medicine's other settings
 * (`MedicationPrefs.schedule`) rather than as a repeating task, because a task
 * is one reminder and a medicine can be taken without one.
 *
 * **Every N days counts from the last dose, not from a fixed start.** Someone
 * on "every other day" who takes it a day late is next due two days after that
 * dose; measuring from a start date would call every later dose early or late
 * for good. A medicine with no dose yet is due now.
 *
 * **Certain weekdays are due on those days only**, and a weekday that went by
 * with no dose is not carried forward as overdue: there is no dose to catch up
 * on, and a pile of "missed" days is the nagging this app avoids.
 *
 * Everything is on day keys (`YYYY-MM-DD`), the logical day a dose was written
 * under, so the caller passes its own today (`getLogicalDayKey`).
 */
export type MedicationSchedule =
  | { kind: 'interval'; everyDays: number }
  | { kind: 'weekdays'; days: number[] };

/** Past this, "every N days" is a different kind of thing (a supply, a refill). */
export const MAX_SCHEDULE_INTERVAL = 30;

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** A schedule read back from storage, or null when it is malformed. */
export function parseSchedule(raw: unknown): MedicationSchedule | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.kind === 'interval') {
    const n = r.everyDays;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_SCHEDULE_INTERVAL) return null;
    return { kind: 'interval', everyDays: n };
  }
  if (r.kind === 'weekdays') {
    if (!Array.isArray(r.days)) return null;
    const days = [...new Set(r.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
    return days.length > 0 ? { kind: 'weekdays', days } : null;
  }
  return null;
}

/** "Every day", "Every other day", "Every 3 days", "Mon, Wed, Fri". */
export function describeSchedule(schedule: MedicationSchedule): string {
  if (schedule.kind === 'interval') {
    const n = schedule.everyDays;
    return n === 1 ? 'Every day' : n === 2 ? 'Every other day' : `Every ${n} days`;
  }
  if (schedule.days.length === 7) return 'Every day';
  return schedule.days.map(d => WEEKDAY_SHORT[d]).join(', ');
}

export type ScheduleState = 'dueToday' | 'overdue' | 'takenToday' | 'upcoming';

export interface ScheduleStatus {
  state: ScheduleState;
  /** The next day a dose is due: today when it is due now or overdue. */
  nextDueKey: string;
  /** For `overdue`, how many days past its day. */
  daysLate: number;
}

function daysBetween(fromKey: string, toKey: string): number {
  return Math.round((dayKeyToDate(toKey).getTime() - dayKeyToDate(fromKey).getTime()) / 86400000);
}

/** Where a schedule stands today, given the days a dose of this medicine was recorded on. */
export function scheduleStatus(
  schedule: MedicationSchedule,
  doseDayKeys: readonly string[],
  todayKey: string,
): ScheduleStatus {
  // A dose recorded for a future day (a typo, a backdated edit gone forward)
  // says nothing about today, so only doses up to today count.
  const past = doseDayKeys.filter(k => k <= todayKey);
  const takenToday = past.includes(todayKey);
  if (schedule.kind === 'interval') {
    const last = past.length > 0 ? past.reduce((a, b) => (a > b ? a : b)) : null;
    if (last === null) return { state: 'dueToday', nextDueKey: todayKey, daysLate: 0 };
    const next = shiftDayKey(last, schedule.everyDays);
    if (takenToday) return { state: 'takenToday', nextDueKey: next, daysLate: 0 };
    if (next < todayKey) return { state: 'overdue', nextDueKey: todayKey, daysLate: daysBetween(next, todayKey) };
    return { state: next === todayKey ? 'dueToday' : 'upcoming', nextDueKey: next, daysLate: 0 };
  }
  const onDay = (key: string) => schedule.days.includes(dayKeyToDate(key).getDay());
  if (onDay(todayKey) && !takenToday) return { state: 'dueToday', nextDueKey: todayKey, daysLate: 0 };
  let next = shiftDayKey(todayKey, 1);
  for (let i = 0; i < 7 && !onDay(next); i++) next = shiftDayKey(next, 1);
  return { state: takenToday && onDay(todayKey) ? 'takenToday' : 'upcoming', nextDueKey: next, daysLate: 0 };
}

/** The status in a line: "Due today", "Taken today. Next on Fri, Oct 23". */
export function describeScheduleStatus(status: ScheduleStatus, todayKey: string): string {
  const next = () => {
    const tomorrow = shiftDayKey(todayKey, 1);
    return status.nextDueKey === tomorrow ? 'tomorrow' : `on ${format(dayKeyToDate(status.nextDueKey), 'EEE, MMM d')}`;
  };
  switch (status.state) {
    case 'dueToday': return 'Due today';
    case 'overdue': return `Due today, ${status.daysLate === 1 ? '1 day' : `${status.daysLate} days`} past its day`;
    case 'takenToday': return `Taken today. Next ${next()}`;
    case 'upcoming': return `Next ${next()}`;
  }
}
