/**
 * How short a night has to be before "Lighten today" says Apple Health
 * recorded one, and whether it says so at all.
 *
 * Minutes rather than hours so the stepper stays on whole numbers (the sleep
 * goal does the same). The default is the 6 hours the note used before this was
 * a setting, so an install that never opens the row reads exactly as it did.
 */

export const SHORT_NIGHT_MINUTES_MIN = 180;
export const SHORT_NIGHT_MINUTES_MAX = 540;
export const SHORT_NIGHT_MINUTES_STEP = 30;
export const SHORT_NIGHT_MINUTES_DEFAULT = 360;

/** Snaps to the step and clamps to the range. */
export function clampShortNightMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return SHORT_NIGHT_MINUTES_DEFAULT;
  const snapped = Math.round(minutes / SHORT_NIGHT_MINUTES_STEP) * SHORT_NIGHT_MINUTES_STEP;
  return Math.min(SHORT_NIGHT_MINUTES_MAX, Math.max(SHORT_NIGHT_MINUTES_MIN, snapped));
}

/** Reads the stored value: empty or unreadable is the default, not zero. */
export function parseShortNightMinutes(raw: string | null | undefined): number {
  if (!raw) return SHORT_NIGHT_MINUTES_DEFAULT;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? clampShortNightMinutes(n) : SHORT_NIGHT_MINUTES_DEFAULT;
}
