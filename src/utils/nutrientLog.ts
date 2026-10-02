import type { FoodLogEntry, FoodNutrition, NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';
import { NUTRIENT_LABEL } from './foodNutrition';
import { waterHelping } from './waterLog';

/**
 * A single nutrient logged on its own, as one food log entry.
 *
 * **The generalization of `waterLog.ts`'s day entry.** A task that logs sodium
 * or caffeine to Health used to write Apple Health only, so the figure was in
 * the record and missing from the food log's day totals, targets and
 * insights. Water already rode the food log for this reason; every other
 * nutrient a task can log now does too, as an entry that states that one
 * nutrient and nothing else.
 *
 * **One entry per nutrient per day, stepped up and down**, which is the water
 * entry's rule for the same reason: a daily caffeine task ticked four times is
 * one row reading 400 mg, not four rows in the diary. The Health write goes
 * through the ordinary food log path (`addEntry`/`reviseEntry`), so nothing
 * here calls the bridge and a sample is never written twice.
 *
 * **Derived rather than stored**, same as `isWaterEntry`: an entry filed
 * against nothing, wearing its nutrient's own name and stating only that
 * nutrient, is one of these (see `nutrientOnlyKey` for why the name is part
 * of the test). It is
 * never a meal, never a food and never the reason another nutrient's figure is
 * judged incomplete, and `isNutrientOnlyEntry` is what the readers that say so
 * ask.
 */

/** Whether this entry is a nutrient logged on its own rather than a food. */
export function isNutrientOnlyEntry(entry: FoodLogEntry): boolean {
  return nutrientOnlyKey(entry) !== null;
}

/**
 * The one nutrient a nutrient-only entry states, or null for any other entry.
 *
 * **Water is recognized by what it states** (`isWaterEntry`), as it always has
 * been. **Every other nutrient also has to wear the label this module writes
 * and be unslotted**, because stating one figure is not enough on its own: a
 * restaurant meal estimated as "Chicken breast, 600 cal" states exactly one
 * nutrient and is a food, and treating it as a supplement would drop it from
 * meal coverage, the averages and the recents. A label that is the nutrient's
 * own name ("Sodium") on an unslotted, unlinked entry is what a task writes and
 * what nobody logging a meal types.
 */
export function nutrientOnlyKey(entry: FoodLogEntry): NutrientKey | null {
  if (entry.recipeId !== null || entry.itemId !== null || entry.productId !== null) return null;
  const stated = NUTRIENT_KEYS.filter(key => entry.nutrition.amounts[key] !== undefined);
  if (stated.length !== 1) return null;
  const key = stated[0];
  if (key === 'waterMl') return key;
  return entry.slot === null && entry.label === NUTRIENT_LABEL[key].label ? key : null;
}

/** The entry a task's logging steps for `key`, or null while the day has none. */
export function nutrientOnlyEntryOf(entries: readonly FoodLogEntry[], key: NutrientKey): FoodLogEntry | null {
  return entries.find(entry => nutrientOnlyKey(entry) === key) ?? null;
}

/** The three fields a nutrient-only entry carries that are about the nutrient. */
export interface NutrientHelping {
  label: string;
  quantity: string;
  nutrition: FoodNutrition;
}

/**
 * What an entry stating `total` of `key` looks like, or null when there is
 * nothing to state. Null on a non-positive or non-finite total, which is how a
 * step-down to zero says the entry should go rather than be stored as a zero.
 *
 * Water keeps its own wording through `waterHelping`.
 */
export function nutrientHelping(key: NutrientKey, total: number, now: Date = new Date()): NutrientHelping | null {
  if (key === 'waterMl') return waterHelping(total, now);
  if (!Number.isFinite(total)) return null;
  const rounded = Math.round(total * 10) / 10;
  if (rounded <= 0) return null;

  const { label, unit } = NUTRIENT_LABEL[key];
  const said = `${rounded} ${unit}`;
  return {
    label,
    quantity: said,
    nutrition: {
      basis: 'perServing',
      servingGrams: null,
      servingText: said,
      amounts: { [key]: rounded } as Partial<Record<NutrientKey, number>>,
      source: 'manual',
      sourceId: null,
      portions: [],
      recordedAt: now.toISOString(),
    },
  };
}
