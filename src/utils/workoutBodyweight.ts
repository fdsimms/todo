/**
 * The typed body weight a workout is stamped with when Apple Health has no
 * recent weigh-in (`useSettingsStore.workoutBodyweightKg`). Kept apart from
 * `bodyweightLoad.ts` so the settings store can read it without loading the
 * exercise catalog.
 */

/** The range a typed body weight may take, in kilograms. Outside it reads as none rather than as a guess. */
export const WORKOUT_BODYWEIGHT_RANGE_KG = { min: 20, max: 300 } as const;

/** A stored or typed body weight in kilograms to one decimal, or null when blank, not a number, or out of range. */
export function parseWorkoutBodyweightKg(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const kg = Math.round(value * 10) / 10;
  return kg >= WORKOUT_BODYWEIGHT_RANGE_KG.min && kg <= WORKOUT_BODYWEIGHT_RANGE_KG.max ? kg : null;
}
