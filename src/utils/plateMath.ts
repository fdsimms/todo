import type { ExerciseEquipment, PlateInventory } from '../types';
import { kgToUnit, unitToKg, type WeightUnit } from './weightLog';
import { DEFAULT_PLATE_INVENTORY, formatWeightNumber, weightToDisplay } from './workoutData';

/**
 * Which plates make a load: the plates on each side of a bar, the nearest load
 * the plates can make when the one asked for can't be made, and a warm-up ramp
 * to the working weight. Pure; see docs/arch/workouts.md.
 *
 * **Weights are stored in kilograms and loaded in the unit shown.** A person
 * who lifts in pounds owns 45 lb plates, and 45 lb is 20.412 kg, so doing the
 * arithmetic in kilograms would miss "135 lb" by a few thousandths and call it
 * unreachable. The search runs in hundredths of the shown unit instead, where
 * 45 lb and a 135 lb target are exact, and hands back the inventory's own
 * kilogram plates for the caller to format.
 *
 * **It never claims a load it can't make.** Asked for 83 kg with nothing
 * smaller than a 1.25 kg plate, it returns the nearest loadable weight with
 * `exact: false` and the caller says so, rather than writing 83 under a set of
 * plates that add to 82.5. Ties go to the lighter load: the plates are never
 * asked to overshoot a set the person meant to be lighter.
 */

/** Plates of one weight, per side. `kg` is the inventory's own value. */
export interface PlateSlot {
  kg: number;
  count: number;
}

export interface PlateLoad {
  targetKg: number;
  barKg: number;
  /** Plates on each side, heaviest first. Empty for the bare bar. */
  perSide: PlateSlot[];
  /** The bar plus both sides, as loaded. Equals the target when `exact`. */
  loadedKg: number;
  exact: boolean;
  /** Nothing goes on the bar: the target is at or under its weight. */
  barOnly: boolean;
}

/** A pound gym's bars and plates, the counterpart of `DEFAULT_PLATE_INVENTORY`. Stored in kilograms like every weight. */
export const DEFAULT_PLATE_INVENTORY_LB: PlateInventory = {
  barsKg: [45, 35].map(lb => unitToKg(lb, 'lb')),
  plates: [
    { kg: unitToKg(45, 'lb'), count: 8 },
    { kg: unitToKg(35, 'lb'), count: 4 },
    { kg: unitToKg(25, 'lb'), count: 4 },
    { kg: unitToKg(10, 'lb'), count: 4 },
    { kg: unitToKg(5, 'lb'), count: 4 },
    { kg: unitToKg(2.5, 'lb'), count: 4 },
  ],
};

const sameInventory = (a: PlateInventory, b: PlateInventory) =>
  a.barsKg.length === b.barsKg.length
  && a.barsKg.every((kg, i) => kg === b.barsKg[i])
  && a.plates.length === b.plates.length
  && a.plates.every((p, i) => p.kg === b.plates[i].kg && p.count === b.plates[i].count);

/**
 * The inventory to load from for the unit shown. One still equal to the
 * metric default means the person never said what they own, and a pound
 * lifter shown a "20 kg bar" and 1.25 kg plates has been told something false,
 * so that case gets the pound default. Anything the person set is used as it is.
 */
export function effectivePlateInventory(inventory: PlateInventory, unit: WeightUnit): PlateInventory {
  return unit === 'lb' && sameInventory(inventory, DEFAULT_PLATE_INVENTORY) ? DEFAULT_PLATE_INVENTORY_LB : inventory;
}

/** The equipment that is loaded with plates on a bar: the line shows for these and nothing else. */
export function isPlateLoaded(equipment: ExerciseEquipment): boolean {
  return equipment === 'barbell' || equipment === 'ez_bar' || equipment === 'trap_bar';
}

/**
 * What an EZ bar and a trap bar weigh when the exercise names no bar of its
 * own: about 10 kg or 25 lb, and about 25 kg or 55 lb. They are stocked in the
 * unit the gym uses, so the default follows the unit shown. A barbell isn't
 * here: its bar is the inventory's.
 */
