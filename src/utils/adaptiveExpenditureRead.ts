/**
 * The measured expenditure as of now, from what is on the device: the food log
 * read from the database, and a weight series the caller already holds (Health
 * is never read here, and nothing is stored). A thin wrapper so the two callers
 * that keep the calorie target in step, and the weight goal sheet, read the
 * window the same way. The arithmetic and its refusals are
 * `adaptiveExpenditure.ts`.
 */
import { useFoodLogStore } from '../store/useFoodLogStore';
import { dayKeyOf, getCurrentDayStart, getLogicalDayKey } from './dateUtils';
import { foodDayInputs } from './nutritionStats';
import { EXPENDITURE_WINDOW_DAYS, measuredExpenditure, type ExpenditureResult } from './adaptiveExpenditure';
import type { WeightPoint } from './weightLog';

export function readMeasuredExpenditure(weights: readonly WeightPoint[]): ExpenditureResult {
  const todayKey = getLogicalDayKey(new Date());
  const from = new Date(getCurrentDayStart());
  from.setDate(from.getDate() - EXPENDITURE_WINDOW_DAYS);
  const entries = useFoodLogStore.getState().entriesSince(dayKeyOf(from));
  const intake = foodDayInputs(entries).map(day => ({ dayKey: day.dayKey, calorieKcal: day.nutrients.calorieKcal }));
  return measuredExpenditure(intake, weights, todayKey);
}

/** The figure to hand the target sync: the measured kcal, or null while there isn't one. */
export function measuredMaintenanceKcal(weights: readonly WeightPoint[]): number | null {
  const result = readMeasuredExpenditure(weights);
  return result.kind === 'measured' ? result.kcal : null;
}
