import { create } from 'zustand';
import {
  fetchWaniKani,
  type WaniKaniProblem,
  type WaniKaniUser,
} from '../services/wanikani';
import { isDemoModeActive } from '../utils/demoState';
import { createRefreshGuard } from '../utils/refreshGuard';
import { loadSecureKey, saveSecureKey, WANIKANI_TOKEN_SECURE_KEY } from '../utils/secureApiKey';
import { dayKeyOf, getCurrentDayStart } from '../utils/dateUtils';
import type { WaniKaniSnapshot } from '../utils/wanikaniTasks';
import { useSettingsStore } from './useSettingsStore';

/**
 * The last read of the person's WaniKani account, held in memory:
 * `useTransitStore`'s shape, for its reason. It is another service's answer
 * about their study queue, not this app's data, so there is no table.
 * `checkWaniKaniTasks` (`useTaskStore.ts`) reads whatever is here and never
 * fetches; this store owns getting it here, and `useWaniKaniSync` owns when.
 *
 * The token itself is never held here, only whether there is one. It is read
 * out of the keychain at each fetch, the sync server token's arrangement.
 */

interface WaniKaniState {
  snapshot: WaniKaniSnapshot | null;
  /** The account the token belongs to, read once per token, for Settings to name. */
  user: WaniKaniUser | null;
  /** Why the last read failed, or null after one that worked. */
  problem: WaniKaniProblem | null;
  hasToken: boolean;
  refreshing: boolean;
  /** Reads whether a token is saved. Called once from `useWaniKaniSync`. */
  initialize: () => Promise<void>;
  /** Saves a token (an empty one removes it) and reads with it. Reports whether it stuck. */
  setToken: (token: string) => Promise<boolean>;
  /** Reads the account if the snapshot is stale or `force` is set, and nothing else is already reading. */
  refresh: (force?: boolean) => Promise<void>;
  /** Forgets the snapshot, and drops a read in flight. */
  clear: () => void;
}

/**
 * How old a snapshot may be before the next trigger replaces it. Reviews come
 * in on the hour, so five minutes keeps a foreground close to the truth
 * without reading on every tab switch. Still not a poll on its own: the
 * interval in `useWaniKaniSync` is what makes triggers happen while the app
 * sits open.
 */
export const WANIKANI_SNAPSHOT_STALE_MS = 5 * 60 * 1000;

const snapshotGuard = createRefreshGuard();

function isSnapshotStale(snapshot: WaniKaniSnapshot | null): boolean {
  if (!snapshot) return true;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (Number.isNaN(fetchedAt)) return true;
  // A read for an earlier day counts lessons done on that day, not this one.
  if (snapshot.dayKey !== dayKeyOf(getCurrentDayStart())) return true;
  return Date.now() - fetchedAt >= WANIKANI_SNAPSHOT_STALE_MS;
}

export const useWaniKaniStore = create<WaniKaniState>((set, get) => ({
  snapshot: null,
  user: null,
  problem: null,
  hasToken: false,
  refreshing: false,

  async initialize() {
    if (isDemoModeActive()) return;
    const token = await loadSecureKey(WANIKANI_TOKEN_SECURE_KEY);
    set({ hasToken: !!token });
  },

  async setToken(token: string) {
    const trimmed = token.trim();
    const saved = await saveSecureKey(WANIKANI_TOKEN_SECURE_KEY, trimmed);
    if (!saved) return false;
    // Whatever was read with the old token is about someone else's queue now.
    snapshotGuard.invalidate();
    set({ hasToken: !!trimmed, user: null, problem: null, snapshot: null, refreshing: false });
    if (trimmed) void get().refresh(true);
    return true;
  },

  async refresh(force = false) {
    if (isDemoModeActive()) return;
    if (get().refreshing) return;
    const settings = useSettingsStore.getState();
    if (!settings.wanikaniTasks) return;
    if (!force && !isSnapshotStale(get().snapshot)) return;
    set({ refreshing: true });
    const guard = snapshotGuard.begin();
    try {
      const token = await loadSecureKey(WANIKANI_TOKEN_SECURE_KEY);
      if (!snapshotGuard.isCurrent(guard)) return;
      if (!token) {
        set({ hasToken: false });
        return;
      }
      const dayStart = getCurrentDayStart();
      const dayKey = dayKeyOf(dayStart);
      const lessons = settings.wanikaniLessonsPerDay !== null;
      const result = await fetchWaniKani(token, {
        dayStart,
        dayKey,
        lessons,
        // Only matters until today's lessons task is written, so it isn't read after.
        apprentice: lessons && settings.wanikaniApprenticeCap !== null
          && settings.wanikaniLessonsLastDayKey !== dayKey,
        user: get().user === null,
      });
      if (!result) return;
      if (!snapshotGuard.isCurrent(guard)) return;
      if (!result.ok) {
        // A refused token's snapshot is no longer anybody's to act on. Any
        // other failure keeps the last read, the call the MTA store makes.
        set(result.problem === 'unauthorized'
          ? { problem: result.problem, snapshot: null, user: null }
          : { problem: result.problem });
        return;
      }
      set({ snapshot: result.snapshot, user: result.user ?? get().user, problem: null, hasToken: true });
    } finally {
      if (snapshotGuard.isCurrent(guard)) set({ refreshing: false });
    }
  },

  clear() {
    snapshotGuard.invalidate();
    set({ snapshot: null, user: null, problem: null, refreshing: false });
  },
}));
