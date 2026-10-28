import { AppState } from 'react-native';
import { useWorkoutStore } from '../store/useWorkoutStore';

/**
 * Writes the workouts waiting for Apple Health (`healthWritePending`) from the
 * phone: one an agent logged over MCP, one described and confirmed, one the
 * Apple Watch was measuring whose own copy never came, and a finish applied in
 * the background, where HealthKit can't be written.
 *
 * `runPendingHealthFoodWrites` for sessions, run exactly where it runs: at
 * launch, whenever the app comes to the front, and after a sync that applied
 * rows, which is when a flagged session can have arrived. The rules
 * are `pendingWorkoutWriteAction` (`healthWorkoutSync.ts`) and
 * `writePendingHealthSessions` (`useWorkoutStore`); this only decides when.
 *
 * **Only while the app is in front**, for the food log's reason: HealthKit
 * refuses a write while the phone is locked, and a refusal there would raise
 * the "workouts are not reaching Health" notice over a failure that is only
 * the lock. The session stays flagged and the next foreground writes it.
 */
export function runPendingHealthWorkoutWrites(): void {
  if (AppState.currentState !== 'active') return;
  void useWorkoutStore.getState().writePendingHealthSessions();
}
