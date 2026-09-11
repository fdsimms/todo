import type { Task } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { isDemoModeActive } from './demoState';
import { healthBridge } from './healthBridge';

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
 * Same one-shot reasoning as the completion-calendar write's: a logged
 * amount is a historical record of something that already happened, not a
 * mirror of a task's current state to keep in sync, so there is no update or
 * delete counterpart. **The caller must only invoke this once, at the moment
 * a task is actually marked completed** — it does not check for an existing
 * sample, so calling it from anywhere else (a save, an edit) would log an
 * amount nobody actually recorded.
 *
 * Unlike the calendar write, there is no id to remember afterward: a food
 * sample has no per-task identity worth keeping — Health itself is the
 * record — the same reasoning the old water write had.
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

  const bridge = healthBridge();
  if (!bridge) return false;

  return bridge.writeNutrientSample(task.logHealthMetric, task.logHealthAmount);
}
