import type { FocusPlanOptions } from './focusPlan';

/**
 * The focus session settings: their defaults, their bounds, and how they're
 * read back out of the settings table.
 *
 * Separate from `focusPlan.ts` so the plan builder stays a pure function of
 * options it's handed, and separate from the store so the Settings rows and
 * the parsers agree on one set of bounds instead of two. Same split
 * `postpone.ts` and `nudgeCadence.ts` already use.
 *
 * **The defaults are a classic pomodoro and that's deliberate.** 25 minutes of
 * work, a 5 minute break, 15 minutes every fourth break. The "break after N
 * tasks" trigger ships off, because with it on at 1 a queue of three short
 * tasks becomes three breaks in twenty minutes — the count trigger is there
 * for someone who works in whole tasks rather than in blocks, and that's a
 * choice to make rather than a default to inherit.
 */

export const FOCUS_WORK_CAP_MIN = 5;
export const FOCUS_WORK_CAP_MAX = 120;
export const FOCUS_REST_MIN = 1;
export const FOCUS_REST_MAX = 60;
export const FOCUS_REST_AFTER_TASKS_MAX = 10;
export const FOCUS_REST_AFTER_MINUTES_MIN = 5;
export const FOCUS_REST_AFTER_MINUTES_MAX = 120;
export const FOCUS_LONG_REST_EVERY_MIN = 2;
export const FOCUS_LONG_REST_EVERY_MAX = 10;

export const FOCUS_DEFAULTS = {
  workCapMinutes: 25,
  defaultWorkMinutes: 25,
  restAfterTasks: null as number | null,
  restAfterMinutes: 25 as number | null,
  restMinutes: 5,
  longRestEvery: 4 as number | null,
  longRestMinutes: 15,
} as const;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Read a stored whole number back, falling through to `fallback`. */
function parseCount(raw: string | null | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw);
  if (raw == null || raw === '' || !Number.isFinite(parsed)) return fallback;
  return clamp(Math.round(parsed), min, max);
}

/**
 * Read a stored optional whole number back. `''` is the stored form of "off",
 * matching `completedRetentionDays` and `vacationEnd` — the settings table is
 * all TEXT, so a null needs a spelling.
 */
function parseOptionalCount(
  raw: string | null | undefined,
  fallback: number | null,
  min: number,
  max: number,
): number | null {
  if (raw === '') return null;
  if (raw == null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  // A stored 0 is how an older write spelled "off"; both read back as null so
  // there's one representation past this point (see ruleOff in focusPlan).
  if (rounded <= 0) return null;
  return clamp(rounded, min, max);
}

export const parseFocusWorkCapMinutes = (raw: string | null | undefined): number =>
  parseCount(raw, FOCUS_DEFAULTS.workCapMinutes, FOCUS_WORK_CAP_MIN, FOCUS_WORK_CAP_MAX);

export const parseFocusDefaultWorkMinutes = (raw: string | null | undefined): number =>
  parseCount(raw, FOCUS_DEFAULTS.defaultWorkMinutes, FOCUS_WORK_CAP_MIN, FOCUS_WORK_CAP_MAX);

export const parseFocusRestMinutes = (raw: string | null | undefined): number =>
  parseCount(raw, FOCUS_DEFAULTS.restMinutes, FOCUS_REST_MIN, FOCUS_REST_MAX);

export const parseFocusLongRestMinutes = (raw: string | null | undefined): number =>
  parseCount(raw, FOCUS_DEFAULTS.longRestMinutes, FOCUS_REST_MIN, FOCUS_REST_MAX);

export const parseFocusRestAfterTasks = (raw: string | null | undefined): number | null =>
  parseOptionalCount(raw, FOCUS_DEFAULTS.restAfterTasks, 1, FOCUS_REST_AFTER_TASKS_MAX);

export const parseFocusRestAfterMinutes = (raw: string | null | undefined): number | null =>
  parseOptionalCount(
    raw,
    FOCUS_DEFAULTS.restAfterMinutes,
    FOCUS_REST_AFTER_MINUTES_MIN,
    FOCUS_REST_AFTER_MINUTES_MAX,
  );

export const parseFocusLongRestEvery = (raw: string | null | undefined): number | null =>
  parseOptionalCount(
    raw,
    FOCUS_DEFAULTS.longRestEvery,
    FOCUS_LONG_REST_EVERY_MIN,
    FOCUS_LONG_REST_EVERY_MAX,
  );

/** How an optional count is written back. `''` is off. */
export const serializeOptionalCount = (value: number | null): string =>
  value == null ? '' : String(value);

/** The focus fields of the settings store, under their store names. */
export interface FocusSettingsSource {
  focusWorkCapMinutes: number;
  focusDefaultWorkMinutes: number;
  focusRestAfterTasks: number | null;
  focusRestAfterMinutes: number | null;
  focusRestMinutes: number;
  focusLongRestEvery: number | null;
  focusLongRestMinutes: number;
}

/**
 * Narrow the settings store down to the plan builder's options.
 *
 * One place doing the rename rather than seven property reads at every call
 * site, so a field added here reaches the builder, the setup sheet's preview
 * and the Settings copy together.
 */
export function focusPlanOptionsFrom(settings: FocusSettingsSource): FocusPlanOptions {
  return {
    workCapMinutes: settings.focusWorkCapMinutes,
    defaultWorkMinutes: settings.focusDefaultWorkMinutes,
    restAfterTasks: settings.focusRestAfterTasks,
    restAfterMinutes: settings.focusRestAfterMinutes,
    restMinutes: settings.focusRestMinutes,
    longRestEvery: settings.focusLongRestEvery,
    longRestMinutes: settings.focusLongRestMinutes,
  };
}

/** True when neither rest trigger is on, so the plan will hold no breaks. */
export function focusRestsDisabled(
  settings: Pick<FocusSettingsSource, 'focusRestAfterTasks' | 'focusRestAfterMinutes'>,
): boolean {
  const tasksOff = settings.focusRestAfterTasks == null || settings.focusRestAfterTasks <= 0;
  const minutesOff = settings.focusRestAfterMinutes == null || settings.focusRestAfterMinutes <= 0;
  return tasksOff && minutesOff;
}
