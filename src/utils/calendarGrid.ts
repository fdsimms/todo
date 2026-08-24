import { startOfMonth } from 'date-fns/startOfMonth';
import { endOfMonth } from 'date-fns/endOfMonth';
import { startOfWeek } from 'date-fns/startOfWeek';
import { endOfWeek } from 'date-fns/endOfWeek';
import { addDays } from 'date-fns/addDays';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
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
 * The seven days of the week `date` falls in, rotated to match `weekStartsOn`.
 *
 * Same parameter-with-a-default shape as buildCalendarGrid, and for the same
 * reason: it stays a pure function its tests can drive without a store.
 *
 * `weekdayHeaders` is deliberately *not* its companion here the way it is for
 * the month grid — the meal plan renders seven vertical day sections rather
 * than seven columns, so there is nothing to label. (At 390pt a 7-column strip
 * gives each day ~52pt, which cannot hold "Sausage & fennel ragù". A strip is a
 * date-*picker* affordance; every cell of a week plan carries content.)
 */
export function buildWeekDays(date: Date, weekStartsOn: WeekStart = 0): Date[] {
  const start = startOfWeek(date, { weekStartsOn });
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
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

/**
 * Whether a date picker may offer `day` at all, and where it may page back to
 * — the three functions a picker needs to refuse days before `earliest`.
 *
 * `earliest` is nullable throughout and null means "no floor", so an
 * unrestricted picker passes null rather than each call site branching. It is
 * always a *day*: a floor of "today" means today is pickable and yesterday
 * isn't, never "later than this moment". Picking a day is choosing a square on
 * a grid, and half of today being unavailable is not something a month grid
 * can show.
 *
 * The floor itself has to be a `dayResetTime`-aware "today"
 * (`getLogicalToday`) — see CLAUDE.md on the grace window. These stay pure and
 * take whatever they're given.
 */

/** True when `day` falls on an earlier calendar day than `earliest`. */
export function isDayBefore(day: Date, earliest: Date): boolean {
  return differenceInCalendarDays(day, earliest) < 0;
}

/**
 * The month a picker should display, pulled forward to `earliest`'s month when
 * the date it wanted to open on is behind the floor.
 *
 * Without this, a picker holding an old value opens on a month whose every
 * cell is refused, with the back chevron disabled — which reads as a broken
 * calendar rather than as a floor.
 */
export function clampMonthToEarliest(month: Date, earliest: Date | null): Date {
  const start = startOfMonth(month);
  if (!earliest) return start;
  const floor = startOfMonth(earliest);
  return start < floor ? floor : start;
}

/** Whether the back chevron has anywhere to go. */
export function canPageToPreviousMonth(displayMonth: Date, earliest: Date | null): boolean {
  if (!earliest) return true;
  return startOfMonth(displayMonth) > startOfMonth(earliest);
}
