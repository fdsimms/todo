import type { FoodLogEntry, FoodNutrition, NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';
import { NUTRITION_TARGET_RANGES } from './nutritionTargets';
import { flOzToMl, mlToFlOz } from './foodNutrition';

/**
 * A day's water, as one food log entry.
 *
 * **Water was the one nutrient with a target and no way to fill it.** It is a
 * full `NutrientKey` with a unit, a range, a row on the targets sheet, a parser
 * arm and a rule in `healthRules.ts`, and nothing in the app could log a glass:
 * the food log only takes a food carrying a panel, so a glass of water needed a
 * catalog item called Water before it could be recorded at all. The bar sat at
 * zero all day (#2515).
 *
 * **One entry a day, stepped up and down, rather than one per glass.** Both are
 * defensible and this is the one that keeps the diary readable: eight glasses is
 * eight rows, in the meal sections the day view exists to show. What it costs is
 * that the Health sample is dated at the first glass and carries the whole day's
 * volume, where Apple's own Health app records each one at its own moment. That
 * is a fact about *when*, not about how much, and a food diary reading like a
 * water log is the worse of the two.
 *
 * The stepping is what `reviseEntry` (`useFoodLogStore`) exists for: each change
 * retracts the samples the entry wrote and writes the corrected figure, so the
 * running total never leaves a stale volume in a medical record. Callers must
 * settle the number before committing it — see the note on `waterHelping`.
 *
 * **Nothing here writes to Health directly.** A water entry goes through the
 * ordinary food log path, so it is `logFoodEntryToHealth` that writes it, the
 * bridge already maps `waterMl` onto `.dietaryWater`, and every guard that
 * applies to a meal applies here unchanged. This is deliberately *not* a second
 * water write beside the task completion one (`logHealthMetric`): that one is a
 * task recording a nutrient when it is ticked, and this is somebody saying what
 * they drank.
 */

/**
 * Which unit a stepper of water shows, `waterUnit` in settings.
 *
 * Display only: `waterMl` is stored in millilitres whichever is picked, the
 * same split `WeightUnit` keeps against what HealthKit hands back. Water is the
 * one nutrient this is worth having for — nobody asks for a stepper in fluid
 * ounces of sodium.
 */
export type WaterUnit = 'ml' | 'flOz';

/** How much one press of the day's stepper moves it, in ml. */
export const WATER_STEP_ML = NUTRITION_TARGET_RANGES.waterMl.step;

/** The smallest and largest a day's water can be stepped to, in ml. */
export const WATER_MIN_ML = NUTRITION_TARGET_RANGES.waterMl.min;
export const WATER_MAX_ML = NUTRITION_TARGET_RANGES.waterMl.max;

/**
 * The same range in fluid ounces, as whole ounces.
 *
 * **A step of its own rather than the millilitre step converted**, which would
 * be 8.45 fl oz and would make every figure on the card a decimal. 8 fl oz is
 * the glass the unit is actually counted in, and the bounds are rounded to it
 * so a press always lands on the grid `CountStepper` steps along. The range
 * covers the same real span the millilitre one does: 8 fl oz is about 237ml and
 * 200 is about 5.9 litres.
 */
export const WATER_STEP_FL_OZ = 8;
export const WATER_MIN_FL_OZ = 8;
export const WATER_MAX_FL_OZ = 200;

/**
 * Whether this entry is the day's water rather than something eaten.
 *
 * **Derived rather than stored, and the derivation is the definition**: an entry
 * filed against nothing, stating water and nothing else, is water. A column
 * would be a migration and a second source of truth for a fact the row already
 * carries.
 *
 * The link test is what keeps it from claiming a real food. A bottled water in
 * the catalog carries an `itemId`, a scanned one a `productId`, and either is a
 * food somebody logged by picking it: it belongs in its meal, and stepping the
 * day's water must not rewrite the row that says which bottle it was. Anything
 * with a second nutrient is a drink rather than water.
 */
export function isWaterEntry(entry: FoodLogEntry): boolean {
  if (entry.recipeId !== null || entry.itemId !== null || entry.productId !== null) return false;
  const stated = NUTRIENT_KEYS.filter(key => entry.nutrition.amounts[key] !== undefined);
  return stated.length === 1 && stated[0] === 'waterMl';
}

/**
 * The day's water entry, or null while there isn't one.
 *
 * The first one, in whatever order the caller holds (the day view's is by
 * instant). A day can end up with two after a sync, since two devices each
 * adding the first glass write their own row, and that is left alone rather
 * than merged: both are real records of water somebody drank, `foodLogTotals`
 * sums them, and the stepper walks the first. Merging them would mean deleting
 * a row and rewriting a Health sample to fix a display detail.
 */
export function waterEntryOf(entries: readonly FoodLogEntry[]): FoodLogEntry | null {
  return entries.find(isWaterEntry) ?? null;
}

/**
 * How much water is stated across a day, in ml, counting every entry.
 *
 * Reads the whole day rather than `waterEntryOf`, because a bottle logged as a
 * catalog food is water somebody drank and the figure against the target has to
 * say so. The stepper is the only thing that cares about the single row.
 */
export function waterTotalMl(entries: readonly FoodLogEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    const stated = entry.nutrition.amounts.waterMl;
    if (typeof stated === 'number' && Number.isFinite(stated) && stated > 0) total += stated;
  }
  return total;
}

/**
 * A volume in the shortest true words: "250 ml", "1.5 L".
 *
 * Litres past a litre, because "1,750 ml" is four glyphs of precision nobody
 * drank to. Trailing zeroes go, so a round figure reads round.
 */
