import type { NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';
import { NUTRIENT_LABEL } from './foodNutrition';

/**
 * A daily figure to aim at, per nutrient, and how a day's total reads against
 * one.
 *
 * **A target the user set, or nothing.** There are no suggested goals here, no
 * computed basal rate, and no default of any kind: the map ships empty and
 * stays empty until somebody types a number. The app has no business having an
 * opinion on what a person should eat, which is the same argument
 * `docs/arch/health-data.md` makes at length about a related case, and a
 * "recommended" figure sitting in a field nobody chose is exactly how an app
 * acquires one.
 *
 * **`healthTarget` is the precedent, not the quota fields.** A real number,
 * outside the quota mechanism, where reaching it completes nothing — because a
 * total is a record of what happened rather than a task to finish. `logQuotaUnit`
 * auto-completes on reaching its target and `MAX_TARGET_COUNT` is 99; neither
 * is any use for two thousand calories.
 *
 * **Counts, never a score.** This is the surface that most tempts a progress
 * ring turning red, and it must not have one. No colour that means bad, no
 * encouragement, no "400 calories left" framed as permission or as warning.
 * Report the number and the target and stop. `cookingStats.ts` states the rule
 * twice; it binds hardest here.
 *
 * **Absent is not zero.** A day with nothing logged has no total, not a total
 * of zero, so it reads as having no answer rather than as a day of nothing —
 * the same refusal `healthContextRows` makes about a step count every morning.
 */

/**
 * What a target may be set to, per nutrient.
 *
 * Deliberately its own table rather than `HEALTH_THRESHOLDS` from
 * `healthRules.ts`, for the reason `HEALTH_TARGET_RANGES` gives about the same
 * pair: **a floor and a goal are different numbers.** A rule asks whether the
 * day fell short, so its range starts low; a target is something to aim at, so
 * it runs further. Sharing one table would have a rule stepper offering figures
 * nobody meant.
 *
 * The `default` here is what a stepper opens on when somebody first adds a
 * target for that nutrient. It is **not** a target: nothing is stored until
 * they accept it, and the map's own default is empty.
 */
export const NUTRITION_TARGET_RANGES: Record<
  NutrientKey,
  { min: number; max: number; step: number; default: number }
> = {
  calorieKcal: { min: 500, max: 6000, step: 50, default: 2000 },
  fatG: { min: 10, max: 300, step: 5, default: 70 },
  satFatG: { min: 5, max: 100, step: 1, default: 20 },
  carbsG: { min: 20, max: 800, step: 10, default: 250 },
  fiberG: { min: 5, max: 100, step: 1, default: 30 },
  sugarG: { min: 5, max: 300, step: 5, default: 50 },
  proteinG: { min: 10, max: 400, step: 5, default: 60 },
  sodiumMg: { min: 200, max: 6000, step: 100, default: 2300 },
  caffeineMg: { min: 20, max: 1000, step: 10, default: 400 },
  waterMl: { min: 250, max: 6000, step: 250, default: 2000 },
};

/** What a person has set, keyed by nutrient. Empty is the shipping state. */
export type NutritionTargets = Partial<Record<NutrientKey, number>>;

/**
 * The targets a stored blob actually carries, dropping anything unreadable.
 *
 * Unknown keys go, because this build has no unit for a nutrient it does not
 * know, and a non-positive figure goes with the malformed: a target of zero is
 * not something to aim at, and there is no way to read it that is not either a
 * bug or a scold.
 */
export function parseNutritionTargets(raw: string | null | undefined): NutritionTargets {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const targets: NutritionTargets = {};
    for (const key of NUTRIENT_KEYS) {
      const value = parsed[key];
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) targets[key] = value;
    }
    return targets;
  } catch {
    return {};
  }
}

export function serializeNutritionTargets(targets: NutritionTargets): string {
  return JSON.stringify(targets);
}

/** The nutrients with a target set, in the order a label prints them. */
export function targetedNutrients(targets: NutritionTargets): NutrientKey[] {
  return NUTRIENT_KEYS.filter(key => targets[key] !== undefined);
}

/**
 * "1,840 of 2,000 cal", or null when there is nothing to say.
 *
 * **Null for a nutrient nothing logged today stated**, rather than "0 of
 * 2,000". A day nobody has eaten in yet has no total, and rendering a zero
 * against a goal every morning is the same mistake the step row refuses to
 * make: it reads as a scold to somebody who has not eaten and as a bug to
 * everybody else.
 *
 * Null too for a nutrient with no target, since the caller is asking how the
 * day reads against one and there isn't one. The total on its own is the day
 * view's own business.
 */
export function describeAgainstTarget(
  key: NutrientKey,
  total: number | undefined,
  targets: NutritionTargets,
): string | null {
  const target = targets[key];
  if (target === undefined || total === undefined) return null;
  const unit = NUTRIENT_LABEL[key].unit;
  const suffix = unit === 'cal' ? ' cal' : unit;
  return `${round(total).toLocaleString()} of ${target.toLocaleString()}${suffix}`;
}

/**
 * How far through a target the day is, 0 to 1, for a caller drawing a bar.
 *
 * Clamped at 1, the same call `healthTargetProgress` makes: a bar past its own
 * end is not more information, and here it would be the one place a reading
 * could look like a failure. Zero when nothing is known, because a bar has to
 * draw something and empty is the honest picture of a day nobody has logged.
 *
 * **Whether being over a target is good or bad is not this module's business
 * and is not knowable.** Somebody tracking protein wants to reach it and
 * somebody tracking sodium wants to stay under, and the app is not told which.
 * So the bar is one colour and carries no judgement at either end.
 */
export function targetProgress(
  key: NutrientKey,
  total: number | undefined,
  targets: NutritionTargets,
): number {
  const target = targets[key];
  if (target === undefined || total === undefined || target <= 0) return 0;
  return Math.min(1, Math.max(0, total / target));
}

function round(amount: number): number {
  return Math.round(amount * 10) / 10;
}
