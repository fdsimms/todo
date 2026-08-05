import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  subDays,
  format,
  isSameDay,
  isSameWeek,
  startOfDay,
  startOfMonth,
  differenceInCalendarDays,
  setDate,
  lastDayOfMonth,
} from 'date-fns';
import type { Task } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * Returns the start of the logical "day" for a given datetime.
 * If dayResetTime is "02:00" and it's 1:30 AM, we're still in the previous logical day.
 */
export function getDayStart(date: Date = new Date(), dayResetTime?: string): Date {
  const rt = dayResetTime ?? useSettingsStore.getState().dayResetTime;
  const [h, m] = rt.split(':').map(Number);

  const resetOnDate = new Date(date);
  resetOnDate.setHours(h, m, 0, 0);

  // Before the reset hour → still belongs to the previous logical day
  if (date < resetOnDate) {
    resetOnDate.setDate(resetOnDate.getDate() - 1);
  }

  return resetOnDate;
}

export function getCurrentDayStart(): Date {
  return getDayStart(new Date());
}

/**
 * The logical-day-start instant for a *stored* date like a task's dueDate or
 * deferUntil — the calendar day the value represents, at the dayResetTime
 * clock time. Unlike getDayStart(), this never rolls the result back a day:
 * getDayStart()'s rollback exists to handle "now" landing in the early-morning
 * grace window before today's reset has happened yet. A stored date's own
 * clock-time carries no such meaning — it's whatever anchor hour the picker
 * used (noon, midnight, the reset hour at generation time) — so treating an
 * early clock-time as "still the previous logical day" would silently pull a
 * task scheduled for tomorrow into today whenever that anchor happens to
 * precede the current dayResetTime.
 */
export function getTaskDayStart(date: Date, dayResetTime?: string): Date {
  const rt = dayResetTime ?? useSettingsStore.getState().dayResetTime;
  const [h, m] = rt.split(':').map(Number);
  const result = startOfDay(date);
  result.setHours(h, m, 0, 0);
  return result;
}

/** Applies an "HH:MM" clock time to today's (or a given base) date. */
export function hhmmToDate(hhmm: string, base: Date = new Date()): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Formats an "HH:MM" clock time for display, e.g. "8:00 AM". */
export function formatHHMM(hhmm: string): string {
  return format(hhmmToDate(hhmm), 'h:mm a');
}