export function describeWaterMl(ml: number): string {
  if (!Number.isFinite(ml)) return '0 ml';
  const rounded = Math.round(ml);
  if (Math.abs(rounded) < 1000) return `${rounded} ml`;
  const litres = Math.round(rounded / 10) / 100;
  return `${litres.toString()} L`;
}

/**
 * The same volume in whichever unit the person picked.
 *
 * Fluid ounces stay whole and stay ounces all the way up: there is no bigger US
 * unit a drink is counted in, and "1.6 quarts" is not how anybody says it.
 */
export function describeWater(ml: number, unit: WaterUnit): string {
  if (unit === 'ml') return describeWaterMl(ml);
  if (!Number.isFinite(ml)) return '0 fl oz';
  return `${Math.round(mlToFlOz(ml))} fl oz`;
}

/** What a stepper in `unit` steps by and between. */
export function waterRange(unit: WaterUnit): { min: number; max: number; step: number } {
  return unit === 'flOz'
    ? { min: WATER_MIN_FL_OZ, max: WATER_MAX_FL_OZ, step: WATER_STEP_FL_OZ }
    : { min: WATER_MIN_ML, max: WATER_MAX_ML, step: WATER_STEP_ML };
}

/**
 * A stored volume as the stepper's own number, or null when there is none.
 *
 * Whole units, because that is what the stepper walks in and a value carrying a
 * decimal would step off the grid on the first press. Reading 1,250 ml as 42
 * fl oz and pressing + writes 1,479 ml rather than 1,487: the round trip is
 * lossy by a few millilitres and is supposed to be, since working in ounces is
 * a choice to count in ounces.
 */
export function waterInUnit(ml: number | null, unit: WaterUnit): number | null {
  if (ml === null || !Number.isFinite(ml) || ml <= 0) return null;
  return unit === 'flOz' ? Math.round(mlToFlOz(ml)) : Math.round(ml);
}

/** The stepper's own number back in millilitres, which is what is stored. */
export function waterToMl(value: number | null, unit: WaterUnit): number {
  if (value === null || !Number.isFinite(value) || value <= 0) return 0;
  return unit === 'flOz' ? Math.round(flOzToMl(value)) : Math.round(value);
}

/**
 * The line under the day's stepper: how the day reads against a target, or what
 * else was drunk, or nothing.
 *
 * **Its own writer rather than `describeAgainstTarget`**, for the reason that
 * function's own callers keep: one module writes both halves of a comparison, so
 * the two can't arrive in different formats. That one renders water in
 * millilitres ("1,500 of 2,000ml") and the stepper beside it says "1.5 L",
 * which is the same figure twice in two shapes on one card — exactly the fault
 * the totals card's note records about a hand-rolled pair.
 *
 * Three answers, and the third is the one worth not losing:
 *
 * - **Nothing, on a day with no water.** A zero against a goal every morning
 *   reads as a scold to somebody who has not drunk anything yet, which is the
 *   call `describeAgainstTarget` already makes for every nutrient.
 * - **The day against the target**, once there is one. The day rather than the
 *   stepper's own row, since a bottle logged as a catalog food is water
 *   somebody drank.
 * - **The day on its own, when something other than the stepper's row states
 *   water and there is no target to measure it against.** Without this, that
 *   bottle would be invisible: the card is the only place water is reported now
 *   that the totals card leaves it out. Withheld when the two agree, because
 *   then the stepper has already said it.
 */
export function describeWaterDay(
  dayMl: number,
  rowMl: number | null,
  target: number | undefined,
  unit: WaterUnit = 'ml',
): string | null {
  if (!(dayMl > 0)) return null;
  if (target !== undefined && target > 0) {
    return `${describeWater(dayMl, unit)} of ${describeWater(target, unit)}`;
  }
  if (dayMl === (rowMl ?? 0)) return null;
  return `${describeWater(dayMl, unit)} today`;
}

/** The three fields a water entry carries that are about the water itself. */
export interface WaterHelping {
  label: string;
  quantity: string;
  nutrition: FoodNutrition;
}

/**
 * What an entry stating `totalMl` of water looks like, or null when there is no
 * volume to state.
 *
 * One function for both directions: the same shape seeds `addEntry`'s draft for
 * the first glass and `reviseEntry`'s patch for every step after it. Two
 * builders would be two chances for the created row and the corrected one to
 * describe themselves differently.
 *
 * **Callers settle the number before calling this.** A held stepper key walks
 * several steps a second, and committing each one would fire a retract and a
 * write at HealthKit per step, each retracting ids the previous write had not
 * finished stamping back. The day view debounces for exactly that reason.
 *
 * Null on a non-positive or non-finite total, which is how the stepper's floor
 * says the day has no water: the caller deletes the row rather than storing a
 * zero, since "drank none" and "did not log" are the same absence everywhere
 * else in this tree and there is no reason for water to disagree.
 */
export function waterHelping(totalMl: number, now: Date = new Date()): WaterHelping | null {
  if (!Number.isFinite(totalMl)) return null;
  const rounded = Math.round(totalMl);
  if (rounded <= 0) return null;

  const said = describeWaterMl(rounded);
  return {
    label: 'Water',
    quantity: said,
    nutrition: {
      basis: 'perServing',
      // No weight, deliberately. A millilitre of water weighs a gram and saying
      // so would be this file inventing a density, which is the one thing
      // `ingredientGrams.ts` refuses to do for every other liquid in the app.
      servingGrams: null,
      servingText: said,
      amounts: { waterMl: rounded } as Partial<Record<NutrientKey, number>>,
      // Typed in, because that is what happened: nobody measured this off a
      // label and no database was asked.
      source: 'manual',
      sourceId: null,
      portions: [],
      recordedAt: now.toISOString(),
    },
  };
}
