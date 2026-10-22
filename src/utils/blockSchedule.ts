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
 * **All day is a window from midnight to midnight (00:00 to 00:00), not a flag.**
 * Equal times are otherwise refused, and 00:00 to 00:00 is the one pair that
 * means something: it is the overnight rule at its limit, a window that starts
 * at the day's first minute and ends at the next day's. So the covering rules
 * here and in Swift need no case of their own, and nothing can disagree about
 * whether a schedule is all day (`isAllDay`). Only the arming differs
 * (`setBlockSchedules`), since iOS wants the interval to end at 23:59:59.
 *
 * **An allow window is the same rule read the other way round** (`allowWindow`):
 * the times are when the apps are free and everything else is blocked. It is
 * expanded here into blocking windows (`blockingWindows`) before the native
 * side sees it, so `windowCovers` in Swift needs no case of its own.
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
/** Group ids become file names, so nothing else is accepted (the same pattern `appGroups.ts` holds). */
const GROUP_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * The group list out of a stored `groupIds`, else the legacy single `groupId`,
 * else Default. De-duplicated, in the order given, malformed ids dropped.
 */
export function readGroupIds(groupIds: unknown, legacyGroupId: unknown): string[] {
  const listed = Array.isArray(groupIds)
    ? groupIds.filter((g): g is string => typeof g === 'string' && GROUP_ID_PATTERN.test(g))
    : [];
  const ids = listed.length > 0
    ? listed
    : [typeof legacyGroupId === 'string' && GROUP_ID_PATTERN.test(legacyGroupId) ? legacyGroupId : 'default'];
  return [...new Set(ids)];
}

const MINUTES_PER_DAY = 24 * 60;

export interface BlockSchedule {
  id: string;
  name: string;
  /**
   * The app groups it blocks, at least one. A missing group resolves to Default
   * (`appGroups.ts`). Stored beside a legacy `groupId` holding the first, so a
   * device on an older build still blocks that one (`serializeBlockSchedules`).
   */
  groupIds: string[];
  /** Days the window starts on, 0 = Sunday. */
  days: number[];
  /** Minutes after midnight. */
  startMinutes: number;
  endMinutes: number;
  enabled: boolean;
  /** ISO end of the window instance a tag lifted; null when none is. */
  pausedUntil: string | null;
  /**
   * Reads the window as when the apps are *allowed*: they are blocked at every
   * other time, including the whole of a day that isn't in `days`. See
   * `blockedArcs`. Absent means a plain blocking window.
   */
  allowWindow?: boolean;
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

/** Whether a window covers each of its days from midnight to midnight. */
export function isAllDay(s: Pick<BlockSchedule, 'startMinutes' | 'endMinutes'>): boolean {
  return s.startMinutes === 0 && s.endMinutes === 0;
}

/** Why a schedule can't be saved as it stands, or null when it can. */
export function scheduleProblem(s: Pick<BlockSchedule, 'days' | 'startMinutes' | 'endMinutes' | 'allowWindow'> & { groupIds?: readonly string[] }): string | null {
  if (s.groupIds !== undefined && s.groupIds.length === 0) return 'Pick at least one group of apps.';
  if (s.days.length === 0) return 'Pick at least one day.';
  if (!isAllDay(s)) {
    if (s.startMinutes === s.endMinutes) return 'The start and end times can’t be the same.';
    if (windowLengthMinutes(s.startMinutes, s.endMinutes) < MIN_WINDOW_MINUTES) {
      return s.allowWindow ? 'An allowed window has to last at least 15 minutes.' : 'A block has to last at least 15 minutes.';
    }
  }
  if (s.allowWindow) {
    const arcs = blockedArcs(s);
    if (arcs.length === 0) return 'This allows every hour of every day, so nothing would be blocked.';
    if (arcs.some(a => a.length < MIN_WINDOW_MINUTES)) return 'The apps would be blocked for less than 15 minutes at a time.';
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
      groupIds: readGroupIds((o as { groupIds?: unknown }).groupIds, (o as { groupId?: unknown }).groupId),
      days,
      startMinutes: o.startMinutes,
      endMinutes: o.endMinutes,
      enabled: o.enabled !== false,
      pausedUntil: typeof o.pausedUntil === 'string' ? o.pausedUntil : null,
      ...(o.allowWindow === true ? { allowWindow: true } : {}),
    };
    if (scheduleProblem(schedule)) continue;
    seen.add(o.id);
    out.push(schedule);
  }
  return out.slice(0, MAX_BLOCK_SCHEDULES);
}

/** The schedules as stored: each carries `groupId` (the first group) for a build that predates `groupIds`. */
export function serializeBlockSchedules(schedules: readonly BlockSchedule[]): string {
  return JSON.stringify(schedules.map(s => ({ ...s, groupId: s.groupIds[0] })));
}

