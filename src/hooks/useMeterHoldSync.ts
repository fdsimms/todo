import { useEffect } from 'react';
import { useTaskStore } from '../store/useTaskStore';
import { useMeterReadingStore } from '../store/useMeterReadingStore';

/** The part of a task `applyMeterHolds` reads, so a change to anything else is not a reason to run it. */
function meterSignature(tasks: ReturnType<typeof useTaskStore.getState>['tasks']): string {
  return tasks
    .filter(t => t.meterName && !t.completed && !t.archived)
    .map(t => `${t.id}:${t.meterName}:${t.meterEvery}:${t.meterDueAt}:${t.meterLimitMonths ?? ''}:${t.deferUntil ?? ''}`)
    .join('|');
}

/**
 * Re-runs `applyMeterHolds` when its inputs change: a reading is logged (or
 * arrives by sync), or a task is saved following a meter, including the
 * successor a completion writes. The same shape as `useWeatherWaitSync`, and
 * a hook for the same reason: the reading store can't import the task store
 * that already imports it. The pass is idempotent, so its own write coming
 * back through the task subscription settles on the second look.
 */
export function useMeterHoldSync(): void {
  useEffect(() => {
    const apply = () => useTaskStore.getState().applyMeterHolds();
    apply();

    const unsubscribeReadings = useMeterReadingStore.subscribe((state, prev) => {
      if (state.readings !== prev.readings) apply();
    });

    let signature = meterSignature(useTaskStore.getState().tasks);
    const unsubscribeTasks = useTaskStore.subscribe((state, prev) => {
      if (state.tasks === prev.tasks) return;
      const next = meterSignature(state.tasks);
      if (next === signature) return;
      signature = next;
      apply();
    });

    return () => {
      unsubscribeReadings();
      unsubscribeTasks();
    };
  }, []);
}