const OTHER_BAR_KG: Record<'ez_bar' | 'trap_bar', Record<WeightUnit, number>> = {
  ez_bar: { kg: 10, lb: unitToKg(25, 'lb') },
  trap_bar: { kg: 25, lb: unitToKg(55, 'lb') },
};

/**
 * The bar a plate-loaded exercise is loaded on: its own `barKg` where it has
 * one, else the default for its equipment. A barbell's default is the
 * inventory's heaviest bar; an EZ bar's and a trap bar's are fixed per unit.
 */
export function barKgFor(
  exerciseBarKg: number | null | undefined,
  inventory: PlateInventory,
  equipment: ExerciseEquipment = 'barbell',
  unit: WeightUnit = 'kg',
): number {
  if (typeof exerciseBarKg === 'number' && exerciseBarKg > 0) return exerciseBarKg;
  if (equipment === 'ez_bar' || equipment === 'trap_bar') return OTHER_BAR_KG[equipment][unit];
  return inventory.barsKg[0] ?? 20;
}

/** Hundredths of the shown unit: the integers the search works in. */
const hundredths = (kg: number, unit: WeightUnit) => Math.round(kgToUnit(kg, unit) * 100);

interface Available {
  kg: number;
  /** Hundredths of the unit. */
  w: number;
  /** How many fit on one side. */
  max: number;
}

/** The fewest plates that make `sum` exactly, heaviest first among equals; null when none do. */
function fewestPlates(plates: readonly Available[], sum: number): number[] | null {
  let best: number[] | null = null;
  let bestCount = Infinity;
  const taken = new Array<number>(plates.length).fill(0);
  const go = (i: number, remaining: number, used: number) => {
    if (used >= bestCount) return;
    if (remaining === 0) {
      best = [...taken];
      bestCount = used;
      return;
    }
    if (i >= plates.length) return;
    const top = Math.min(plates[i].max, Math.floor(remaining / plates[i].w));
    for (let k = top; k >= 0; k--) {
      taken[i] = k;
      go(i + 1, remaining - k * plates[i].w, used + k);
    }
    taken[i] = 0;
  };
  go(0, sum, 0);
  return best;
}

/**
 * The plates for a target load: what goes on each side of the bar, and the
 * weight that actually makes. `targetKg` and `barKg` are kilograms; `unit` is
 * the unit the person reads and lifts in (see the file's note).
 *
 * Null for a target that isn't a positive number.
 */
export function plateLoad(
  targetKg: number | null | undefined,
  barKg: number,
  inventory: PlateInventory,
  unit: WeightUnit,
): PlateLoad | null {
  if (typeof targetKg !== 'number' || !Number.isFinite(targetKg) || !(targetKg > 0)) return null;
  const bar = hundredths(barKg, unit);
  const target = hundredths(targetKg, unit);
  const bare: PlateLoad = { targetKg, barKg, perSide: [], loadedKg: barKg, exact: target === bar, barOnly: true };
  if (target <= bar) return bare;

  const plates: Available[] = inventory.plates
    .map(p => ({ kg: p.kg, w: hundredths(p.kg, unit), max: Math.floor(p.count / 2) }))
    .filter(p => p.w > 0 && p.max > 0)
    .sort((a, b) => b.w - a.w);
  if (plates.length === 0) return bare;

  // Each side carries half of what goes on the bar, which may land between
  // two hundredths: the comparison below is against that exact half.
  const want = (target - bar) / 2;
  const heaviest = plates[0].w;
  const limit = Math.ceil(want + heaviest);
  const reach = new Uint8Array(limit + 1);
  reach[0] = 1;
  for (const p of plates) {
    for (let copy = 0; copy < p.max; copy++) {
      for (let s = limit; s >= p.w; s--) if (reach[s - p.w]) reach[s] = 1;
    }
  }
  let closest = 0;
  let gap = Infinity;
  for (let s = 0; s <= limit; s++) {
    if (!reach[s]) continue;
    const d = Math.abs(s - want);
    if (d < gap) { gap = d; closest = s; }
  }
  const counts = fewestPlates(plates, closest) ?? plates.map(() => 0);
  const perSide = plates
    .map((p, i) => ({ kg: p.kg, count: counts[i] }))
    .filter(slot => slot.count > 0);
  const loadedKg = barKg + 2 * perSide.reduce((sum, s) => sum + s.kg * s.count, 0);
  return { targetKg, barKg, perSide, loadedKg, exact: gap === 0, barOnly: perSide.length === 0 };
}

