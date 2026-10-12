/**
 * Public holidays and the user's own days off, as day keys, for a recurring
 * task that skips them or moves off them (`Task.recurrenceHolidays`).
 *
 * **Computed, never read from the calendar.** iOS ships a Holidays calendar,
 * but the calendar read is opt-in, async and deliberately never cached
 * (`useCalendarStore`'s header), while the recurrence engine runs
 * synchronously inside a completion. So the dates are worked out here from
 * their rules ("the fourth Thursday in November"), which also makes them the
 * same on every device and in the MCP replica, and testable.
 *
 * **A holiday that falls on a weekend is both of its days.** The date itself
 * (a Saturday July 4th) and the weekday it's observed on (Friday the 3rd),
 * because a Saturday chore and a weekday office task each mean a different one
 * of the two. Each observed day is named as such, so a caption can say which.
 *
 * Store-free like `clockTime.ts`: callers pass the set and the custom days.
 */

export type HolidaySet = 'none' | 'us';

export const HOLIDAY_SETS: readonly HolidaySet[] = ['none', 'us'];

export const HOLIDAY_SET_LABELS: Record<HolidaySet, string> = {
  none: 'None',
  us: 'US federal',
};

export interface Holiday {
  /** Local `YYYY-MM-DD`. */
  dayKey: string;
  name: string;
}

/** What a holiday check needs: the built-in set and the user's own day keys. */
export interface HolidayConfig {
  set: HolidaySet;
  custom: readonly string[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, month0: number, day: number) => `${y}-${pad(month0 + 1)}-${pad(day)}`;

/** The day of the month of the nth `weekday` (0 = Sunday) in a month; n = -1 for the last. */
function nthWeekday(year: number, month0: number, weekday: number, n: number): number {
  if (n > 0) {
    const firstDow = new Date(year, month0, 1).getDay();
    return 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7;
  }
  const lastDay = new Date(year, month0 + 1, 0).getDate();
  const lastDow = new Date(year, month0, lastDay).getDay();
  return lastDay - ((lastDow - weekday + 7) % 7);
}

/** A fixed-date holiday plus, when it falls on a weekend, the weekday it's observed on. */
function fixedWithObserved(year: number, month0: number, day: number, name: string): Holiday[] {
  const date = new Date(year, month0, day);
  const out: Holiday[] = [{ dayKey: keyOf(year, month0, day), name }];
  const dow = date.getDay();
  if (dow === 6 || dow === 0) {
    const observed = new Date(year, month0, day + (dow === 6 ? -1 : 1));
    out.push({ dayKey: keyOf(observed.getFullYear(), observed.getMonth(), observed.getDate()), name: `${name} (observed)` });
  }
  return out;
}

/** The eleven US federal holidays of one calendar year, with any observed weekdays. */
function usFederalCandidates(year: number): Holiday[] {
  return [
    ...fixedWithObserved(year, 0, 1, "New Year’s Day"),
    { dayKey: keyOf(year, 0, nthWeekday(year, 0, 1, 3)), name: 'Martin Luther King Jr. Day' },
    { dayKey: keyOf(year, 1, nthWeekday(year, 1, 1, 3)), name: "Presidents’ Day" },
    { dayKey: keyOf(year, 4, nthWeekday(year, 4, 1, -1)), name: 'Memorial Day' },
    // A federal holiday from 2021 on.
    ...(year >= 2021 ? fixedWithObserved(year, 5, 19, 'Juneteenth') : []),
    ...fixedWithObserved(year, 6, 4, 'Independence Day'),
    { dayKey: keyOf(year, 8, nthWeekday(year, 8, 1, 1)), name: 'Labor Day' },
    { dayKey: keyOf(year, 9, nthWeekday(year, 9, 1, 2)), name: 'Columbus Day' },
    ...fixedWithObserved(year, 10, 11, 'Veterans Day'),
    { dayKey: keyOf(year, 10, nthWeekday(year, 10, 4, 4)), name: 'Thanksgiving' },
    ...fixedWithObserved(year, 11, 25, 'Christmas Day'),
  ];
}

const yearCache = new Map<string, Holiday[]>();

/**
 * A set's holidays that fall in `year`, sorted. Built from the years either
 * side too, because an observed day can cross into it: a Saturday New Year's
 * Day is observed on the Friday before, which is December 31st of the year
 * before.
 */
export function holidaysInYear(set: HolidaySet, year: number): Holiday[] {
  if (set === 'none') return [];
  const cacheKey = `${set}|${year}`;
  const hit = yearCache.get(cacheKey);
  if (hit) return hit;
  const prefix = `${year}-`;
  const list = [year - 1, year, year + 1]
    .flatMap(usFederalCandidates)
    .filter(h => h.dayKey.startsWith(prefix))
    .sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0));
  yearCache.set(cacheKey, list);
  return list;
}

/**
 * The holiday on a day, by name: the built-in set's first, then the user's own
 * ("Day off"). Null on an ordinary day.
 */
export function holidayOn(dayKey: string, config: HolidayConfig): string | null {
  const year = Number(dayKey.slice(0, 4));
  const builtIn = Number.isFinite(year) ? holidaysInYear(config.set, year).find(h => h.dayKey === dayKey) : undefined;
  if (builtIn) return builtIn.name;
  return config.custom.includes(dayKey) ? 'Day off' : null;
}

/** Whether any holiday applies at all, so a control can say when the rule has nothing to do. */
export function hasAnyHolidays(config: HolidayConfig): boolean {
  return config.set !== 'none' || config.custom.length > 0;
}

/** The next holiday on or after `fromKey`, looking a year ahead, or null. */
export function nextHoliday(fromKey: string, config: HolidayConfig): Holiday | null {
  const year = Number(fromKey.slice(0, 4));
  const candidates = [
    ...holidaysInYear(config.set, year),
    ...holidaysInYear(config.set, year + 1),
    ...config.custom.map(dayKey => ({ dayKey, name: 'Day off' })),
  ].filter(h => h.dayKey >= fromKey);
  candidates.sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0));
  return candidates[0] ?? null;
}

/** Reads the stored `holidaySet` setting, defaulting to the US set. */
export function parseHolidaySet(text: string | null | undefined): HolidaySet {
  return (HOLIDAY_SETS as readonly string[]).includes(text ?? '') ? (text as HolidaySet) : 'us';
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the stored `customHolidays` setting (a JSON list of day keys), sorted and deduplicated. */
export function parseCustomHolidays(text: string | null | undefined): string[] {
  if (!text) return [];
  try {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return [];
    return [...new Set(value.filter((v): v is string => typeof v === 'string' && DAY_KEY.test(v)))].sort();
  } catch {
    return [];
  }
}
