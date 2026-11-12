import { create } from 'zustand';
import { fetchFranki, type FrankiProblem } from '../services/franki';
import { isDemoModeActive } from '../utils/demoState';
import { createRefreshGuard } from '../utils/refreshGuard';
import { FRANKI_TOKEN_SECURE_KEY, loadSecureKey, saveSecureKey } from '../utils/secureApiKey';
import type { FrankiSnapshot } from '../utils/frankiTasks';
import { useSettingsStore } from './useSettingsStore';

/**
 * The last read of the person's Franki server, held in memory: WaniKani's
 * store's shape, for its reason (`useWaniKaniStore`). It is another app's
 * answer about their flashcards, not this app's data, so there is no table.
 * `checkFrankiTasks` (`useTaskStore.ts`) reads whatever is here and never
 * fetches; this store owns getting it here, and `useFrankiSync` owns when.
 *
 * The key itself is never held here, only whether there is one. It is read
 * out of the keychain at each fetch.
 */

interface FrankiState {
  snapshot: FrankiSnapshot | null;
  /** Why the last read failed, or null after one that worked. */
  problem: FrankiProblem | null;
  /** The server's own sentence about the failure, when it gave one. */
  problemDetail: string | null;
  hasToken: boolean;
  refreshing: boolean;
  /** Reads whether a key is saved. Called once from `useFrankiSync`. */
  initialize: () => Promise<void>;
  /** Saves a key (an empty one removes it) and reads with it. Reports whether it stuck. */
  setToken: (token: string) => Promise<boolean>;
  /** Reads the server if the snapshot is stale or `force` is set, and nothing else is already reading. */
  refresh: (force?: boolean) => Promise<void>;
  /** Forgets the snapshot, and drops a read in flight. */
  clear: () => void;
}

/** How old a snapshot may be before the next trigger replaces it: WaniKani's figure. */
export const FRANKI_SNAPSHOT_STALE_MS = 5 * 60 * 1000;

const snapshotGuard = createRefreshGuard();

function isSnapshotStale(snapshot: FrankiSnapshot | null): boolean {
  if (!snapshot) return true;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (Number.isNaN(fetchedAt)) return true;
  // Anki's study day has turned since: the whole new day's reviews are due.
  if (snapshot.dayEndsAt && Date.now() >= Date.parse(snapshot.dayEndsAt)) return true;
  return Date.now() - fetchedAt >= FRANKI_SNAPSHOT_STALE_MS;
}

export const useFrankiStore = create<FrankiState>((set, get) => ({
  snapshot: null,
  problem: null,
  problemDetail: null,
  hasToken: false,
  refreshing: false,

  async initialize() {
    if (isDemoModeActive()) return;
    const token = await loadSecureKey(FRANKI_TOKEN_SECURE_KEY);
    set({ hasToken: !!token });
  },

  async setToken(token: string) {
    const trimmed = token.trim();
    // Readable while locked: the background run reads it (backgroundRefresh.ts).
    const saved = await saveSecureKey(FRANKI_TOKEN_SECURE_KEY, trimmed, { readableWhileLocked: true });
    if (!saved) return false;
    snapshotGuard.invalidate();
    set({ hasToken: !!trimmed, problem: null, problemDetail: null, snapshot: null, refreshing: false });
    if (trimmed) void get().refresh(true);
    return true;
  },

  async refresh(force = false) {
    if (isDemoModeActive()) return;
    if (get().refreshing) return;
    if (!useSettingsStore.getState().frankiTasks) return;
    if (!force && !isSnapshotStale(get().snapshot)) return;
    set({ refreshing: true });
    const guard = snapshotGuard.begin();
    try {
      const token = await loadSecureKey(FRANKI_TOKEN_SECURE_KEY);
      if (!snapshotGuard.isCurrent(guard)) return;
      if (!token) {
        set({ hasToken: false });
        return;
      }
      const result = await fetchFranki(token);
      if (!result) return;
      if (!snapshotGuard.isCurrent(guard)) return;
      if (!result.ok) {
        // A refused key's snapshot is no longer anybody's to act on. Any other
        // failure keeps the last read, WaniKani's call.
        set(result.problem === 'unauthorized'
          ? { problem: result.problem, problemDetail: result.detail, snapshot: null }
          : { problem: result.problem, problemDetail: result.detail });
        return;
      }
      set({ snapshot: result.snapshot, problem: null, problemDetail: null, hasToken: true });
    } finally {
      if (snapshotGuard.isCurrent(guard)) set({ refreshing: false });
    }
  },

  clear() {
    snapshotGuard.invalidate();
    set({ snapshot: null, problem: null, problemDetail: null, refreshing: false });
  },
}));