/** One entry per plate on a side, heaviest first: [20, 20, 10] for two 20s and a 10. */
export function platesOnSide(load: PlateLoad): number[] {
  return load.perSide.flatMap(s => Array<number>(s.count).fill(s.kg));
}

/**
 * The load in words for a screen reader and for the line's own text:
 * "20 kg bar, then 20, 10 and 1.25 on each side". Says when the target
 * couldn't be made, and when it is lighter than the bar.
 */
export function describePlateLoad(load: PlateLoad, unit: WeightUnit): string {
  const bar = `${formatWeightNumber(load.barKg, unit)} ${unit} bar`;
  if (load.barOnly) {
    if (load.targetKg < load.barKg) return `Lighter than the ${bar}`;
    return load.exact
      ? `Just the ${bar}`
      : `Just the ${bar}, the closest load to ${formatWeightNumber(load.targetKg, unit)} ${unit}`;
  }
  const names = platesOnSide(load).map(kg => formatWeightNumber(kg, unit));
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  const base = `${bar}, then ${list} on each side`;
  return load.exact
    ? base
    : `${base}. That makes ${formatWeightNumber(load.loadedKg, unit)} ${unit}, the closest load to ${formatWeightNumber(load.targetKg, unit)} ${unit}`;
}

// ==== warm-ups ====

export interface WarmupStep {
  /** The load, in kg, as the plates make it. Never above the working weight. */
  kg: number;
  reps: number;
  /** The share of the working weight it was asked for, 0 to 1. */
  fraction: number;
}

/** The ramp suggested by default: 40%, 60% and 80% of the working weight, in fewer reps as it gets heavier. */
export const DEFAULT_WARMUP_RAMP: readonly { fraction: number; reps: number }[] = [
  { fraction: 0.4, reps: 8 },
  { fraction: 0.6, reps: 5 },
  { fraction: 0.8, reps: 3 },
];

/**
 * A warm-up ramp to a working weight, each step rounded to a load the plates
 * can make. A step that would land on the bare bar is the bar; two steps that
 * round to the same load keep the first; a step at or above the working weight
 * is dropped, since it is no warm-up. Empty when the working weight is at or
 * under the bar: there is nothing lighter to build up from.
 *
 * A suggestion only: nothing writes these sets unasked (the app proposes, the
 * person confirms).
 */
export function warmupRamp(
  workingKg: number,
  barKg: number,
  inventory: PlateInventory,
  unit: WeightUnit,
  ramp: readonly { fraction: number; reps: number }[] = DEFAULT_WARMUP_RAMP,
): WarmupStep[] {
  if (!(workingKg > barKg)) return [];
  const out: WarmupStep[] = [];
  for (const step of ramp) {
    const load = plateLoad(workingKg * step.fraction, barKg, inventory, unit);
    if (!load) continue;
    // Compared as displayed: two kilograms that read the same in the unit are the same load.
    const kg = load.loadedKg;
    if (weightToDisplay(kg, unit) >= weightToDisplay(workingKg, unit)) continue;
    if (out.length > 0 && weightToDisplay(out[out.length - 1].kg, unit) === weightToDisplay(kg, unit)) continue;
    out.push({ kg, reps: step.reps, fraction: step.fraction });
  }
  return out;
}
