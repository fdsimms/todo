import type { Category } from '../types';

export const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
export const FULL_DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

/** "09:00" -> "9 AM", "13:30" -> "1:30 PM". */
export function formatScheduleTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${suffix}` : `${hour}:${m.toString().padStart(2, '0')} ${suffix}`;
}

/** [1,2,3,4,5] -> "Weekdays"; [0,6] -> "Weekends"; [1,3] -> "Mo We". */
export function formatScheduleDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  const key = sorted.join(',');
  if (key === '1,2,3,4,5') return 'Weekdays';
  if (key === '0,6') return 'Weekends';
  if (sorted.length === 7) return 'Every day';
  return sorted.map(d => DAY_LABELS[d]).join(' ');
}

/**
 * One-line summary of a category's visibility schedule, e.g.
 * "Weekdays, 9 AM–6 PM". Null when the category has no schedule — callers
 * use that to decide whether to show the schedule affordance at all.
 */
export function formatCategorySchedule(cat: Category | null | undefined): string | null {
  if (!cat?.scheduleDays || !cat.scheduleStart || !cat.scheduleEnd) return null;
  if (cat.scheduleDays.length === 0) return null;
  return `${formatScheduleDays(cat.scheduleDays)}, ${formatScheduleTime(cat.scheduleStart)}–${formatScheduleTime(cat.scheduleEnd)}`;
}
