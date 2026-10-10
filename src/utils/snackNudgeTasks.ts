import type { FoodLogEntry } from '../types';
import { foodLogTotals } from './foodLog';

/**
 * `snackNudge`: a one-off task, once the afternoon has started, suggesting a
 * snack when today's food log is well short of the calorie target.
 *
 * See `docs/arch/generated-tasks.md` for the mechanism it shares. What is worth
 * reading here is what the task is allowed to claim.
 *
 * **It reads the food log, so it can only say what was logged.** A day nobody
 * logged is not a day of nothing (`nutritionStats.ts`), and a task telling
 * somebody who skipped logging lunch to eat more is wrong in the one way this
 * app avoids. So it needs at least one entry that states calories, and the
 * title names the figure it judged by ("620 of 2,000 kcal logged"), which lets
 * the person see at a glance that the log, not their body, is what fell short.
 *
 * **Only a calorie figure that was stated counts.** `foodLogTotals` keeps an
 * absent figure absent; an entry with no calories is not an entry of zero, so
 * a day of entries that state none is treated as nothing to judge.
 *
 * **One a day, day-keyed with no source row**, `waterShortfall`'s position: a
 * completed or deleted one blocks the next that day (`blocksOnFinished`,
 * `snackNudgeDeclinedDayKey`). Logging the snack takes the task away again,
 * because the pass re-judges on every food log write.
 */

/**
 * The hour (local clock) from which the nudge may appear, and the range the
 * setting allows. Noon to 8 PM: earlier is a nudge before lunch has had its
 * chance, later leaves no afternoon to act on it.
 */
export const DEFAULT_SNACK_NUDGE_FROM_HOUR = 15;
export const SNACK_NUDGE_FROM_HOUR_MIN = 12;
export const SNACK_NUDGE_FROM_HOUR_MAX = 20;

/**
 * Below this percentage of the target, the day reads as short. The default is
 * half: past 3 PM someone who has had most of the day's calories needs no
 * prompt, and half is where the evening meal can no longer be expected to
 * close the gap alone.
 */
export const DEFAULT_SNACK_NUDGE_SHARE_PERCENT = 50;
export const SNACK_NUDGE_SHARE_PERCENT_MIN = 10;
export const SNACK_NUDGE_SHARE_PERCENT_MAX = 90;
export const SNACK_NUDGE_SHARE_PERCENT_STEP = 10;

export function clampSnackNudgeFromHour(hour: number): number {
  if (!Number.isFinite(hour)) return DEFAULT_SNACK_NUDGE_FROM_HOUR;
  return Math.min(SNACK_NUDGE_FROM_HOUR_MAX, Math.max(SNACK_NUDGE_FROM_HOUR_MIN, Math.round(hour)));
}

export function clampSnackNudgeSharePercent(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_SNACK_NUDGE_SHARE_PERCENT;
  const step = SNACK_NUDGE_SHARE_PERCENT_STEP;
  const snapped = Math.round(percent / step) * step;
  return Math.min(SNACK_NUDGE_SHARE_PERCENT_MAX, Math.max(SNACK_NUDGE_SHARE_PERCENT_MIN, snapped));
}

/** An hour of the day as the clock reads it: 15 is "3 PM". */
export function describeSnackNudgeHour(hour: number): string {
  const h = clampSnackNudgeFromHour(hour);
  if (h === 12) return '12 PM';
  return h > 12 ? `${h - 12} PM` : `${h} AM`;
}

/** Why the task exists, in the plain terms the rest of the app uses. */
export const SNACK_NUDGE_NOTES =
  'Based on the calories in today’s food log. Dismiss it if you ate without logging.';

/** A calorie figure with a thousands separator. */
function kcal(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** The title, naming the figures it judged by. */
export function snackNudgeTitle(loggedKcal: number, targetKcal: number): string {
  return `Have a snack (${kcal(loggedKcal)} of ${kcal(targetKcal)} kcal logged)`;
}

/**
 * Today's logged calories, or null when the log can't speak to it: no entries,
 * or none stating a calorie figure.
 */
export function loggedKcalToday(entries: readonly FoodLogEntry[]): number | null {
  const totals = foodLogTotals(entries);
  if (totals.entries === 0) return null;
  if ((totals.reported.calorieKcal ?? 0) === 0) return null;
  return totals.total.calorieKcal ?? null;
}

/**
 * Whether the day is short enough to ask. False on no target or no usable log,
 * which is "nothing to judge" rather than "not short".
 */
export function snackNudgeApplies(
  loggedKcal: number | null,
  targetKcal: number | undefined,
  now: Date,
  fromHour: number = DEFAULT_SNACK_NUDGE_FROM_HOUR,
  sharePercent: number = DEFAULT_SNACK_NUDGE_SHARE_PERCENT,
): boolean {
  if (loggedKcal === null) return false;
  if (targetKcal === undefined || !(targetKcal > 0)) return false;
  if (now.getHours() < clampSnackNudgeFromHour(fromHour)) return false;
  return loggedKcal < targetKcal * (clampSnackNudgeSharePercent(sharePercent) / 100);
}