function atMinutes(day: Date, minutes: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0);
}

function dayOffset(base: Date, offset: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
}

const WEEK_MINUTES = 7 * MINUTES_PER_DAY;

/** A minute of the week (0 = Sunday 00:00, may fall outside 0..WEEK_MINUTES) as a date, counted from `weekStart`. */
function atWeekMinute(weekStart: Date, weekMinute: number): Date {
  const dayShift = Math.floor(weekMinute / MINUTES_PER_DAY);
  const minutes = weekMinute - dayShift * MINUTES_PER_DAY;
  return new Date(
    weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + dayShift,
    Math.floor(minutes / 60), minutes % 60, 0, 0,
  );
}

/**
 * The stretches an allow window blocks: every run of the week outside its
 * allowed times, as a start minute of the week and a length, circular (a run
 * may begin Friday night and end Monday morning). Empty when the allowed times
 * cover the whole week, and when no day is picked.
 *
 * Worked out minute by minute rather than by interval arithmetic, because the
 * allowed windows can overlap each other round the week's edge (a Sunday night
 * window running into Monday) and the complement of that is easiest to get
 * right when it is just the minutes nothing claims.
 */
export function blockedArcs(s: Pick<BlockSchedule, 'days' | 'startMinutes' | 'endMinutes'>): { start: number; length: number }[] {
  const allowed = new Uint8Array(WEEK_MINUTES);
  const length = isAllDay(s) ? MINUTES_PER_DAY : windowLengthMinutes(s.startMinutes, s.endMinutes);
  for (const day of s.days) {
    const from = day * MINUTES_PER_DAY + s.startMinutes;
    for (let i = 0; i < length; i += 1) allowed[(from + i) % WEEK_MINUTES] = 1;
  }
  const first = allowed.indexOf(1);
  if (first < 0) return [];
  const arcs: { start: number; length: number }[] = [];
  let runStart = -1;
  let runLength = 0;
  // From just after an allowed minute round to that minute again, so a run
  // that wraps the week's end is one run and the last one is always closed.
  for (let k = 1; k <= WEEK_MINUTES; k += 1) {
    const pos = (first + k) % WEEK_MINUTES;
    if (!allowed[pos]) {
      if (runStart < 0) { runStart = pos; runLength = 0; }
      runLength += 1;
    } else if (runStart >= 0) {
      arcs.push({ start: runStart, length: runLength });
      runStart = -1;
    }
  }
  return arcs.sort((a, b) => a.start - b.start);
}

/**
 * What the native side is handed for a schedule: a plain window as itself, an
 * allow window as the blocking windows its blocked arcs come to. A window is a
 * set of days with a time range that belongs to the day it starts on, and
 * holds at most a day, so an arc is cut at each midnight, and the two halves of
 * a night are put back together as one overnight window when they fit. Windows
 * with the same times share one entry across their days.
 */
export function blockingWindows(
  s: Pick<BlockSchedule, 'id' | 'days' | 'startMinutes' | 'endMinutes' | 'allowWindow'>,
): { id: string; days: number[]; startMinutes: number; endMinutes: number }[] {
  if (!s.allowWindow) return [{ id: s.id, days: [...s.days], startMinutes: s.startMinutes, endMinutes: s.endMinutes }];
  const byTimes = new Map<string, { days: Set<number>; startMinutes: number; endMinutes: number }>();
  const add = (day: number, startMinutes: number, endMinutes: number) => {
    const key = `${startMinutes}-${endMinutes}`;
    const entry = byTimes.get(key) ?? { days: new Set<number>(), startMinutes, endMinutes };
    entry.days.add(day);
    byTimes.set(key, entry);
  };
  for (const arc of blockedArcs(s)) {
    const pieces: { day: number; from: number; to: number }[] = [];
    let at = arc.start;
    let left = arc.length;
    while (left > 0) {
      const from = at % MINUTES_PER_DAY;
      const take = Math.min(left, MINUTES_PER_DAY - from);
      pieces.push({ day: Math.floor(at / MINUTES_PER_DAY) % 7, from, to: from + take });
      at = (at + take) % WEEK_MINUTES;
      left -= take;
    }
    const [head, tail] = pieces;
    if (pieces.length === 2 && head.to === MINUTES_PER_DAY && tail.from === 0 && tail.to < head.from) {
      add(head.day, head.from, tail.to);
      continue;
    }
    // A piece that runs to midnight ends at 00:00, the overnight form's way of
    // saying so (and 00:00 to 00:00 is a whole day).
    for (const p of pieces) add(p.day, p.from, p.to === MINUTES_PER_DAY ? 0 : p.to);
  }
  return [...byTimes.values()].map((w, i) => ({
    id: `${s.id}_${i}`,
    days: [...w.days].sort(),
    startMinutes: w.startMinutes,
    endMinutes: w.endMinutes,
  }));
}

