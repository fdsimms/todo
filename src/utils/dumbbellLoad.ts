import type { Exercise, ExerciseEquipment } from '../types';
import type { WeightUnit } from './weightLog';
import { libraryExercise } from './exerciseLibrary';
import { formatWeightNumber, weightFromDisplay } from './workoutData';

/**
 * How a weight is typed and read for an exercise held in two dumbbells.
 * `each` is the weight of one dumbbell, `pair` is both added together.
 *
 * **A set always stores one dumbbell's weight.** The choice changes only what
 * a cell takes and shows, so a record, volume, a progression proposal, a CSV
 * row and the MCP server all read one comparable number whichever way a
 * person logs, and flipping the setting rewrites nothing. A pair total is
 * halved on the way in and doubled on the way out (`weightScale`).
 */
export type DumbbellEntry = 'each' | 'pair';

/**
 * The library's dumbbell exercises done with one dumbbell. Every other
 * dumbbell exercise is two (the pair is the common case), and a person can
 * correct either on the exercise itself, so this is a default, not a rule.
 */
const ONE_DUMBBELL_IDS: ReadonlySet<string> = new Set([
  'dumbbell-pullover', 'dumbbell-row', 'one-arm-dumbbell-shoulder-press', 'concentration-curl',
  'overhead-dumbbell-triceps-extension', 'dumbbell-kickback', 'dumbbell-wrist-curl', 'suitcase-carry',
  'goblet-squat', 'single-leg-romanian-deadlift', 'single-leg-calf-raise', 'dumbbell-side-bend',
].map(slug => `lib:${slug}`));

type DumbbellFields = Pick<Exercise, 'id' | 'equipment' | 'dumbbells' | 'loadEntry'>;

/** How many dumbbells the exercise is held in; null for anything that isn't a dumbbell exercise. */
export function dumbbellsUsed(ex: Pick<Exercise, 'id' | 'equipment' | 'dumbbells'>): 1 | 2 | null {
  if (ex.equipment !== 'dumbbell') return null;
  if (ex.dumbbells) return ex.dumbbells;
  return libraryExercise(ex.id) && ONE_DUMBBELL_IDS.has(ex.id) ? 1 : 2;
}

/**
 * The entry that applies to this exercise. One dumbbell has no pair to total,
 * so it is `each` whatever is set, and a setting or an exercise's own choice
 * only ever matters for two.
 */
export function entryFor(ex: DumbbellFields | null | undefined, setting: DumbbellEntry): DumbbellEntry {
  if (!ex || dumbbellsUsed(ex) !== 2) return 'each';
  return ex.loadEntry ?? setting;
}

/** What to multiply a stored weight by to show it: 2 for a pair total, else 1. */
export function weightScale(ex: DumbbellFields | null | undefined, setting: DumbbellEntry): 1 | 2 {
  return entryFor(ex, setting) === 'pair' ? 2 : 1;
}

/** A stored weight (one dumbbell) as shown, in kilograms. */
export function shownKg(kg: number, scale: number): number {
  return kg * scale;
}

/** A weight typed in the unit shown, as stored: a pair total is halved. */
export function storedKgFromTyped(value: number, unit: WeightUnit, scale: number): number {
  return Math.round((weightFromDisplay(value, unit) / scale) * 1000) / 1000;
}

/** "12.5", or "25" for the same stored weight read as a pair. */
export function formatScaledWeight(kg: number, unit: WeightUnit, scale: number): string {
  return formatWeightNumber(shownKg(kg, scale), unit);
}

/** What follows the unit in the weight column's heading: " each" or " pair" where two dumbbells are in play, else nothing. */
export function weightHeadingSuffix(ex: DumbbellFields | null | undefined, setting: DumbbellEntry): string {
  if (!ex || dumbbellsUsed(ex) !== 2) return '';
  return entryFor(ex, setting) === 'pair' ? ' pair' : ' each';
}

export const DUMBBELL_ENTRY_LABELS: Record<DumbbellEntry, string> = { each: 'Each dumbbell', pair: 'Pair total' };

export function isDumbbellEquipment(e: ExerciseEquipment): boolean {
  return e === 'dumbbell';
}
