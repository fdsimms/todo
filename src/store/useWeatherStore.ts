import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import { getCurrentLocation } from '../utils/weatherLocation';
import { fetchWeatherSnapshot, type WeatherSnapshot } from '../services/weatherLookup';
import { isDemoModeActive } from '../utils/demoState';
import { useSettingsStore } from './useSettingsStore';

/**
 * Today's weather, held in memory — the weather-generator equivalent of
 * `useCalendarStore`'s rolling window, and for the identical reason: it's
 * another service's answer to "what is it doing outside", not this app's own
 * data, so there is no table and no migration. `checkWeatherTasks`
 * (`useTaskStore.ts`) only ever reads whatever is here; this store owns
 * getting it there.
 */

interface WeatherState {
  snapshot: WeatherSnapshot | null;
  /** The logical day `snapshot` was read for — a stale reading from before a
   * day-roll must not be read as an answer for today. */
  snapshotDayKey: string | null;
  refreshing: boolean;
  /** Reads a fresh snapshot if today doesn't have one yet and nothing else is already fetching. */
  refresh: () => Promise<void>;
  clear: () => void;
}

export const useWeatherStore = create<WeatherState>((set, get) => ({
  snapshot: null,
  snapshotDayKey: null,
  refreshing: false,

  async refresh() {
    if (isDemoModeActive()) return;
    if (get().refreshing) return;
    const todayKey = dayKeyOf(getCurrentDayStart());
    if (get().snapshotDayKey === todayKey) return;
    set({ refreshing: true });
    try {
      // Never requests permission — see getCurrentLocation. A refresh that
      // finds nothing granted simply leaves today without a snapshot, the
      // same "no event here is persisted" shrug useCalendarStore makes of an
      // unread window.
      const location = await getCurrentLocation();
      if (!location) return;
      const snapshot = await fetchWeatherSnapshot(location);
      if (!snapshot) return;
      set({ snapshot, snapshotDayKey: todayKey });
    } finally {
      set({ refreshing: false });
    }
  },

  clear() {
    set({ snapshot: null, snapshotDayKey: null });
  },
}));

/**
 * Keeps today's snapshot current. Call once from the root component — same
 * three triggers `useCalendarSync` settled on, for the same reason: there's
 * no OS-side change notification for "the weather changed" either.
 */
export function useWeatherSync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    if (useSettingsStore.getState().initialized) {
      if (useSettingsStore.getState().weatherTasks) useWeatherStore.getState().refresh();
    }

    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (
        state.initialized !== prev.initialized ||
        state.weatherTasks !== prev.weatherTasks ||
        // The snapshot is anchored to the logical day, so moving the reset
        // moves which day "today" is — same reason useCalendarSync watches it.
        state.dayResetTime !== prev.dayResetTime
      ) {
        if (state.weatherTasks) useWeatherStore.getState().refresh();
        else useWeatherStore.getState().clear();
      }
    });

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && useSettingsStore.getState().weatherTasks) {
        useWeatherStore.getState().refresh();
      }
    });

    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);
}
