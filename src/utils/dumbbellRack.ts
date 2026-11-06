import type { DumbbellRack } from '../types';
import { kgToUnit, type WeightUnit } from './weightLog';
import { weightFromDisplay } from './workoutData';

/**
 * The dumbbells a gym has, as a range (`Gym.dumbbells`), and the rounding that
 * keeps a suggested load to one of them (docs/arch/workouts.md, "Gyms").
 *
 * A rack is the lightest, the heaviest and the step between neighbours. The
 * heaviest is always a weight, even when the step doesn't land on it (5 to 52
 * in 5s has a 52). Everything is compared in whole hundredths of the shown
 * unit, the way `workoutProgression.ts` compares loads, so 5 lb steps don't
 * drift when the weights are stored in kilograms.
 *
 * Not knowing is never "can't": a gym with no rack, or an exercise that isn't
 * on dumbbells, is never snapped, and the callers pass `null` for both.
 */

/** A rack from loose input, or null unless all three are positive and the range runs lightest to heaviest. */
export function cleanRack(raw: { minKg?: unknown; maxKg?: unknown; stepKg?: unknown } | null | undefined): DumbbellRack | null {
  if (!raw) return null;
  const { minKg, maxKg, stepKg } = raw;
  if (typeof minKg !== 'number' || typeof maxKg !== 'number' || typeof stepKg !== 'number') return null;
  if (![minKg, maxKg, stepKg].every(n => Number.isFinite(n) && n > 0)) return null;
  if (maxKg < minKg) return null;
  return { minKg, maxKg, stepKg };
}

const hundredths = (kg: number, unit: WeightUnit) => Math.round(kgToUnit(kg, unit) * 100);
const toKg = (h: number, unit: WeightUnit) => weightFromDisplay(h / 100, unit);

type Mode = 'nearest' | 'up' | 'down';

/**
 * The dumbbell nearest a weight, or the nearest at or above (`up`) or at or
 * below (`down`) it. A weight past either end gives that end, so `down` below
 * the lightest still returns the lightest: nothing lighter exists.
 */
export function snapToRack(kg: number, rack: DumbbellRack, unit: WeightUnit, mode: Mode = 'nearest'): number {
  const lo = hundredths(rack.minKg, unit);
  const hi = hundredths(rack.maxKg, unit);
  const step = Math.max(1, hundredths(rack.stepKg, unit));
  const w = hundredths(kg, unit);
  if (w <= lo) return toKg(lo, unit);
  if (w >= hi) return toKg(hi, unit);
  const n = (w - lo) / step;
  const lower = lo + Math.floor(n) * step;
  const upper = Math.min(lo + Math.ceil(n) * step, hi);
  const pick = mode === 'down' ? lower : mode === 'up' ? upper : w - lower < upper - w ? lower : upper;
  return toKg(pick, unit);
}

/** The lightest dumbbell heavier than this weight, or null when it is already the heaviest. */
export function rackAbove(kg: number, rack: DumbbellRack, unit: WeightUnit): number | null {
  const w = hundredths(kg, unit);
  const next = snapToRack(toKg(w + 1, unit), rack, unit, 'up');
  return hundredths(next, unit) > w ? next : null;
}

/** The heaviest dumbbell lighter than this weight, or null when it is already the lightest. */
export function rackBelow(kg: number, rack: DumbbellRack, unit: WeightUnit): number | null {
  const w = hundredths(kg, unit);
  const next = snapToRack(toKg(w - 1, unit), rack, unit, 'down');
  return hundredths(next, unit) < w ? next : null;
}
