import type { FoodLogEntry, MealPlanEntry, MealSlot, NutrientKey } from '../types';
import { NUTRIENT_KEYS } from '../types';
import { foodLogTotals } from './foodLog';
import type { SlotCoverage } from './mealLogCoverage';

type Amounts = Partial<Record<NutrientKey, number>>;

/** A planned day's figures, and how many planned meals couldn't be counted. */
export interface PlannedDayNutrition {
  totals: Amounts;
  /** Planned meals still to eat with no figures to add (no recipe, or one the rollup refused). */
  uncounted: number;
}

/**
 * What a day on the meal plan adds up to: what the food log already has for it,
 * plus one helping of each planned meal in a slot nothing has been logged in
 * yet.
 *
 * **A slot with anything logged counts the log, never the plan**, which is the
 * (day, slot) join `mealLogCoverage.ts` already makes for "Logged" on the row:
 * the lunch typed straight into the food log is the lunch that was eaten,
 * whatever the plan said. One helping is `mealHelping`'s own default, the
 * person's serving where the recipe states servings and the whole dish where
 * it doesn't. A meal with no figures is counted rather than guessed, so the
 * caller can say the total leaves it out.
 */
export function plannedDayNutrition(
  coverage: ReadonlyMap<MealSlot, SlotCoverage> | undefined,
  loggedOnDay: readonly FoodLogEntry[],
  helpingFor: (entry: MealPlanEntry) => Amounts | null,
): PlannedDayNutrition {
  const totals: Amounts = { ...foodLogTotals([...loggedOnDay]).total };
  let uncounted = 0;
  for (const slot of coverage?.values() ?? []) {
    if (slot.logged.length > 0) continue;
    for (const entry of slot.planned) {
      const helping = helpingFor(entry);
      if (!helping) { uncounted += 1; continue; }
      for (const key of NUTRIENT_KEYS) {
        const amount = helping[key];
        if (amount !== undefined) totals[key] = (totals[key] ?? 0) + amount;
      }
    }
  }
  return { totals, uncounted };
}
