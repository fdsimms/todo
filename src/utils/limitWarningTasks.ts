import type { FoodLogEntry, NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';
import { NUTRIENT_LABEL } from './foodNutrition';
import { LIMIT_ROW_NAME, activeLimits, describeLimit, limitStatus, type LimitStatus, type NutritionTargets } from './nutritionTargets';

/**
 * A "don't do" task per Stay under limit: "Stay under 35g sugar · 28g so far".
 *
 * **A negative task (`Task.polarity`), because a limit is a commitment not to
 * do something.** It sits on Today all day as the reminder, it is never
 * checked off, and its streak counts clean days, which for a limit is exactly
 * "days within it". One per limit, keyed by the nutrient rather than by the
 * day, so the streak lives on one row for as long as the limit does. Like the
 * avoid-tasks a person makes by hand, it has no date and no recurrence.
 *
 * **The app logs the slip, from the food log.** The moment today's total goes
 * past the limit the store pass (`reconcileLimitWarnings`) records one slip,
 * quietly: no coins, no app block and no undo entry, because nobody tapped
 * anything, and the broken streak is the record. It remembers that it logged
 * it (`limitWarningAutoSlips`), so deleting the entry that took the day over
 * takes the slip back, and a slip the person logged themselves is never
 * touched.
 *
 * **Read from the food log, not from Apple Health.** A Health rule can watch
 * saturated fat too, but only once the log has been written to Health, and its
 * threshold is a second number to keep in step with the target by hand.
 *
 * Deleting the task stops it for that nutrient (`limitWarningDeclined`) until
 * the nutrient is set to Stay under again; turning the automation off removes
 * them all. Pure: the store pass does the writing.
 */

/** Where today stands against one limit, for the task's title and notes. */
export interface LimitReading {
  key: NutrientKey;
  total: number;
  target: number;
  status: LimitStatus;
}

/** Each active limit against today's totals, in label order. */
export function limitReadings(
  totals: Partial<Record<NutrientKey, number>>,
  targets: NutritionTargets,
  limits: readonly NutrientKey[],
  warnPercent: number,
): LimitReading[] {
  return activeLimits(targets, limits).map(key => {
    const total = totals[key] ?? 0;
    return { key, total, target: targets[key]!, status: limitStatus(key, total, targets, warnPercent) };
  });
}

/** The nutrient a task's source id names, or null for one this build can't read. */
export function limitWarningKeyOf(sourceId: string | null | undefined): NutrientKey | null {
  return sourceId && (NUTRIENT_KEYS as readonly string[]).includes(sourceId) ? (sourceId as NutrientKey) : null;
}

function figure(key: NutrientKey, amount: number): string {
  const unit = NUTRIENT_LABEL[key].unit;
  const suffix = unit === 'cal' ? ' cal' : unit;
  return `${(Math.round(amount * 10) / 10).toLocaleString('en-US')}${suffix}`;
}

function shortName(key: NutrientKey): string {
  return (LIMIT_ROW_NAME[key] ?? NUTRIENT_LABEL[key].label).toLowerCase();
}

/**
 * "Stay under 35g sugar", then " · 28g so far" once anything logged today
 * states it, so the row says where the day stands without being opened.
 */
export function limitWarningTitle(reading: LimitReading): string {
  const base = `Stay under ${figure(reading.key, reading.target)} ${shortName(reading.key)}`;
  return reading.total > 0 ? `${base} · ${figure(reading.key, reading.total)} so far` : base;
}

/** What opens the Food log, for the task's link button. */
export const LIMIT_WARNING_LINK = 'dundundun://foodlog';

/** How many of the day's biggest contributors the notes name. */
export const LIMIT_WARNING_TOP_FOODS = 3;

export const LIMIT_WARNING_NOTES =
  'From the food log, against the Stay under limit set in Nutrition. Going past it logs a slip for you; deleting the entry that did takes it back.';

/**
 * "Most of it: Ice cream (18g), Chocolate chip cookies (9g), Oat milk (4g)."
 *
 * The entries that put the most of `key` into today's total, biggest first,
 * merged by name so three scoops logged separately read as one food. Only
 * entries that state the nutrient: one that doesn't is unknown, and naming it
 * as a contributor of nothing would be a claim. Null when nothing states it.
 */
export function describeLimitContributors(
  entries: readonly FoodLogEntry[],
  key: NutrientKey,
  limit: number = LIMIT_WARNING_TOP_FOODS,
): string | null {
  const byName = new Map<string, number>();
  for (const entry of entries) {
    const amount = entry.nutrition.amounts[key];
    if (amount === undefined || amount <= 0) continue;
    byName.set(entry.label, (byName.get(entry.label) ?? 0) + amount);
  }
  if (byName.size === 0) return null;
  const top = [...byName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, amount]) => `${name} (${figure(key, amount)})`);
  return `Most of it: ${top.join(', ')}.`;
}

/**
 * The task's notes: where today stands ("Today: 28 of 35g, 7g left."), what
 * made it, then where the figure comes from.
 */
export function limitWarningNotes(entries: readonly FoodLogEntry[], reading: LimitReading): string {
  const today = `Today: ${(Math.round(reading.total * 10) / 10).toLocaleString('en-US')} of ${figure(reading.key, reading.target)}, ${
    (describeLimit(reading.key, reading.total, { [reading.key]: reading.target }) ?? '').replace(/^At/, 'at')
  }.`;
  const contributors = describeLimitContributors(entries, reading.key);
  return [today, contributors, LIMIT_WARNING_NOTES].filter(Boolean).join('\n\n');
}

/**
 * Whether the pass should log a slip for this limit now: the day is past it,
 * nothing has been slipped today (by the person or by the app), and the app
 * hasn't already logged one for today.
 */
export function shouldAutoSlip(reading: LimitReading, slipsToday: number, autoSlippedToday: boolean): boolean {
  return reading.status === 'over' && slipsToday === 0 && !autoSlippedToday;
}

/**
 * Whether to take back the slip the app logged today: the day is back within
 * the limit (an entry was deleted or corrected), and the app's slip is the one
 * there is to take. A person's own slip on top of it is left alone.
 */
export function shouldTakeBackAutoSlip(reading: LimitReading, slipsToday: number, autoSlippedToday: boolean): boolean {
  return reading.status !== 'over' && autoSlippedToday && slipsToday === 1;
}

/**
 * The per-limit record of the day the app last logged a slip, as stored.
 * Unknown nutrients and anything malformed drop.
 */
export function parseAutoSlips(raw: string | null | undefined): Partial<Record<NutrientKey, string>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Partial<Record<NutrientKey, string>> = {};
    for (const key of NUTRIENT_KEYS) {
      const day = (parsed as Record<string, unknown>)[key];
      if (typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)) out[key] = day;
    }
    return out;
  } catch {
    return {};
  }
}
