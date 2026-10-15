/**
 * A protein target held at a ratio of the latest weigh-in, so it moves with the
 * body instead of going stale.
 *
 * **The ratio is the person's, typed in; the app supplies no figure.** The
 * stepper opens on a round number so the control starts somewhere recognizable,
 * the way `ACTIVE_ENERGY_BASELINE_RANGE.default` does, and nothing is stored
 * until somebody turns the row on. How much protein anybody should eat is a real
 * disagreement this app stays out of (`nutritionTargets.ts`,
 * `docs/arch/health-data.md`); what this does is arithmetic over two numbers
 * the person chose: their ratio and their weight.
 *
 * **It writes the stored target, like the weight goal's calorie figure does.**
 * `useSettingsStore.syncProteinToWeight` puts the result in
 * `nutritionTargets.proteinG` rather than computing it at display time. The
 * boosts (`activeEnergyBoost.ts`) can be display-only because they have a few
 * readers; the protein target is read by the food log, Today, the widget, the
 * limit and nutrient tasks, the meal plan, Stats and the MCP replica, and a
 * display-time figure would need every one of them to remember it. Weight lives
 * only in Health on the phone, so the replica could not work it out at all.
 * Keeping the stored number current is the one change all of them already read.
 *
 * **It never invents a target and never clears one.** No ratio, no weight, or a
 * weight that is not a plausible body mass all answer null, and a null leaves
 * whatever is stored alone. A refused Health read and an empty one are the same
 * answer here as everywhere else (`docs/arch/health-data.md`), so neither may
 * move the target toward zero.
 */

import { MAX_WEIGHT_KG, kgToUnit, unitToKg, type WeightUnit } from './weightLog';
import { NUTRITION_TARGET_RANGES } from './nutritionTargets';

/** Grams of protein per unit of body weight, in the unit the person thinks in. */
export interface ProteinPerWeight {
  unit: WeightUnit;
  gramsPerUnit: number;
}

/**
 * What the ratio may be set to, per unit, and where a stepper opens.
 *
 * Two tables rather than one converted table, for `RATE_RANGE`'s reason: a
 * twentieth of a gram per pound is a granularity a person means, and the same
 * step in kilograms is not. The ceiling is a stepper's bound (a mis-tap is far
 * likelier than a plan past it), not a view on what is sensible; there is no
 * warning band inside the range. The `default` is where the stepper opens and
 * nothing else.
 */
export const PROTEIN_PER_WEIGHT_RANGE: Record<
  WeightUnit,
  { min: number; max: number; step: number; default: number }
> = {
  lb: { min: 0.1, max: 2, step: 0.05, default: 1 },
  kg: { min: 0.2, max: 4.4, step: 0.1, default: 2 },
};

/** The ratio clamped into its unit's range, or null when it is not a number. */
function clampRatio(unit: WeightUnit, grams: unknown): number | null {
  if (typeof grams !== 'number' || !Number.isFinite(grams)) return null;
  const { min, max, step } = PROTEIN_PER_WEIGHT_RANGE[unit];
  const snapped = Math.round(grams / step) * step;
  // Rounded to the step's own precision, or 0.05 * 7 reads back as 0.35000000000000003.
  return Math.min(max, Math.max(min, Number(snapped.toFixed(2))));
}

/** A stored ratio, or null if there isn't a readable one. */
export function parseProteinPerWeight(raw: string | null | undefined): ProteinPerWeight | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const { unit, gramsPerUnit } = parsed;
    if (unit !== 'lb' && unit !== 'kg') return null;
    const grams = clampRatio(unit, gramsPerUnit);
    return grams === null ? null : { unit, gramsPerUnit: grams };
  } catch {
    return null;
  }
}

export function serializeProteinPerWeight(setting: ProteinPerWeight): string {
  return JSON.stringify(setting);
}

/**
 * The same ratio expressed in the other unit, rounded onto that unit's step, so
 * switching lb to kg keeps the target within a step of where it was rather than
 * leaving a number the new stepper would immediately snap away from.
 */
export function switchProteinUnit(setting: ProteinPerWeight, unit: WeightUnit): ProteinPerWeight {
  if (setting.unit === unit) return setting;
  const perKg = setting.gramsPerUnit / unitToKg(1, setting.unit);
  const converted = perKg * unitToKg(1, unit);
  return { unit, gramsPerUnit: clampRatio(unit, converted) ?? PROTEIN_PER_WEIGHT_RANGE[unit].default };
}

/**
 * The protein target, in whole grams, for a body of `currentKg`, or null when
 * there is nothing honest to say.
 *
 * Null for no ratio and for a weight that is missing, non-finite, not positive
 * or past `MAX_WEIGHT_KG`: a bad reading must leave the stored target alone,
 * not drag it to zero or to a ceiling. The result is held inside the protein
 * target's own range, since a ratio times a heavy body can pass the 400 g
 * ceiling the stepper holds everybody else to.
 */
export function proteinTargetFromWeight(
  currentKg: number | null,
  setting: ProteinPerWeight | null,
): number | null {
  if (setting === null || currentKg === null) return null;
  if (!Number.isFinite(currentKg) || currentKg <= 0 || currentKg > MAX_WEIGHT_KG) return null;
  const grams = Math.round(setting.gramsPerUnit * kgToUnit(currentKg, setting.unit));
  const { min, max } = NUTRITION_TARGET_RANGES.proteinG;
  return Math.min(max, Math.max(min, grams));
}
