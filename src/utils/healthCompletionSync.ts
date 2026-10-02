import type { NutrientKey, Task } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { isDemoModeActive } from './demoState';
import { dbGetFoodLogEntries } from '../db/database';
import { getLogicalDayKey } from './dateUtils';
import { nutrientHelping, nutrientOnlyEntryOf } from './nutrientLog';

/**
 * Logs a nutrient when a task that opted into it completes — the write mirror
 * of `logTaskCompletionToCalendar` (`completionCalendarSync.ts`), which this
 * deliberately matches in shape.
 *
 * A task names which `NutrientKey` it logs and how much. **Every nutrient goes
 * through the food log**, as one entry per nutrient per day that states that
 * nutrient and nothing else (`nutrientLog.ts`), so a sodium or caffeine task
 * shows up in the day's totals, against the targets and in the insights, and
 * not only in Apple Health. Water has always done this; it was the one nutrient
 * with a food-log home to reuse, and the others got one by generalizing it
 * rather than by a second mechanism. The Health write happens where every food
 * log entry's does (`addEntry`/`reviseEntry` in `useFoodLogStore`, through
 * `logFoodEntryToHealth`), so this never calls `writeNutrientSample` and never
 * double-writes. That path honors `healthWriteNutrients`, so a nutrient the
 * person chose not to write to Health still lands in the food log.
 *
 * Accumulates onto whatever the day already holds, the way a second glass
 * steps the stepper's own row up, so a task completed twice in a day adds up
 * rather than overwriting.
 *
 * **The caller must only invoke this once per real event** — at the moment a
 * plain task is actually marked completed, or at the moment a quota task logs
 * one unit toward its target (`logQuotaUnit` in `useTaskStore.ts`, which calls
 * this on every unit, so a quota's food log total moves with each tap rather
 * than jumping once at the end). It does not check for an existing completion,
 * so calling it from a save or an edit would log an amount nobody recorded.
 *
 * **Undoing a quota tap takes the unit back** (`unlogTaskNutrientFromFoodLog`),
 * since there is a food-log row to correct. A plain task's completion has no
 * undo here, as before.
 *
 * **Water's connection runs the other way too.** `useTaskStore`'s
 * `syncWaterQuotaTasks` is the log-to-task half, called from
 * `useFoodLogStore`'s own `addEntry`/`reviseEntry`/`removeEntry` whenever
 * today's water changes for any reason, and reconciles a daily water-quota
 * task's `progressCount` to the food log's total. Only water has that half:
 * other nutrients aren't a count of identical units a day's log can finish.
 */
export async function logTaskHealthValue(task: Task): Promise<boolean> {
  // Same guard every device write in this app makes — demo-seeded fiction
  // must never reach a real device's real Health record. Sharper here than
  // for a read: a leaked read shows a true number in a fictional context, but
  // this would put a fake completion's amount into somebody's actual record.
  if (isDemoModeActive()) return false;

  const { healthWriteEnabled } = useSettingsStore.getState();

  // Off, or the task never asked for it — nothing to write. logHealthMetric
  // and logHealthAmount are a metric-plus-amount pair rather than a plain
  // boolean, so a task that isn't logging reads as null/null here and both
  // mean the same thing: don't write.
  if (!healthWriteEnabled || !task.logHealthMetric || !task.logHealthAmount || task.logHealthAmount <= 0) {
    return false;
  }

  return logTaskNutrientToFoodLog(
    task.logHealthMetric,
    task.logHealthAmount,
    task.completedAt ? new Date(task.completedAt) : new Date(),
  );
}

/**
 * Adds a task's amount onto today's food log entry for that nutrient, rather
 * than writing a second Health sample beside it. Creates the entry on the
 * day's first one.
 */
function logTaskNutrientToFoodLog(key: NutrientKey, amount: number, at: Date): boolean {
  const dayKey = getLogicalDayKey(at);
  const existing = nutrientOnlyEntryOf(dbGetFoodLogEntries(dayKey, dayKey), key);
  const total = (existing?.nutrition.amounts[key] ?? 0) + amount;
  const built = nutrientHelping(key, total, at);
  if (!built) return false;

  const { addEntry, reviseEntry } = useFoodLogStore.getState();
  if (existing) {
    reviseEntry(existing.id, built);
  } else {
    addEntry({
      ...built,
      grams: null,
      slot: null,
      recipeId: null,
      itemId: null,
      productId: null,
      mealPlanEntryId: null,
      at,
    });
  }
  return true;
}

/**
 * Takes one logged unit's worth of a nutrient back off today's food log entry
 * — the mirror of `logTaskNutrientToFoodLog`, called from `unlogQuotaUnit`
 * when a quota task's tap is undone.
 *
 * Left unfixed, an undone tap would decrement the task's `progressCount` while
 * the food log kept the amount it had already logged (and, for water,
 * `syncWaterQuotaTasks` would read that unchanged total back and bump
 * `progressCount` up again, undoing the undo).
 *
 * Deletes the row outright once the total would fall to zero or below,
 * matching `nutrientHelping`'s own "delete rather than store a zero" contract.
 */
export function unlogTaskNutrientFromFoodLog(key: NutrientKey, amount: number, at: Date): void {
  // Gated as the log is: with the switch off the tap never logged anything, and
  // an undo must not take the person's own entry down by that amount.
  if (isDemoModeActive() || !useSettingsStore.getState().healthWriteEnabled) return;
  const dayKey = getLogicalDayKey(at);
  const existing = nutrientOnlyEntryOf(dbGetFoodLogEntries(dayKey, dayKey), key);
  if (!existing) return;
  const total = (existing.nutrition.amounts[key] ?? 0) - amount;
  const built = nutrientHelping(key, total, at);
  const { reviseEntry, removeEntry } = useFoodLogStore.getState();
  if (!built) {
    removeEntry(existing.id);
    return;
  }
  reviseEntry(existing.id, built);
}
