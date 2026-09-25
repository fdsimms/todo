import type { Task } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useFoodLogStore } from '../store/useFoodLogStore';
import { isDemoModeActive } from './demoState';
import { healthBridge } from './healthBridge';
import { dbGetFoodLogEntries } from '../db/database';
import { getLogicalDayKey } from './dateUtils';
import { waterEntryOf, waterHelping } from './waterLog';

/**
 * Writes a nutrient sample to Apple Health when a task that opted into it
 * completes — the write mirror of `logTaskCompletionToCalendar`
 * (`completionCalendarSync.ts`), which this deliberately matches in shape.
 *
 * Generalized from a water-only write (`logTaskWaterToHealth`, this
 * function's predecessor): a task now names which `NutrientKey` it logs and
 * how much, rather than always logging dietary water. Every nutrient it can
 * name is already one `writeFoodSamples` (the food-log write) has a share
 * type for, so this reuses that same table on the native side
 * (`writeNutrientSample`) rather than adding a second one.
 *
 * Same one-shot-per-call reasoning as the completion-calendar write's: a
 * logged amount is a historical record of something that already happened,
 * not a mirror of a task's current state to keep in sync, so there is no
 * update or delete counterpart. **The caller must only invoke this once per
 * real event** — at the moment a plain task is actually marked completed, or
 * at the moment a quota task logs one unit toward its target (`logQuotaUnit`
 * in `useTaskStore.ts`, which calls this on every unit rather than only the
 * one that reaches the target, so a water quota's food log total moves with
 * each glass instead of jumping once at the end) — it does not check for an
 * existing sample, so calling it from anywhere else (a save, an edit) would
 * log an amount nobody actually recorded.
 *
 * Unlike the calendar write, there is no id to remember afterward: a food
 * sample has no per-task identity worth keeping — Health itself is the
 * record — the same reasoning the old water write had, for every nutrient
 * except water itself (see `logTaskWaterToFoodLog` below).
 *
 * **The water connection runs the other way too.** `logTaskWaterToFoodLog`
 * and `unlogTaskWaterFromFoodLog` are the task-to-log half; `useTaskStore`'s
 * `syncWaterQuotaTasks` is the log-to-task half, called from
 * `useFoodLogStore`'s own `addEntry`/`reviseEntry`/`removeEntry` whenever
 * today's water changes for any reason — the day view's stepper, a bottled
 * water logged as food, an edit or delete in the Logbook. It reconciles a
 * daily water-quota task's `progressCount` to whatever the food log's actual
 * total now says, and completes the task outright once that total reaches
 * the target, exactly as if the last tap had been on the task itself. See
 * that function's own comment for why the two directions can't both write —
 * only one of them may touch the food log at a time, or they'd fight.
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

  // Water is the one metric the food log already owns a write for. Routing
  // it there instead of straight to Health is what makes a water-logging
  // task show up in the food log at all — see the function's own comment.
  if (task.logHealthMetric === 'waterMl') {
    return logTaskWaterToFoodLog(task.logHealthAmount, task.completedAt ? new Date(task.completedAt) : new Date());
  }

  const bridge = healthBridge();
  if (!bridge) return false;

  return bridge.writeNutrientSample(task.logHealthMetric, task.logHealthAmount);
}

/**
 * Adds a completed water task's amount onto today's food log water entry,
 * rather than writing a second Health sample beside it.
 *
 * Every other metric here writes straight to Health with no food-log
 * counterpart, because there isn't one to reuse — but water already has one
 * (`waterLog.ts`'s day-view stepper), and `docs/arch/health-data.md` used to
 * argue for keeping the two apart entirely: a task recording a nutrient on
 * completion, and somebody saying what they drank, treated as two different
 * facts. In practice that meant a water task could tick itself off forever
 * without the food log ever showing a drop, which is confusing enough on its
 * own to be worth folding the two together for water specifically, while
 * every other nutrient (caffeine, protein, …) still writes to Health only —
 * a caffeine task still has no business becoming a "meal".
 *
 * Accumulates onto whatever the day already holds, the same way a second
 * glass steps the stepper's own row up rather than replacing it, so a task
 * ticked twice in a day adds up rather than overwriting. The actual Health
 * write happens exactly where every other food log entry's does —
 * `addEntry`/`reviseEntry` in `useFoodLogStore`, via `logFoodEntryToHealth`
 * — so this never calls `writeNutrientSample` and never double-writes.
 */
function logTaskWaterToFoodLog(amountMl: number, at: Date): boolean {
  const dayKey = getLogicalDayKey(at);
  const existing = waterEntryOf(dbGetFoodLogEntries(dayKey, dayKey));
  const totalMl = (existing?.nutrition.amounts.waterMl ?? 0) + amountMl;
  const built = waterHelping(totalMl, at);
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
 * Takes one logged unit's worth of water back off today's food log entry —
 * the mirror of `logTaskWaterToFoodLog`, called from `unlogQuotaUnit` when a
 * water-quota task's tap is undone.
 *
 * Water is the one metric a task's logging can be undone at all (see
 * `Task.medicationName`'s own undo for the only other one), because it's the
 * one metric that already has a food-log row to correct rather than a
 * one-shot Health sample with nothing to retract. Left unfixed, an undone tap
 * would decrement the task's `progressCount` while the food log kept the
 * amount it had already logged — and `syncWaterQuotaTasks` would read that
 * unchanged total back and immediately bump `progressCount` up again, undoing
 * the undo.
 *
 * Deletes the row outright once the total would fall to zero or below,
 * matching `waterHelping`'s own "delete rather than store a zero" contract.
 */
export function unlogTaskWaterFromFoodLog(amountMl: number, at: Date): void {
  const dayKey = getLogicalDayKey(at);
  const existing = waterEntryOf(dbGetFoodLogEntries(dayKey, dayKey));
  if (!existing) return;
  const totalMl = (existing.nutrition.amounts.waterMl ?? 0) - amountMl;
  const built = waterHelping(totalMl, at);
  const { reviseEntry, removeEntry } = useFoodLogStore.getState();
  if (!built) {
    removeEntry(existing.id);
    return;
  }
  reviseEntry(existing.id, built);
}
