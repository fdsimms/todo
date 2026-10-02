import { create } from 'zustand';
import { fetchTransitSnapshot } from '../services/transitLookup';
import { isDemoModeActive } from '../utils/demoState';
import type { TransitSnapshot } from '../utils/transitAlerts';
import { useSettingsStore } from './useSettingsStore';
import { createRefreshGuard } from '../utils/refreshGuard';

/**
 * The MTA's subway alerts, held in memory: `useWeatherStore`'s shape, for its
 * reason. It is another service's answer about the world outside, not this
 * app's data, so there is no table. `checkTravelTasks` (`useTaskStore.ts`)
 * reads whatever is here and never fetches; this store owns getting it here.
 */

interface TransitState {
  snapshot: TransitSnapshot | null;
  refreshing: boolean;
  /** Reads a fresh snapshot if the one held is stale or missing, and nothing else is already fetching. */
  refresh: () => Promise<void>;
  clear: () => void;
}

/**
 * How old a snapshot may be before the next trigger replaces it.
 *
 * Ten minutes against the weather's hour, because a delay is worth knowing
 * about for minutes where a forecast holds for hours. Still not a poll on its
 * own: it only decides whether a trigger that fired anyway does anything. The
 * interval in `useTravelTaskSync` is what makes triggers happen while the app
 * sits open.
 *
 * The triggers live in that hook rather than here, unlike useWeatherStore's,
 * so this module imports nothing from react-native and the many suites that
 * load `useTaskStore` (which reads this store) need no mock for it.
 */
export const TRANSIT_SNAPSHOT_STALE_MS = 10 * 60 * 1000;

// One read, so one guard. See refreshGuard.ts: a snapshot must not be written
// back after the feature was switched off mid-fetch.
const snapshotGuard = createRefreshGuard();

/** A `fetchedAt` that doesn't parse reads as stale, the call useWeatherStore makes. */
function isSnapshotStale(snapshot: TransitSnapshot | null): boolean {
  if (!snapshot) return true;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (Number.isNaN(fetchedAt)) return true;
  return Date.now() - fetchedAt >= TRANSIT_SNAPSHOT_STALE_MS;
}

/**
 * Whether there is any reason to read the feed: the travel tasks it annotates
 * are on, its own switch is on, and at least one line is picked. Reading the
 * whole city's alerts to report on no lines would be traffic for nothing.
 */
export function transitReadWanted(s: {
  travelTasks: boolean;
  transitAlerts: boolean;
  transitLines: readonly string[];
}): boolean {
  return s.travelTasks && s.transitAlerts && s.transitLines.length > 0;
}

export const useTransitStore = create<TransitState>((set, get) => ({
  snapshot: null,
  refreshing: false,

  async refresh() {
    if (isDemoModeActive()) return;
    if (get().refreshing) return;
    if (!isSnapshotStale(get().snapshot)) return;
    set({ refreshing: true });
    const token = snapshotGuard.begin();
    try {
      const snapshot = await fetchTransitSnapshot();
      // A failed read keeps whatever was held rather than clearing it. The
      // freshness rules in transitAlerts.ts already stop an old snapshot's
      // live delays being reported, and planned work from an hour ago is
      // still the best answer available.
      if (!snapshot) return;
      if (!snapshotGuard.isCurrent(token)) return;
      set({ snapshot });
    } finally {
      set({ refreshing: false });
    }
  },

  clear() {
    snapshotGuard.invalidate();
    set({ snapshot: null });
  },
}));
