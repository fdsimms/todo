import { useEffect } from 'react';
import { useTaskStore } from '../store/useTaskStore';
import { useWeatherStore } from '../store/useWeatherStore';

/** The part of a task `applyWeatherWaits` reads, so a change to anything else is not a reason to run it. */
function waitSignature(tasks: ReturnType<typeof useTaskStore.getState>['tasks']): string {
  return tasks
    .filter(t => t.weatherWait)
    .map(t => `${t.id}:${t.weatherWait}:${t.deferUntil ?? ''}:${t.dueDate ?? ''}`)
    .join('|');
}

/**
 * Re-runs `applyWeatherWaits` when its inputs change: a forecast lands (the
 * maintenance pass usually runs before the fetch resolves), or a task is saved
 * waiting on weather. Lives in a hook rather than in `useWeatherStore` because
 * the task store already imports that one, and the pass is idempotent, so the
 * write it makes coming back through the task subscription settles on the
 * second look.
 */
export function useWeatherWaitSync(): void {
  useEffect(() => {
    const apply = () => useTaskStore.getState().applyWeatherWaits();
    apply();

    const unsubscribeWeather = useWeatherStore.subscribe((state, prev) => {
      if (state.snapshot !== prev.snapshot) apply();
    });

    let signature = waitSignature(useTaskStore.getState().tasks);
    const unsubscribeTasks = useTaskStore.subscribe(state => {
      const next = waitSignature(state.tasks);
      if (next === signature) return;
      signature = next;
      apply();
    });

    return () => {
      unsubscribeWeather();
      unsubscribeTasks();
    };
  }, []);
}
