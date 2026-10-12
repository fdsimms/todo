import { dateToHHMM } from './clockTime';

/**
 * Sunrise and sunset, worked out on the device, and the time-window bounds that
 * follow them ("after sunset", "30 min before sunrise").
 *
 * **Computed, never fetched.** The forecast already carries sunrise/sunset, but
 * it lives only in memory, ships switched off, and is empty at a cold launch
 * (`useWeatherStore`), while a window gate runs in every list pass, in the
 * background refresh and in reminder scheduling. A visibility rule can't wait
 * for a request. So this is the NOAA sunrise equation over a saved coordinate
 * (`sunLocation` in settings): no network, no permission at read time, the same
 * answer with the app closed, and good to about a minute away from the poles.
 *
 * **An anchor resolves to an "HH:MM" for one logical day, and nothing
 * downstream knows it was ever a sun time.** Every window reader already takes
 * a clock string and a day start (see `onLogicalDay`), so `windowBounds` hands
 * them exactly that. The task's own `windowStart`/`windowEnd` keep the clock
 * time the anchor resolved to when it was set, which is what a reader that
 * isn't sun-aware (and an older build on another device) falls back to, and
 * what this answers with when it can't compute one: no location saved, or a
 * polar day or night when the sun doesn't cross the horizon at all.
 *
 * Deliberately store-free, like clockTime.ts: the caller passes the location,
 * so this stays testable in Jest's node environment and usable from the MCP
 * replica.
 */

export type SunEvent = 'sunrise' | 'sunset';

/** A window bound tied to the sun: the event, moved by a signed offset. */
export interface SunAnchor {
  event: SunEvent;
  /** Minutes after the event (negative for before), within ±SUN_OFFSET_LIMIT. */
  offsetMinutes: number;
}

/** Where sun times are worked out for. Stored rounded (see roundSunLocation). */
export interface SunLocation {
  latitude: number;
  longitude: number;
}

/**
 * How far either side of the event an anchor may sit. Three hours keeps an
 * evening anchor in the evening: further out and "sunset + 5 hr" crosses
 * midnight, where onLogicalDay's roll-over and the window's own end-after-start
 * rule start disagreeing about which night it means.
 */
export const SUN_OFFSET_LIMIT = 180;
/** The editor's stepper granularity. Any whole minute parses. */
export const SUN_OFFSET_STEP = 15;

const ANCHOR_PATTERN = /^(sunrise|sunset)(?:([+-])(\d{1,3}))?$/;

/** Reads a stored anchor ("sunset", "sunset-30", "sunrise+15"), or null. */
export function parseSunAnchor(text: string | null | undefined): SunAnchor | null {
  if (!text) return null;
  const m = ANCHOR_PATTERN.exec(text.trim());
  if (!m) return null;
  const magnitude = m[3] ? Number(m[3]) : 0;
  if (magnitude > SUN_OFFSET_LIMIT) return null;
  const offsetMinutes = m[2] === '-' ? -magnitude : magnitude;
  return { event: m[1] as SunEvent, offsetMinutes: offsetMinutes === 0 ? 0 : offsetMinutes };
}

/** The stored form of an anchor, the inverse of parseSunAnchor. */
export function formatSunAnchor(anchor: SunAnchor): string {
  const offset = clampSunOffset(anchor.offsetMinutes);
  if (offset === 0) return anchor.event;
  return `${anchor.event}${offset > 0 ? '+' : '-'}${Math.abs(offset)}`;
}

export function clampSunOffset(minutes: number): number {
  const whole = Math.round(minutes);
  return Math.max(-SUN_OFFSET_LIMIT, Math.min(SUN_OFFSET_LIMIT, whole));
}

/** "Sunset", "30 min before sunset", "1 hr 15 min after sunrise". */
export function describeSunAnchor(anchor: SunAnchor): string {
  const name = anchor.event === 'sunrise' ? 'sunrise' : 'sunset';
  if (anchor.offsetMinutes === 0) return name === 'sunrise' ? 'Sunrise' : 'Sunset';
  const side = anchor.offsetMinutes < 0 ? 'before' : 'after';
  return `${formatOffsetLength(Math.abs(anchor.offsetMinutes))} ${side} ${name}`;
}