/** Inverse of hhmmToDate — extracts "HH:MM" from a Date's clock time. */
export function dateToHHMM(d: Date): string {
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

/**
 * The calendar date of the current logical day — i.e. the date a task needs
 * to fall on to be visible right now. Normally today's date, but in the
 * early-morning window before dayResetTime it's still yesterday's date.
 */
export function getLogicalToday(dayResetTime?: string): Date {
  return startOfDay(getDayStart(new Date(), dayResetTime));
}

export function getLogicalTomorrow(dayResetTime?: string): Date {
  return addDays(getLogicalToday(dayResetTime), 1);
}

/**
 * True during the early-morning window (after midnight, before
 * dayResetTime) — when "today" by the wall clock is still part of
 * yesterday's logical day, so "Today"/"Tomorrow" need clarifying with
 * actual dates.
 */
/**
 * The current instant, pinned to the logical day's calendar date — for
 * feeding into parseNaturalDate/parseTaskInput so "tomorrow" typed in the
 * early-morning window before dayResetTime resolves relative to the logical
 * day (still "yesterday") rather than the wall-clock calendar day. Preserves
 * the actual clock time so relative durations ("in 30 min") stay accurate.
 */
export function getLogicalNow(dayResetTime?: string): Date {
  const now = new Date();
  return isBeforeDayReset(dayResetTime) ? subDays(now, 1) : now;
}

export function isBeforeDayReset(dayResetTime?: string): boolean {
  return getLogicalToday(dayResetTime).getTime() !== startOfDay(new Date()).getTime();
}

export function formatDueDate(iso: string, dayResetTime?: string): string {
  const d = new Date(iso);
  const today = getDayStart(new Date(), dayResetTime);
  if (isSameDay(d, today)) return 'Today';
  if (isSameDay(d, addDays(today, 1))) return 'Tomorrow';
  const diff = differenceInCalendarDays(d, today);
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (isSameWeek(d, today)) return format(d, 'EEEE');
  return format(d, d.getFullYear() === today.getFullYear() ? 'MMM d' : 'MMM d, yyyy');
}

export function formatDeferUntil(iso: string, dayResetTime?: string): string {
  const d = new Date(iso);
  const today = getDayStart(new Date(), dayResetTime);
  if (isSameDay(d, today)) return 'Today';
  if (isSameDay(d, addDays(today, 1))) return 'Tomorrow';
  const diff = differenceInCalendarDays(d, today);
  if (diff < 7) return format(d, 'EEEE');
  return format(d, d.getFullYear() === today.getFullYear() ? 'MMM d' : 'MMM d, yyyy');
}

/**
 * Formats a Later-list section header.
 *
 * Dates within the next week (today + 6 days) get their own header, with the
 * date alongside the relative label so headers remain unambiguous. Dates
 * further out are batched together by month (with a year suffix when it
 * differs from the current year) so the list doesn't grow one header per day.
 */
export function formatGroupHeader(iso: string, dayResetTime?: string): string {
  const d = new Date(iso);
  const today = getDayStart(new Date(), dayResetTime);
  const diff = differenceInCalendarDays(d, today);
  if (diff < 7) {
    if (isSameDay(d, today)) return `Today · ${format(d, 'MMM d')}`;
    if (isSameDay(d, addDays(today, 1))) return `Tomorrow · ${format(d, 'MMM d')}`;
    return format(d, 'EEEE · MMM d');
  }
  return d.getFullYear() === today.getFullYear() ? format(d, 'MMMM') : format(d, 'MMMM yyyy');
}

export function getNextDueDate(task: Task, dayResetTime?: string): Date | null {
  // Fixed schedule: anchor to the previous due date so the recurrence grid doesn't drift.
  // After completion: anchor to today (the completion day) so it's always relative to when you finished.
  const base =
    !task.recurrenceFromCompletion && task.dueDate
      ? getTaskDayStart(new Date(task.dueDate), dayResetTime)
      : getDayStart(new Date(), dayResetTime);
  let next: Date;
  switch (task.recurrenceType) {
    case 'daily':
      next = addDays(base, task.recurrenceInterval);
      break;
    case 'weekly':
      next = task.recurrenceDays.length > 0
        ? getNextWeekdayOccurrence(task.recurrenceDays, base)
        : addWeeks(base, task.recurrenceInterval);
      break;
    case 'monthly':
      next = task.recurrenceWeekOrdinal !== null && task.recurrenceDays.length > 0
        ? getNextWeekdayOfMonthOccurrence(task.recurrenceDays[0], task.recurrenceWeekOrdinal, base)
        : task.recurrenceMonthDay
          ? getNextMonthDayOccurrence(task.recurrenceMonthDay, base)
          : addMonths(base, task.recurrenceInterval);
      break;
    case 'yearly':
      next = addYears(base, task.recurrenceInterval);
      break;
    default:
      next = addDays(base, 1);
  }
  if (task.recurrenceEndDate && next > new Date(task.recurrenceEndDate)) {
    return null;
  }
  if (task.recurrenceCount !== null && task.recurrenceCount <= 1) {
    return null;
  }
  return next;
}

function getNextWeekdayOccurrence(days: number[], from: Date): Date {
  const dow = from.getDay();
  const sorted = [...days].sort((a, b) => a - b);
  for (const day of sorted) {
    if (day > dow) return addDays(from, day - dow);
  }
  return addDays(from, 7 - dow + sorted[0]);
}

/**
 * The Nth weekday-of-month occurrence within the month containing `monthDate`,
 * e.g. "the 2nd Tuesday" (ordinal=2) or "the last Friday" (ordinal=-1).
 * Ordinals 1-4 are always within the month (every month has at least 28 days).
 */
export function nthWeekdayOfMonth(monthDate: Date, weekday: number, ordinal: number): Date {
  if (ordinal === -1) {
    const last = lastDayOfMonth(monthDate);
    return subDays(last, (last.getDay() - weekday + 7) % 7);
  }
  const first = startOfMonth(monthDate);
  const offset = (weekday - first.getDay() + 7) % 7;
  return addDays(first, offset + (ordinal - 1) * 7);
}

function getNextWeekdayOfMonthOccurrence(weekday: number, ordinal: number, from: Date): Date {
  const thisMonth = nthWeekdayOfMonth(from, weekday, ordinal);
  if (thisMonth > from) return thisMonth;
  return nthWeekdayOfMonth(addMonths(from, 1), weekday, ordinal);
}

/**
 * Next occurrence of a fixed day-of-month (e.g. "the 5th"), clamped to the
 * last day of short months. `day === -1` means "the last day of the month",
 * whatever that is for each occurrence (28-31).
 */
function getNextMonthDayOccurrence(day: number, from: Date): Date {
  const clampToMonth = (d: Date) =>
    day === -1 ? lastDayOfMonth(d) : setDate(d, Math.min(day, lastDayOfMonth(d).getDate()));
  const thisMonth = clampToMonth(from);
  if (thisMonth > from) return thisMonth;
  return clampToMonth(addMonths(from, 1));
}

/** Formats time remaining until an "HH:MM" window end, e.g. "2h 15m left" or "15m left". */
export function formatWindowRemaining(windowEnd: string): string {
  const minutesLeft = Math.max(0, Math.round((hhmmToDate(windowEnd).getTime() - Date.now()) / 60000));
  const hours = Math.floor(minutesLeft / 60);
  const minutes = minutesLeft % 60;
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m left`;
  if (hours > 0) return `${hours}h left`;
  return `${minutes}m left`;
}

/**
 * Days remaining until a task's deadline, using the logical (reset-time-aware)
 * day boundary. Negative once the deadline has passed.
 */
export function getDeadlineCountdown(deadline: string, dayResetTime?: string): number {
  const today = getDayStart(new Date(), dayResetTime);
  const target = getDayStart(new Date(deadline), dayResetTime);
  return differenceInCalendarDays(target, today);
}

/** Deadline expressed as N days before a due date, e.g. the Wednesday before a Thursday recurrence. */
export function getDeadlineFromOffset(dueDate: Date, offsetDays: number): Date {
  return subDays(dueDate, offsetDays);
}

/**
 * Deadline expressed as a fixed day-of-month within the due date's own month,
 * e.g. "due the 20th, deadline the last day of the month" — unlike
 * getDeadlineFromOffset, this stays correct across months of different
 * lengths since it isn't a fixed day count from the due date. `day === -1`
 * means the last day of the month, same convention as recurrenceMonthDay.
 */
export function getDeadlineFromMonthDay(dueDate: Date, day: number): Date {
  return day === -1 ? lastDayOfMonth(dueDate) : setDate(dueDate, Math.min(day, lastDayOfMonth(dueDate).getDate()));
}

/**
 * Returns the current streak display for a recurring task:
 *   positive → { sign: '+', count: N }   (N consecutive completions)
 *   negative → { sign: '-', count: N }   (N days missed)
 *   null     → not a recurring task or no history
 */
export function getStreakDisplay(
  task: Task
): { sign: '+' | '-'; count: number } | null {
  if (task.recurrenceType === 'none' || !task.streakDate) return null;

  const dayResetTime = useSettingsStore.getState().dayResetTime;
  const lastDay = getDayStart(new Date(task.streakDate), dayResetTime);
  const today = getCurrentDayStart();
  const daysMissed = differenceInCalendarDays(today, lastDay);

  if (daysMissed <= 1) {
    // Streak is current (completed today or yesterday)
    return task.streakCount > 1 ? { sign: '+', count: task.streakCount } : null;
  }
  // daysMissed - 1 because "1 day missed" means you skipped one window
  return { sign: '-', count: daysMissed - 1 };
}
