import type { WorkoutSet } from '../types';
import type { WeightUnit } from './weightLog';
import { weightFromDisplay } from './workoutData';
import type { SetField } from './workoutSession';

/** The most a field takes, a typo check like `MAX_SET_WEIGHT_KG`: the ceilings the steppers had. */
export function setFieldMax(field: SetField, unit: WeightUnit): number {
  if (field === 'weight') return unit === 'kg' ? 500 : 1100;
  if (field === 'reps') return 200;
  if (field === 'duration') return 3600;
  return 100000;
}

/**
 * What text typed into a set's cell writes: null clears the value, a number is
 * clamped to `setFieldMax`, and a duration may be seconds ("90") or m:ss
 * ("1:30"). Undefined means text that isn't a number, so the cell snaps back to
 * what it held rather than writing a guess.
 */
export function parseSetCell(field: SetField, text: string, unit: WeightUnit): Partial<WorkoutSet> | undefined {
  const t = text.trim().replace(',', '.');
  const key = field === 'weight' ? 'weightKg' : field === 'reps' ? 'reps' : field === 'duration' ? 'durationSeconds' : 'distanceM';
  if (t === '') return { [key]: null };
  let n: number;
  if (field === 'duration' && t.includes(':')) {
    const [m, sec] = t.split(':');
    n = Number(m) * 60 + Number(sec);
  } else {
    n = Number(t);
  }
  if (!Number.isFinite(n) || n < 0) return undefined;
  n = Math.min(n, setFieldMax(field, unit));
  if (field === 'weight') return { weightKg: weightFromDisplay(n, unit) };
  return { [key]: Math.round(n) };
}
