import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  format,
  isSameDay,
  isSameWeek,
  startOfDay,
  differenceInCalendarDays,
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
  return format(d, 'MMM d');
}

export function formatDeferUntil(iso: string, dayResetTime?: string): string {
  const d = new Date(iso);
  const today = getDayStart(new Date(), dayResetTime);
  if (isSameDay(d, today)) return 'Today';
  if (isSameDay(d, addDays(today, 1))) return 'Tomorrow';
  const diff = differenceInCalendarDays(d, today);
  if (diff < 7) return format(d, 'EEEE');
  return format(d, 'MMM d');
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
      ? getDayStart(new Date(task.dueDate), dayResetTime)
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
      next = addMonths(base, task.recurrenceInterval);
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
 * Days remaining until a task's deadline, using the logical (reset-time-aware)
 * day boundary. Negative once the deadline has passed.
 */
export function getDeadlineCountdown(deadline: string, dayResetTime?: string): number {
  const today = getDayStart(new Date(), dayResetTime);
  const target = getDayStart(new Date(deadline), dayResetTime);
  return differenceInCalendarDays(target, today);
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
