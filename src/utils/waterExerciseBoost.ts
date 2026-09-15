import { WATER_STEP_ML } from './waterLog';

/**
 * A day's water target, raised while today's exercise clears a threshold —
 * both numbers typed in by the user, never suggested.
 *
 * **The same fence `weightGoal.ts` draws, moved to a different room.**
 * `nutritionTargets.ts` bars a suggested or computed water target outright;
 * what this adds is not that — it is arithmetic against a number the user
 * chose (`minExerciseMinutes`, `boostMl`), the way a weight goal's rate is
 * arithmetic against a number the user chose rather than a recommendation.
 * Off by default (`null`), no default the app picked past what a stepper
 * opens on, and nothing here writes back into `nutritionTargets.waterMl`
 * itself — the boost is display-time only, so the stored target a person set
 * never silently drifts.
 *
 * **`exerciseMinutes` is the only exercise signal HealthKit hands back here**
 * (see `HealthDay.exerciseMinutes`), and it is minutes of *any* recorded
 * activity, not a workout's intensity — there is no "tough" to read off a
 * number. So "tough exercise" is spelled as a minutes floor the user sets
 * themselves, same as every other health rule threshold in this app.
 *
 * **Never treats a null reading as a zero.** A refused read or a day with
 * nothing recorded yet must not be read as "no exercise, so no boost" versus
 * "exercise happened, so boost" — both are simply "no boost", the same
 * refusal `judgedReadingValue` in `healthRules.ts` makes about this exact
 * field, just without that function's `exerciseMinutesSeenRecently` carve-out:
 * this feature only ever acts on a positive number, so it has no need to
 * decide whether an absence is a real zero.
 */
export interface WaterExerciseBoost {
  /** Today's exercise minutes must reach at least this many to raise the target. */
  minExerciseMinutes: number;
  /** How many millilitres the target is raised by, once the threshold is met. */
  boostMl: number;
}

/**
 * What the minutes threshold may be set to, and where its stepper opens.
 *
 * Mirrors `HEALTH_THRESHOLDS.exerciseMinutes` in `healthRules.ts` — same
 * metric, same reasoning about its range — kept as its own constant rather
 * than imported so this file has no dependency on the health-rules feature,
 * which is a different mechanism (a rule that writes a task) than this one
 * (a number that raises a target).
 */
export const WATER_EXERCISE_BOOST_MINUTES_RANGE = { min: 5, max: 150, step: 5, default: 45 };

/** What the boost amount may be set to, in millilitres, and where its stepper opens. */
export const WATER_EXERCISE_BOOST_ML_RANGE = {
  min: WATER_STEP_ML,
  max: 2000,
  step: WATER_STEP_ML,
  default: WATER_STEP_ML * 2,
};

/** A stored boost, or null if there isn't a readable one. */
export function parseWaterExerciseBoost(raw: string | null | undefined): WaterExerciseBoost | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const minExerciseMinutes = clampField(parsed.minExerciseMinutes, WATER_EXERCISE_BOOST_MINUTES_RANGE);
    const boostMl = clampField(parsed.boostMl, WATER_EXERCISE_BOOST_ML_RANGE);
    if (minExerciseMinutes === null || boostMl === null) return null;
    return { minExerciseMinutes, boostMl };
  } catch {
    return null;
  }
}

export function serializeWaterExerciseBoost(boost: WaterExerciseBoost): string {
  return JSON.stringify(boost);
}

function clampField(value: unknown, range: { min: number; max: number }): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(range.max, Math.max(range.min, value));
}

/**
 * Today's water target, raised by the boost when it applies — or the base
 * target, unchanged, in every other case.
 *
 * Refuses to invent a target: a `baseMl` of `undefined` (nothing set in
 * `NutritionTargetsSheet`) comes back `undefined`, since there is nothing to
 * raise. Refuses to guess from a null reading, per the file note above — only
 * a real number at or past the threshold raises it.
 */
export function effectiveWaterTargetMl(
  baseMl: number | undefined,
  exerciseMinutesToday: number | null,
  boost: WaterExerciseBoost | null,
): number | undefined {
  if (baseMl === undefined) return undefined;
  if (!waterExerciseBoostApplies(exerciseMinutesToday, boost)) return baseMl;
  return baseMl + (boost as WaterExerciseBoost).boostMl;
}

/** Whether today's exercise clears the boost's own threshold. */
export function waterExerciseBoostApplies(
  exerciseMinutesToday: number | null,
  boost: WaterExerciseBoost | null,
): boolean {
  if (!boost) return false;
  if (exerciseMinutesToday === null) return false;
  return exerciseMinutesToday >= boost.minExerciseMinutes;
}
