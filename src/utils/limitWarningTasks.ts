import type { NutrientKey } from '../types';
import { NUTRIENT_LABEL } from './foodNutrition';
import { activeLimits, limitStatus, type LimitStatus, type NutritionTargets } from './nutritionTargets';

/**
 * A task the first time a day's food log gets close to a Stay under limit:
 * "Sat fat at 12 of 16g today".
 *
 * **Read from the food log, not from Apple Health.** A Health rule can watch
 * saturated fat too, but only once the log has been written to Health, and its
 * threshold is a second number to keep in step with the target by hand. This
 * reads the same totals the Food log shows and measures them against the limit
 * the person set there, at the one "close" share (`limitWarnPercent`) the Food
 * log's orange bar and Today's row already use.
 *
 * One task per limit per day, keyed `<dayKey>:<nutrient>`. Its title follows
 * the total as more is logged, so the task that said "12 of 16g" says "19 of
 * 16g" once the day is past it, rather than a second task appearing. Ticking it
 * off ends it for the day; deleting it declines every limit warning for the
 * rest of that day. Pure: the store pass (`reconcileLimitWarnings`) does the
 * dating and the writing.
 */

/** One limit the day has come close to or passed. */
export interface LimitWarning {
  key: NutrientKey;
  total: number;
  target: number;
  status: Exclude<LimitStatus, 'within'>;
}

/** The limits today's totals are close to or past, in label order. */
export function limitWarningsFor(
  totals: Partial<Record<NutrientKey, number>>,
  targets: NutritionTargets,
  limits: readonly NutrientKey[],
  warnPercent: number,
): LimitWarning[] {
  const out: LimitWarning[] = [];
  for (const key of activeLimits(targets, limits)) {
    const total = totals[key];
    // Nothing logged that states it is not a day close to it.
    if (total === undefined || total <= 0) continue;
    const status = limitStatus(key, total, targets, warnPercent);
    if (status === 'within') continue;
    out.push({ key, total, target: targets[key]!, status });
  }
  return out;
}

export function limitWarningSourceId(dayKey: string, key: NutrientKey): string {
  return `${dayKey}:${key}`;
}

/** The nutrient a source id names, or null for one this build can't read. */
export function limitWarningKeyOf(sourceId: string | null | undefined): string | null {
  if (!sourceId) return null;
  const at = sourceId.lastIndexOf(':');
  return at < 0 ? null : sourceId.slice(at + 1);
}

/** The day a source id names. */
export function limitWarningDayOf(sourceId: string | null | undefined): string | null {
  if (!sourceId) return null;
  const at = sourceId.lastIndexOf(':');
  return at < 0 ? null : sourceId.slice(0, at);
}

/** "Saturated fat at 12 of 16g today", or "…, over the limit" past it. */
export function limitWarningTitle(warning: LimitWarning): string {
  const unit = NUTRIENT_LABEL[warning.key].unit;
  const suffix = unit === 'cal' ? ' cal' : unit;
  const rounded = Math.round(warning.total * 10) / 10;
  const base = `${NUTRIENT_LABEL[warning.key].label} at ${rounded.toLocaleString('en-US')} of ${warning.target.toLocaleString('en-US')}${suffix} today`;
  return warning.status === 'over' ? `${base}, over the limit` : base;
}

export const LIMIT_WARNING_NOTES =
  'From the food log so far today, against the Stay under limit set in Nutrition. If you have eaten without logging it, the total is higher than this.';
