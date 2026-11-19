import { useEffect } from 'react';
import { checkOnCallSwapTasks } from '../store/onCallSwapSweep';
import { useOnCallStore } from '../store/useOnCallStore';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * Runs the on-call swap sweep when the on-call read lands or changes, and when its
 * settings do. Call once from the root component, beside `useOnCallSync`.
 *
 * A hook rather than a call in `useOnCallStore` because the sweep reads settings
 * and writes tasks, and the store is read by the task editor that sweep feeds.
 * Over-firing is cheap: a handled record stops a task being written twice, and the
 * sweep returns at once while the setting is off.
 */
export function useOnCallSwapSync(): void {
  useEffect(() => {
    checkOnCallSwapTasks();
    const unsubscribeOnCall = useOnCallStore.subscribe((state, prev) => {
      if (state.conflicts !== prev.conflicts || state.loaded !== prev.loaded) checkOnCallSwapTasks();
    });
    const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      if (
        state.onCallSwapTasks !== prev.onCallSwapTasks
        || state.onCallSwapTaskCategory !== prev.onCallSwapTaskCategory
      ) {
        checkOnCallSwapTasks();
      }
    });
    return () => {
      unsubscribeOnCall();
      unsubscribeSettings();
    };
  }, []);
}
