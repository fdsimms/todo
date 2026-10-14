/**
 * Recurring windows that block a group of apps by the clock: the rules, with
 * no store and no native call in them.
 *
 * **A window is wall-clock time, not a logical day.** "Weekdays 22:00 to 06:00"
 * means what the phone's clock says. `dayResetTime` is deliberately not
 * consulted: the iOS schedule that wakes the app is made of clock times, and
 * the monitor extension that raises and lifts the shield with the app closed
 * cannot read the setting, so a rule that depended on it would mean one thing
 * in the app and another in the extension. `activeAt` here and
 * `ScreenTimeShared.activeScheduleGroupIds` in Swift are the same rule written
 * twice; change them together.
 *
 * A window that ends at or before its start runs overnight and belongs to the
 * day it starts on: a Friday 22:00 to 06:00 window is still on at 02:00
 * Saturday, and Saturday is not one of its days.
 *
 * **Ending a block pauses one window, not the schedule.** `pausedUntil` is the
 * end of the window instance that was lifted (by a key tag or the emergency
 * button, `releaseBlocks.ts`), so the next one starts on time without anything
 * having to clear it.
 */

/** The settings row holding the schedules, as JSON. Device-local, like the groups they point at. */
export const BLOCK_SCHEDULES_SETTING = 'blockSchedules';

/**
 * iOS lets an app register about twenty monitored activities in all. A daytime
 * schedule takes one and an overnight one takes two, so eight leaves room.
 */
export const MAX_BLOCK_SCHEDULES = 8;
/** iOS refuses a monitored interval shorter than about a quarter of an hour. */
export const MIN_WINDOW_MINUTES = 15;
export const MAX_SCHEDULE_NAME_LENGTH = 24;

const MINUTES_PER_DAY = 24 * 60;

export interface BlockSchedule {
  id: string;
  name: string;
  /** The app group it blocks. A missing group resolves to Default (`appGroups.ts`). */
  groupId: string;
  /** Days the window starts on, 0 = Sunday. */
  days: number[];
  /** Minutes after midnight. */
  startMinutes: number;
  endMinutes: number;
  enabled: boolean;
  /** ISO end of the window instance a tag lifted; null when none is. */
  pausedUntil: string | null;
}

export const ALL_DAYS: readonly number[] = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

export function cleanScheduleName(raw: string, fallback = 'Schedule'): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_SCHEDULE_NAME_LENGTH) || fallback;
}

/** Minutes the window runs for; an end at or before the start wraps past midnight. */
export function windowLengthMinutes(startMinutes: number, endMinutes: number): number {
  return endMinutes > startMinutes ? endMinutes - startMinutes : MINUTES_PER_DAY - startMinutes + endMinutes;
}

export function isOvernight(s: Pick<BlockSchedule, 'startMinutes' | 'endMinutes'>): boolean {
  return s.endMinutes <= s.startMinutes;
}

/** Why a schedule can't be saved as it stands, or null when it can. */
export function scheduleProblem(s: Pick<BlockSchedule, 'days' | 'startMinutes' | 'endMinutes'>): string | null {
  if (s.days.length === 0) return 'Pick at least one day.';
  if (s.startMinutes === s.endMinutes) return 'The start and end times can’t be the same.';
  if (windowLengthMinutes(s.startMinutes, s.endMinutes) < MIN_WINDOW_MINUTES) {
    return 'A block has to last at least 15 minutes.';
  }
  return null;
}

function validMinutes(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < MINUTES_PER_DAY;
}