/**
 * iOS lets an app register about twenty monitored activities in all, and an
 * allow window can need several windows where a block needs one.
 */
export const MAX_ARMED_ACTIVITIES = 20;
export const ARMED_ACTIVITIES_MESSAGE = 'That needs more separate blocks than iOS allows an app to schedule. Pick fewer days or fewer schedules.';

/**
 * How many iOS activities a set of schedules arms. A window takes one, an
 * overnight one two, except one ending at midnight, whose second half would be
 * empty and is not armed. Counts switched-off schedules too, so switching one
 * on can't push the total over.
 */
export function armedActivityCount(schedules: readonly Pick<BlockSchedule, 'id' | 'days' | 'startMinutes' | 'endMinutes' | 'allowWindow'>[]): number {
  let total = 0;
  for (const s of schedules) {
    for (const w of blockingWindows(s)) {
      total += w.endMinutes <= w.startMinutes && w.endMinutes > 0 ? 2 : 1;
    }
  }
  return total;
}

/** The start and end of the window covering `now`, ignoring enabled and paused, or null when none does. */
export function windowCovering(
  s: Pick<BlockSchedule, 'days' | 'startMinutes' | 'endMinutes' | 'allowWindow'>,
  now: Date,
): { start: Date; end: Date } | null {
  if (s.allowWindow) {
    // The whole blocked stretch, not the night's own window: a tag lifts the
    // block until the allowed time returns, not until the next midnight.
    const weekStart = dayOffset(now, -now.getDay());
    const weekMinute = now.getDay() * MINUTES_PER_DAY + now.getHours() * 60 + now.getMinutes();
    for (const arc of blockedArcs(s)) {
      if ((weekMinute - arc.start + WEEK_MINUTES) % WEEK_MINUTES >= arc.length) continue;
      const start = arc.start > weekMinute ? arc.start - WEEK_MINUTES : arc.start;
      return { start: atWeekMinute(weekStart, start), end: atWeekMinute(weekStart, start + arc.length) };
    }
    return null;
  }
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
    if (s.allowWindow) {
      const weekStart = dayOffset(now, -now.getDay());
      for (const arc of blockedArcs(s)) {
        for (const week of [-1, 0, 1]) {
          consider(atWeekMinute(weekStart, arc.start + week * WEEK_MINUTES));
          consider(atWeekMinute(weekStart, arc.start + arc.length + week * WEEK_MINUTES));
        }
      }
    }
    for (let offset = -1; !s.allowWindow && offset <= 7; offset += 1) {
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
  /** The first group, for a native build that predates `groupIds`. */
  groupId: string;
  groupIds: string[];
  days: number[];
  startMinutes: number;
  endMinutes: number;
  pausedUntilIso: string | null;
}

/**
 * A resolver from a stored group id to the plain group(s) it blocks: one id for
 * a group, several for a supergroup (`expandGroupId`).
 */
export type GroupResolver = (groupId: string) => string | readonly string[];

/** A group list resolved through `resolveGroup`, de-duplicated, with the legacy first-group field beside it. */
export function resolvedGroups(
  groupIds: readonly string[],
  resolveGroup: GroupResolver,
): { groupId: string; groupIds: string[] } {
  const resolved = [...new Set(groupIds.flatMap(id => resolveGroup(id)))];
  return { groupId: resolved[0], groupIds: resolved };
}

export function nativeScheduleWindows(
  schedules: readonly BlockSchedule[],
  resolveGroup: GroupResolver,
): NativeScheduleWindow[] {
  return schedules.filter(s => s.enabled && !scheduleProblem(s)).flatMap(s => blockingWindows(s).map(w => ({
    id: w.id,
    name: s.name,
    ...resolvedGroups(s.groupIds, resolveGroup),
    days: w.days,
    startMinutes: w.startMinutes,
    endMinutes: w.endMinutes,
    pausedUntilIso: s.pausedUntil,
  })));
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

export function describeWindow(s: Pick<BlockSchedule, 'startMinutes' | 'endMinutes' | 'allowWindow'>, use24Hour: boolean): string {
  if (isAllDay(s)) return s.allowWindow ? 'Allowed all day' : 'All day';
  const span = `${formatMinutes(s.startMinutes, use24Hour)} to ${formatMinutes(s.endMinutes, use24Hour)}`;
  return s.allowWindow ? `Allowed ${span}` : span;
}

