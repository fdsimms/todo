import { AppState } from 'react-native';
import { useFoodLogStore } from '../store/useFoodLogStore';

/**
 * Writes the meals an agent logged over MCP to Apple Health, from the phone.
 *
 * The rules are `pendingWriteAction` (`healthFoodSync.ts`) and
 * `writePendingHealthEntries` (`useFoodLogStore`); this only decides when to
 * ask. Runs at launch, whenever the app comes to the front, and after a sync
 * that applied rows, which is when a flagged entry can have arrived.
 *
 * **Only while the app is in front.** A background sync reloads the stores too,
 * but HealthKit refuses a write while the phone is locked, and a refusal there
 * would raise the "Health is not accepting meals" notice over a failure that
 * is only the lock. The entry stays flagged and the next foreground writes it.
 */
export function runPendingHealthFoodWrites(): void {
  if (AppState.currentState !== 'active') return;
  void useFoodLogStore.getState().writePendingHealthEntries();
}
