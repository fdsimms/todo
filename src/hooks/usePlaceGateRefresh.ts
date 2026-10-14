import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useTaskStore } from '../store/useTaskStore';
import { rebuildNotificationQueue } from '../utils/maintenancePasses';
import { placeIdAt, placeLimitedTasks, writePlaceFix } from '../utils/placeGate';
import { readSavedPlaces } from '../utils/savedPlaces';
import { getCurrentLocation } from '../utils/weatherLocation';

/**
 * Keeps the fix that `placeGate.ts` schedules against current. Call once from
 * the root component.
 *
 * Reads the location when the app comes to the foreground (and once when the
 * task store loads), and only when a task's reminders are limited to places:
 * nothing else in the app is changed by this, and no place-limited task means
 * no read at all. Foreground only, since the app promises it never reads
 * location in the background. After a read it rebuilds the notification queue,
 * so arriving at a place starts the reminders and a fix away from every place
 * clears them.
 *
 * A read that fails (no permission, demo mode, no fix) stores nothing, so the
 * previous fix simply ages out under `PLACE_FIX_TTL_MS` rather than being
 * overwritten by a guess.
 */
export function usePlaceGateRefresh(): void {
  useEffect(() => {
    let reading = false;

    const refresh = async () => {
      const { initialized, tasks } = useTaskStore.getState();
      if (!initialized || reading || placeLimitedTasks(tasks).length === 0) return;
      reading = true;
      try {
        const fix = await getCurrentLocation({ accuracy: 'balanced' });
        if (!fix) return;
        writePlaceFix({ placeId: placeIdAt(readSavedPlaces(), { ...fix, accuracyM: fix.accuracyM ?? null }), at: Date.now() });
        rebuildNotificationQueue();
      } finally {
        reading = false;
      }
    };

    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    const unsubscribeTasks = useTaskStore.subscribe((state, prev) => {
      if (state.initialized && !prev.initialized) refresh();
    });
    refresh();

    return () => {
      appState.remove();
      unsubscribeTasks();
    };
  }, []);
}
