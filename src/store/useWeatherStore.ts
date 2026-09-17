import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import { getCurrentLocation } from '../utils/weatherLocation';
import { fetchWeatherSnapshot, type WeatherSnapshot } from '../services/weatherLookup';
import { isDemoModeActive } from '../utils/demoState';
import { useSettingsStore } from './useSettingsStore';
import { createRefreshGuard } from '../utils/refreshGuard';

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
  /** Reads a fresh snapshot if the one held is stale or missing, and nothing else is already fetching. */
  refresh: () => Promise<void>;
  clear: () => void;
}

/**
 * How old a snapshot may be before the next trigger replaces it.
 *
 * This used to be a whole day: one read, usually at the first open, and
 * nothing after it. That was enough while the snapshot only had to answer
 * "is it rainy today", which a morning reading settles. It isn't enough now a
 * task says *when* — a forecast that moves the rain from 2pm to 4pm leaves a
 * row asserting 2pm all day, and a wrong specific time is worse than the
 * vague one it replaced.
 *
 * It is still not a poll. The three triggers are unchanged (mount, a relevant
 * settings change, foreground), so this only decides whether a trigger that
 * was going to happen anyway does anything — an app opened once a day still
 * fetches once a day.
 */
const SNAPSHOT_STALE_MS = 60 * 60 * 1000;

// One read, so one guard. See refreshGuard.ts: the snapshot must not be
// written back after the feature was switched off mid-fetch.
const snapshotGuard = createRefreshGuard();

/**
 * Whether the held snapshot is old enough to replace. A `fetchedAt` that
 * doesn't parse reads as stale rather than as fresh: refetching costs one
 * request, where trusting it would strand the reading for the rest of the day.
 */
function isSnapshotStale(snapshot: WeatherSnapshot | null): boolean {
  if (!snapshot) return true;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (Number.isNaN(fetchedAt)) return true;
  return Date.now() - fetchedAt >= SNAPSHOT_STALE_MS;
}

export const useWeatherStore = create<WeatherState>((set, get) => ({
  snapshot: null,
  snapshotDayKey: null,
  refreshing: false,

  async refresh() {
    if (isDemoModeActive()) return;
    if (get().refreshing) return;
    const todayKey = dayKeyOf(getCurrentDayStart());
    if (get().snapshotDayKey === todayKey && !isSnapshotStale(get().snapshot)) return;
    set({ refreshing: true });
    const token = snapshotGuard.begin();
    try {
      // Never requests permission — see getCurrentLocation. A refresh that
      // finds nothing granted simply leaves today without a snapshot, the
      // same "no event here is persisted" shrug useCalendarStore makes of an
      // unread window.
      const location = await getCurrentLocation();
      if (!location) return;
      const snapshot = await fetchWeatherSnapshot(location);
      if (!snapshot) return;
      if (!snapshotGuard.isCurrent(token)) return;
      set({ snapshot, snapshotDayKey: todayKey });
    } finally {
      set({ refreshing: false });
    }
  },

  clear() {
    snapshotGuard.invalidate();
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
