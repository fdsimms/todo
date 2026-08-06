import { startOfMonth } from 'date-fns/startOfMonth';
import { endOfMonth } from 'date-fns/endOfMonth';
import { startOfWeek } from 'date-fns/startOfWeek';
import { endOfWeek } from 'date-fns/endOfWeek';
import { addDays } from 'date-fns/addDays';
import type { WeekStart } from '../store/useSettingsStore';

const SUNDAY_FIRST_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The seven single-letter column headers above a month grid, rotated to match
 * `weekStartsOn`. Shared by the three calendars (CalendarPicker, WhenPicker,
 * RemindMePicker), which each used to hold their own Sunday-first copy — and
 * a rotated grid over unrotated headers is off by a day in silence, so this is
 * worth having in one tested place.
 */
export function weekdayHeaders(weekStartsOn: WeekStart = 0): string[] {
  return [
    ...SUNDAY_FIRST_HEADERS.slice(weekStartsOn),
    ...SUNDAY_FIRST_HEADERS.slice(0, weekStartsOn),
  ];
}

/**
 * The days to render for a month grid: the whole month, padded out to complete
 * weeks at both ends, then padded further so the grid is always 42 cells /
 * 6 rows. The fixed height is what keeps the calendar from resizing as you
 * page between months — a month that fits in 5 rows still gets 6.
 *
 * `weekStartsOn` is a parameter with a literal default rather than a store
 * read, so this stays a pure function its tests can drive directly. Callers
 * pass the setting; see weekdayHeaders for the labels that go above it.
 */
export function buildCalendarGrid(displayMonth: Date, weekStartsOn: WeekStart = 0): Date[] {
  const monthStart = startOfMonth(displayMonth);
  const monthEnd = endOfMonth(displayMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn });
  const days: Date[] = [];
  let cur = gridStart;
  while (cur <= gridEnd) {
    days.push(cur);
    cur = addDays(cur, 1);
  }
  // Ensure we always have 42 cells (6 weeks)
  while (days.length < 42) {
    days.push(addDays(days[days.length - 1], 1));
  }
  return days;
}
