import { useProjectLockStore } from '../store/useProjectLockStore';
import { useNfcKeyStore } from '../store/useNfcKeyStore';
import { useAppGroupStore } from '../store/useAppGroupStore';
import { useShieldReleaseStore } from '../store/useShieldReleaseStore';
import { useManualBlockStore } from '../store/useManualBlockStore';
import { useBlockTimerStore } from '../store/useBlockTimerStore';

/**
 * The stores that load from their own settings row rather than in the task
 * store's fan-out, as named launch steps. `AppGate` (App.tsx) runs them on a
 * launch with a screen, and `openStoresIfClosed` (backgroundRefresh.ts) on a
 * cold background launch, from this one list so the two can't drift.
 *
 * They drifted once, and it is the reason this list exists. The background run
 * loaded only tasks and settings, then reconciled the app shield and wrote the
 * widget from the rest as they stood unloaded: no schedules, no key lock, no
 * timed block, no locked projects. A daytime refresh lifted a schedule's block
 * halfway through its window and disarmed every schedule until the app was next
 * opened, and the widget showed tasks from locked projects.
 *
 * Every entry is a plain read of the database, safe with the app closed. A
 * store whose load reaches past SQLite (the alarms, which also write to the
 * device) is not one of these; it loads itself where it is needed.
 */
export const STANDALONE_STORE_LOADS: ReadonlyArray<[string, () => void]> = [
  ['load project locks', () => useProjectLockStore.getState().initialize()],
  ['load key tags', () => useNfcKeyStore.getState().initialize()],
  ['load app groups and schedules', () => useAppGroupStore.getState().initialize()],
  ['load released blocks', () => useShieldReleaseStore.getState().initialize()],
  ['load timed block', () => useManualBlockStore.getState().initialize()],
  ['load block timer', () => useBlockTimerStore.getState().initialize()],
];