/** The schedules out of the settings row; malformed ones are dropped rather than thrown on. */
export function parseBlockSchedules(raw: string | null | undefined): BlockSchedule[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: BlockSchedule[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const o = item as Partial<BlockSchedule>;
    if (typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(o.id) || seen.has(o.id)) continue;
    if (!validMinutes(o.startMinutes) || !validMinutes(o.endMinutes)) continue;
    if (!Array.isArray(o.days)) continue;
    const days = [...new Set(o.days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
    const schedule: BlockSchedule = {
      id: o.id,
      name: cleanScheduleName(typeof o.name === 'string' ? o.name : ''),
      groupId: typeof o.groupId === 'string' ? o.groupId : 'default',
      days,
      startMinutes: o.startMinutes,
      endMinutes: o.endMinutes,
      enabled: o.enabled !== false,
      pausedUntil: typeof o.pausedUntil === 'string' ? o.pausedUntil : null,
    };
    if (scheduleProblem(schedule)) continue;
    seen.add(o.id);
    out.push(schedule);
  }
  return out.slice(0, MAX_BLOCK_SCHEDULES);
}

function atMinutes(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0);
}

function dayOffset(base: Date, offset: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
}

/** The start and end of the window covering `now`, ignoring enabled and paused, or null when none does. */
export function windowCovering(
  s: Pick<BlockSchedule, 'days' | 'startMinutes' | 'endMinutes'>,
  now: Date,
): { start: Date; end: Date } | null {
  const minute = now.getHours() * 60 + now.getMinutes();
  const today = dayOffset(now, 0);
  if (!isOvernight(s)) {
    if (!s.days.includes(now.getDay()) || minute < s.startMinutes || minute >= s.endMinutes) return null;
    return { start: atMinutes(today, s.startMinutes), end: atMinutes(today, s.endMinutes) };
  }
  if (s.days.includes(now.getDay()) && minute >= s.startMinutes) {
    return { start: atMinutes(today, s.startMinutes), end: atMinutes(dayOffset(now, 1), s.endMinutes) };
  }
  const yesterday = dayOffset(now, -1);
  if (s.days.includes(yesterday.getDay()) && minute < s.endMinutes) {
    return { start: atMinutes(yesterday, s.startMinutes), end: atMinutes(today, s.endMinutes) };
  }
  return null;
}

/** Whether the schedule is blocking at `now`: on, inside a window, and not lifted by a tag. */
export function isScheduleActive(s: BlockSchedule, now: Date): boolean {
  if (!s.enabled || !windowCovering(s, now)) return false;
  if (s.pausedUntil) {
    const until = new Date(s.pausedUntil).getTime();
    if (!Number.isNaN(until) && now.getTime() < until) return false;
  }
  return true;
}

export function activeSchedules(schedules: readonly BlockSchedule[], now: Date): BlockSchedule[] {
  return schedules.filter(s => isScheduleActive(s, now));
}

/** The end of the window `now` is in, for a schedule that would be blocking were it not paused. */
export function currentWindowEnd(s: BlockSchedule, now: Date): Date | null {
  if (!s.enabled) return null;
  return windowCovering(s, now)?.end ?? null;
}

/**
 * Lift every schedule blocking at `now` until its window ends. Returns the
 * schedules to store and how many were lifted.
 */
export function pauseActiveSchedules(
  schedules: readonly BlockSchedule[],
  now: Date,
): { schedules: BlockSchedule[]; paused: number } {
  let paused = 0;
  const next = schedules.map(s => {
    if (!isScheduleActive(s, now)) return s;
    const end = currentWindowEnd(s, now);
    if (!end) return s;
    paused += 1;
    return { ...s, pausedUntil: end.toISOString() };
  });
  return { schedules: next, paused };
}

/**
 * The next instant a schedule starts or ends after `now`, so a running app can
 * wait at it the way it waits at a penalty's end. Looks a week ahead; null when
 * no schedule is on.
 */
export function nextScheduleBoundary(schedules: readonly BlockSchedule[], now: Date): Date | null {
  let best: number | null = null;
  const consider = (d: Date) => {
    const t = d.getTime();
    if (t > now.getTime() && (best === null || t < best)) best = t;
  };
  for (const s of schedules) {
    if (!s.enabled) continue;
    for (let offset = -1; offset <= 7; offset += 1) {
      const day = dayOffset(now, offset);
      if (!s.days.includes(day.getDay())) continue;
      consider(atMinutes(day, s.startMinutes));
      consider(atMinutes(isOvernight(s) ? dayOffset(day, 1) : day, s.endMinutes));
    }
    if (s.pausedUntil) {
      const until = new Date(s.pausedUntil);
      if (!Number.isNaN(until.getTime())) consider(until);
    }
  }
  return best === null ? null : new Date(best);
}

/** What the native side is given: only enabled schedules, with the pause as an instant. */
export interface NativeScheduleWindow {
  id: string;
  name: string;
  groupId: string;
  days: number[];
  startMinutes: number;
  endMinutes: number;
  pausedUntilIso: string | null;
}

export function nativeScheduleWindows(
  schedules: readonly BlockSchedule[],
  resolveGroup: (groupId: string) => string,
): NativeScheduleWindow[] {
  return schedules.filter(s => s.enabled && !scheduleProblem(s)).map(s => ({
    id: s.id,
    name: s.name,
    groupId: resolveGroup(s.groupId),
    days: [...s.days],
    startMinutes: s.startMinutes,
    endMinutes: s.endMinutes,
    pausedUntilIso: s.pausedUntil,
  }));
}

const DAY_LETTERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Every day", "Weekdays", "Weekends" or the day names. */
export function describeDays(days: readonly number[]): string {
  const set = new Set(days);
  if (set.size === 7) return 'Every day';
  if (set.size === 5 && WEEKDAYS.every(d => set.has(d))) return 'Weekdays';
  if (set.size === 2 && set.has(0) && set.has(6)) return 'Weekends';
  return [...set].sort().map(d => DAY_LETTERS[d]).join(', ');
}

/** "10:00 PM" or "22:00", following the person's 12/24-hour setting. */
export function formatMinutes(minutes: number, use24Hour: boolean): string {
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, '0');
  if (use24Hour) return `${String(h).padStart(2, '0')}:${m}`;
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 === 0 ? 12 : h % 12}:${m} ${suffix}`;
}

export function describeWindow(s: Pick<BlockSchedule, 'startMinutes' | 'endMinutes'>, use24Hour: boolean): string {
  return `${formatMinutes(s.startMinutes, use24Hour)} to ${formatMinutes(s.endMinutes, use24Hour)}`;
}

