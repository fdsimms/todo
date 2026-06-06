import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  format,
  isToday,
  isTomorrow,
  isThisWeek,
  startOfDay,
  differenceInCalendarDays,
} from 'date-fns';
import type { Task } from '../types';

export function formatDueDate(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return 'Today';
  if (isTomorrow(d)) return 'Tomorrow';
  const diff = differenceInCalendarDays(d, new Date());
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  if (isThisWeek(d)) return format(d, 'EEEE');
  return format(d, 'MMM d');
}

export function formatShowAfterTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return format(d, 'h:mm a');
}

export function formatDeferUntil(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return `Today at ${format(d, 'h:mm a')}`;
  if (isTomorrow(d)) return `Tomorrow at ${format(d, 'h:mm a')}`;
  return format(d, 'MMM d \'at\' h:mm a');
}

export function formatGroupHeader(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return 'Today, later';
  if (isTomorrow(d)) return 'Tomorrow';
  if (isThisWeek(d)) return format(d, 'EEEE');
  return format(d, 'MMMM d');
}

export function getNextDueDate(task: Task): Date {
  const base = startOfDay(new Date());
  switch (task.recurrenceType) {
    case 'daily':
      return addDays(base, task.recurrenceInterval);
    case 'weekly':
      if (task.recurrenceDays.length > 0) {
        return getNextWeekdayOccurrence(task.recurrenceDays);
      }
      return addWeeks(base, task.recurrenceInterval);
    case 'monthly':
      return addMonths(base, task.recurrenceInterval);
    case 'yearly':
      return addYears(base, task.recurrenceInterval);
    default:
      return addDays(base, 1);
  }
}

function getNextWeekdayOccurrence(days: number[]): Date {
  const today = new Date();
  const todayDow = today.getDay();
  const sorted = [...days].sort((a, b) => a - b);

  for (const day of sorted) {
    if (day > todayDow) {
      return startOfDay(addDays(today, day - todayDow));
    }
  }
  // Wrap to next week
  const first = sorted[0];
  return startOfDay(addDays(today, 7 - todayDow + first));
}
