import type { WorkoutSet } from '../types';
import type { WeightUnit } from './weightLog';
import { weightFromDisplay } from './workoutData';
import { storedKgFromTyped } from './dumbbellLoad';
import type { SetField } from './workoutSession';

/** The most a field takes, a typo check like `MAX_SET_WEIGHT_KG`: the ceilings the steppers had. */
export function setFieldMax(field: SetField, unit: WeightUnit): number {
  if (field === 'weight') return unit === 'kg' ? 500 : 1100;
  if (field === 'reps') return 200;
  if (field === 'duration') return 3600;
  return 100000;
}

/**
 * What text typed into a routine set's reps cell plans: "8" is a fixed count,
 * "8-12" (or "8–12") a range, "8+" a floor, and blank none. Either end alone
 * is the same number for both ends, as `withSetReps` reads it, and the order
 * the ends are typed in doesn't matter. Undefined is text that isn't reps, so
 * the cell snaps back rather than writing a guess.
 */
export function parseRepsTarget(text: string): { min: number | null; max: number | null } | undefined {
  const t = text.trim();
  if (t === '') return { min: null, max: null };
  const m = /^(\d+)\s*(?:[-–—]\s*(\d+)|\+)?$/.exec(t);
  if (!m) return undefined;
  const cap = (n: number) => Math.min(Math.max(1, n), setFieldMax('reps', 'kg'));
  const lo = cap(Number(m[1]));
  const hi = m[2] !== undefined ? cap(Number(m[2])) : lo;
  return { min: lo, max: hi };
}

/**
 * What text typed into a set's cell writes: null clears the value, a number is
 * clamped to `setFieldMax` (as typed, before a pair total is halved), and a duration may be seconds ("90") or m:ss
 * ("1:30"). Undefined means text that isn't a number, so the cell snaps back to
 * what it held rather than writing a guess.
 */
export function parseSetCell(field: SetField, text: string, unit: WeightUnit, scale = 1): Partial<WorkoutSet> | undefined {
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
  // A pair total typed for two dumbbells is stored as one dumbbell's weight (`dumbbellLoad.ts`).
  if (field === 'weight') return { weightKg: scale === 1 ? weightFromDisplay(n, unit) : storedKgFromTyped(n, unit, scale) };
  return { [key]: Math.round(n) };
}
