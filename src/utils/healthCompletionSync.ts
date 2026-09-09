import type { Task } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { isDemoModeActive } from './demoState';
import { healthBridge } from './healthBridge';

/**
 * Writes a dietary-water sample to Apple Health when a task that opted into
 * it completes — the write mirror of `logTaskCompletionToCalendar`
 * (`completionCalendarSync.ts`), which this deliberately matches in shape.
 *
 * Same one-shot reasoning as that file's: a logged drink is a historical
 * record of something that already happened, not a mirror of a task's
 * current state to keep in sync, so there is no update or delete
 * counterpart. **The caller must only invoke this once, at the moment a task
 * is actually marked completed** — it does not check for an existing sample,
 * so calling it from anywhere else (a save, an edit) would log water nobody
 * drank.
 *
 * Unlike the calendar write, there is no id to remember afterward:
 * `completionCalendarEventId` exists because a calendar event can be found
 * and (in principle) inspected again, but a `dietaryWater` sample has no
 * per-task identity worth keeping — Health itself is the record.
 */
export async function logTaskWaterToHealth(task: Task): Promise<boolean> {
  // Same guard every device write in this app makes — demo-seeded fiction
  // must never reach a real device's real Health record. Sharper here than
  // for a read: a leaked read shows a true number in a fictional context, but
  // this would put a fake completion's water into somebody's actual record.
  if (isDemoModeActive()) return false;

  const { healthWriteEnabled } = useSettingsStore.getState();

  // Off, or the task never asked for it — nothing to write. logWaterMl is a
  // number rather than a boolean-plus-amount pair (see Task.logWaterMl), so
  // a task that isn't logging reads as null/0 here and both mean the same
  // thing: don't write.
  if (!healthWriteEnabled || !task.logWaterMl || task.logWaterMl <= 0) return false;

  const bridge = healthBridge();
  if (!bridge) return false;

  return bridge.writeWaterSample(task.logWaterMl);
}