/**
 * The compact form for a pill and the Time window row's summary: "Sunset",
 * "Sunset −30m", "Sunrise +1h 15m". The same h/m shape as a window's
 * countdown ("2h 15m left"), short enough that "3:00 PM–Sunset −30m" fits the
 * row beside its label.
 */
export function shortSunAnchor(anchor: SunAnchor): string {
  const name = anchor.event === 'sunrise' ? 'Sunrise' : 'Sunset';
  if (anchor.offsetMinutes === 0) return name;
  const sign = anchor.offsetMinutes < 0 ? '−' : '+';
  const minutes = Math.abs(anchor.offsetMinutes);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const length = h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
  return `${name} ${sign}${length}`;
}

/** The stepper's value text: "At sunset", "30 min before", "1 hr after". */
export function describeSunOffset(offsetMinutes: number, event: SunEvent): string {
  if (offsetMinutes === 0) return event === 'sunrise' ? 'At sunrise' : 'At sunset';
  return `${formatOffsetLength(Math.abs(offsetMinutes))} ${offsetMinutes < 0 ? 'before' : 'after'}`;
}

function formatOffsetLength(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

/**
 * A coordinate rounded to two decimal places, about a kilometer. Sunset moves
 * by a few seconds across that distance, so nothing more precise is worth
 * keeping, and this is a value that syncs.
 */
export function roundSunLocation(loc: SunLocation): SunLocation {
  return {
    latitude: Math.round(loc.latitude * 100) / 100,
    longitude: Math.round(loc.longitude * 100) / 100,
  };
}

/** Whether a value read back from storage is a usable coordinate. */
export function isSunLocation(value: unknown): value is SunLocation {
  if (!value || typeof value !== 'object') return false;
  const { latitude, longitude } = value as Record<string, unknown>;
  return typeof latitude === 'number' && typeof longitude === 'number'
    && Number.isFinite(latitude) && Number.isFinite(longitude)
    && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

/** Reads the stored `sunLocation` setting (JSON), or null for none or a bad value. */
export function parseSunLocation(text: string | null | undefined): SunLocation | null {
  if (!text) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isSunLocation(value) ? value : null;
  } catch {
    return null;
  }
}

// ==== the sunrise equation ====

const DEG = Math.PI / 180;
const J2000 = 2451545.0;
const UNIX_EPOCH_JD = 2440587.5;
const MS_PER_DAY = 86400000;

export interface SolarEvents {
  /** Null on a day the sun doesn't rise or doesn't set (polar night or day). */
  sunrise: Date | null;
  sunset: Date | null;
}

/**
 * Sunrise and sunset on a calendar date at a place, as real instants. The date
 * is read from `year`/`month` (0-based)/`day`, not from an instant, so the
 * caller decides which calendar day it means (see sunEventsForDay).
 *
 * The NOAA/Wikipedia "sunrise equation": solar noon from the mean anomaly and
 * the equation of centre, the hour angle at which the sun's centre sits 0.833°
 * below the horizon (refraction plus the solar disc's radius). Accurate to
 * about a minute outside the polar circles, which is the precision a window
 * bound is shown at.
 */
export function solarEvents(year: number, month: number, day: number, loc: SunLocation): SolarEvents {
  // Days since J2000 at noon UTC on the date, which the equation then moves to
  // the place's own solar noon by its longitude.
  const noonUtcJd = Date.UTC(year, month, day, 12) / MS_PER_DAY + UNIX_EPOCH_JD;
  const n = Math.round(noonUtcJd - J2000 + 0.0008);
  const meanNoon = n - loc.longitude / 360;
  const M = mod360(357.5291 + 0.98560028 * meanNoon);
  const C = 1.9148 * Math.sin(M * DEG) + 0.02 * Math.sin(2 * M * DEG) + 0.0003 * Math.sin(3 * M * DEG);
  const lambda = mod360(M + C + 180 + 102.9372);
  const transit = J2000 + meanNoon + 0.0053 * Math.sin(M * DEG) - 0.0069 * Math.sin(2 * lambda * DEG);
  const sinDecl = Math.sin(lambda * DEG) * Math.sin(23.4397 * DEG);
  const cosDecl = Math.cos(Math.asin(sinDecl));
  const phi = loc.latitude * DEG;
  const cosHourAngle = (Math.sin(-0.833 * DEG) - Math.sin(phi) * sinDecl) / (Math.cos(phi) * cosDecl);
  if (!Number.isFinite(cosHourAngle) || cosHourAngle > 1 || cosHourAngle < -1) {
    return { sunrise: null, sunset: null };
  }
  const halfDay = Math.acos(cosHourAngle) / DEG / 360;
  return {
    sunrise: julianToDate(transit - halfDay),
    sunset: julianToDate(transit + halfDay),
  };
}

function mod360(x: number): number {
  return ((x % 360) + 360) % 360;
}

function julianToDate(jd: number): Date {
  return new Date(Math.round((jd - UNIX_EPOCH_JD) * MS_PER_DAY));
}

// Every list pass asks this once per anchored task per day, and the answer
// only changes with the date or the place. A handful of entries covers today,
// the days Later is showing and the day a task's window closed on.
const cache = new Map<string, SolarEvents>();
const CACHE_LIMIT = 64;

/**
 * Sunrise and sunset for the logical day that starts at `dayStart`, meaning the
 * calendar date that day start falls on in the device's own time zone.
 */
export function sunEventsForDay(dayStart: Date, loc: SunLocation): SolarEvents {
  const y = dayStart.getFullYear();
  const mo = dayStart.getMonth();
  const d = dayStart.getDate();
  const key = `${y}-${mo}-${d}|${loc.latitude}|${loc.longitude}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const events = solarEvents(y, mo, d, loc);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, events);
  return events;
}

/**
 * The instant an anchor resolves to on the logical day starting at `dayStart`,
 * or null when it can't be worked out (no location, or no such event that day).
 */
export function sunAnchorInstant(
  anchor: SunAnchor,
  dayStart: Date,
  loc: SunLocation | null,
): Date | null {
  if (!loc) return null;
  const events = sunEventsForDay(dayStart, loc);
  const at = anchor.event === 'sunrise' ? events.sunrise : events.sunset;
  if (!at) return null;
  return new Date(at.getTime() + anchor.offsetMinutes * 60000);
}

/**
 * The "HH:MM" a stored anchor resolves to on that day, rounded to the minute,
 * or null when it can't be resolved. Rounded rather than truncated so a sunset
 * at 18:31:40 reads as 18:32, the minute it's nearest to.
 */
export function sunAnchorHHMM(
  text: string | null | undefined,
  dayStart: Date,
  loc: SunLocation | null,
): string | null {
  const anchor = parseSunAnchor(text);
  if (!anchor) return null;
  const at = sunAnchorInstant(anchor, dayStart, loc);
  if (!at) return null;
  return dateToHHMM(new Date(Math.round(at.getTime() / 60000) * 60000));
}

/** The four fields a window is made of, so callers can pass a Task or a draft. */
export interface WindowFields {
  windowStart: string | null;
  windowEnd: string | null;
  windowStartSun?: string | null;
  windowEndSun?: string | null;
}

/**
 * A task's window as clock times on one logical day: each bound's sun anchor
 * resolved for that day where it has one and it can be worked out, else the
 * stored clock time. The one place a window reader turns an anchor into the
 * "HH:MM" it already knows how to place.
 */
export function windowBounds(
  task: WindowFields,
  dayStart: Date,
  loc: SunLocation | null,
): { start: string | null; end: string | null } {
  return {
    start: sunAnchorHHMM(task.windowStartSun, dayStart, loc) ?? task.windowStart,
    end: sunAnchorHHMM(task.windowEndSun, dayStart, loc) ?? task.windowEnd,
  };
}

/** Whether either bound of a window follows the sun. */
export function hasSunAnchor(task: Pick<WindowFields, 'windowStartSun' | 'windowEndSun'>): boolean {
  return parseSunAnchor(task.windowStartSun) !== null || parseSunAnchor(task.windowEndSun) !== null;
}
