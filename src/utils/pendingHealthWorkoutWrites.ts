import { AppState } from 'react-native';
import { useWorkoutStore } from '../store/useWorkoutStore';

/**
 * Writes the workouts an agent logged over MCP to Apple Health, from the phone.
 *
 * `runPendingHealthFoodWrites` for sessions, run beside it after a sync that
 * applied rows, which is when a flagged session can have arrived. The rules
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
