import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  format,
  isToday,
  isTomorrow,
  isThisWeek,
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

export function formatDueDate(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  const diff = differenceInCalendarDays(d, new Date());
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (isThisWeek(d)) return format(d, 'EEEE');
  return format(d, 'MMM d');
}

export function formatDeferUntil(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  const diff = differenceInCalendarDays(d, new Date());
  if (diff < 7) return format(d, 'EEEE');
  return format(d, 'MMM d');
}

export function formatGroupHeader(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  if (isThisWeek(d)) return format(d, 'EEEE');
  return format(d, 'MMMM d');
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
