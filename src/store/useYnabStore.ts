import { create } from 'zustand';
import {
  fetchYnab,
  fetchYnabPlans,
  ynabWanted,
  type YnabProblem,
} from '../services/ynab';
import { isDemoModeActive } from '../utils/demoState';
import { createRefreshGuard } from '../utils/refreshGuard';
import { loadSecureKey, saveSecureKey, YNAB_TOKEN_SECURE_KEY } from '../utils/secureApiKey';
import { ynabMonthKey, type YnabPlan, type YnabSnapshot } from '../utils/ynabPlan';
import { useSettingsStore } from './useSettingsStore';

/**
 * The last read of the person's YNAB plan, held in memory: `useWaniKaniStore`'s
 * shape, for its reason. It is another service's answer about their money,
 * not this app's data, so there is no table, and nothing in it reaches sync,
 * a backup or the MCP replica. `checkYnabTasks` (`useTaskStore.ts`) and the
 * grocery trip banner read whatever is here and never fetch; this store owns
 * getting it here, and `useYnabSync` owns when.
 *
 * The token itself is never held here, only whether there is one. It is read
 * out of the keychain at each fetch.
 */

interface YnabState {
  snapshot: YnabSnapshot | null;
  /** The plans on the account, read for Settings to pick from. Null until read. */
  plans: YnabPlan[] | null;
  /** Why the last read failed, or null after one that worked. */
  problem: YnabProblem | null;
  hasToken: boolean;
  refreshing: boolean;
  /** Reads whether a token is saved. Called once from `useYnabSync`. */
  initialize: () => Promise<void>;
  /** Saves a token (an empty one removes it) and checks it. Reports whether it stuck. */
  setToken: (token: string) => Promise<boolean>;
  /**
   * Reads the plans on the account, which is also the token check. With no
   * plan chosen yet and exactly one on the account, chooses it.
   */
  loadPlans: () => Promise<void>;
  /** Reads the plan if the snapshot is stale or `force` is set, and nothing else is already reading. */
  refresh: (force?: boolean) => Promise<void>;
  /** Forgets the snapshot and the plans, and drops a read in flight. */
  clear: () => void;
}

/**
 * How old a snapshot may be before the next trigger replaces it. The interval
 * in `useYnabSync` is ten minutes; five lets a foreground land between them
 * without reading on every tab switch.
 */
export const YNAB_SNAPSHOT_STALE_MS = 5 * 60 * 1000;

/**
 * How long reads stand down after YNAB answers 429. Its limit is a rolling
 * hour, so asking again a minute later only spends more of it.
 */
export const YNAB_RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1000;

const snapshotGuard = createRefreshGuard();
// Its own guard, so a plans read starting can't strand a snapshot read's
// `refreshing` flag (a stale guard skips the reset in `refresh`'s finally).
const plansGuard = createRefreshGuard();
let pausedUntilMs = 0;

/** Test seam: forgets a rate-limit backoff. */
export function resetYnabBackoffForTests(): void {
  pausedUntilMs = 0;
}

function isSnapshotStale(snapshot: YnabSnapshot | null, planId: string, now: Date): boolean {
  if (!snapshot || snapshot.planId !== planId) return true;
  if (snapshot.monthKey !== ynabMonthKey(now)) return true;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (Number.isNaN(fetchedAt)) return true;
  return now.getTime() - fetchedAt >= YNAB_SNAPSHOT_STALE_MS;
}

function noteProblem(problem: YnabProblem): void {
  if (problem === 'rateLimited') pausedUntilMs = Date.now() + YNAB_RATE_LIMIT_BACKOFF_MS;
}

export const useYnabStore = create<YnabState>((set, get) => ({
  snapshot: null,
  plans: null,
  problem: null,
  hasToken: false,
  refreshing: false,

  async initialize() {
    if (isDemoModeActive()) return;
    const token = await loadSecureKey(YNAB_TOKEN_SECURE_KEY);
    set({ hasToken: !!token });
  },

  async setToken(token: string) {
    const trimmed = token.trim();
    // Readable while locked: the background run reads it (backgroundRefresh.ts).
    const saved = await saveSecureKey(YNAB_TOKEN_SECURE_KEY, trimmed, { readableWhileLocked: true });
    if (!saved) return false;
    // Whatever was read with the old token may be someone else's plan.
    snapshotGuard.invalidate();
    plansGuard.invalidate();
    pausedUntilMs = 0;
    set({ hasToken: !!trimmed, plans: null, problem: null, snapshot: null, refreshing: false });
    if (trimmed) void get().loadPlans();
    return true;
  },

  async loadPlans() {
    if (isDemoModeActive()) return;
    if (!ynabWanted(useSettingsStore.getState())) return;
    if (Date.now() < pausedUntilMs) return;
    const guard = plansGuard.begin();
    const token = await loadSecureKey(YNAB_TOKEN_SECURE_KEY);
    if (!plansGuard.isCurrent(guard)) return;
    if (!token) {
      set({ hasToken: false });
      return;
    }
    const result = await fetchYnabPlans(token);
    if (!result || !plansGuard.isCurrent(guard)) return;
    if (!result.ok) {
      noteProblem(result.problem);
      set(result.problem === 'unauthorized'
        ? { problem: result.problem, plans: null, snapshot: null }
        : { problem: result.problem });
      return;
    }
    set({ plans: result.plans, problem: null, hasToken: true });
    const settings = useSettingsStore.getState();
    const chosen = settings.ynabPlanId;
    if (chosen === null && result.plans.length === 1) {
      settings.setYnabPlanId(result.plans[0].id);
    } else if (chosen !== null && !result.plans.some(p => p.id === chosen)) {
      // The chosen plan is gone from the account (deleted, or a token for a
      // different account). Said, rather than read as an empty plan.
      set({ problem: 'notFound', snapshot: null });
      return;
    }
    void get().refresh(true);
  },

  async refresh(force = false) {
    if (isDemoModeActive()) return;
    if (get().refreshing) return;
    const settings = useSettingsStore.getState();
    if (!ynabWanted(settings)) return;
    if (Date.now() < pausedUntilMs) return;
    const planId = settings.ynabPlanId;
    if (!planId) {
      // Nothing to read until a plan is chosen; the plans list is how one is.
      if (get().plans === null && get().hasToken) void get().loadPlans();
      return;
    }
    const now = new Date();
    if (!force && !isSnapshotStale(get().snapshot, planId, now)) return;
    set({ refreshing: true });
    const guard = snapshotGuard.begin();
    try {
      const token = await loadSecureKey(YNAB_TOKEN_SECURE_KEY);
      if (!snapshotGuard.isCurrent(guard)) return;
      if (!token) {
        set({ hasToken: false });
        return;
      }
      const result = await fetchYnab(token, {
        planId,
        queue: settings.ynabTasks,
        previous: get().snapshot,
        now,
      });
      if (!result) return;
      if (!snapshotGuard.isCurrent(guard)) return;
      // The plan picked while this read was out is a different plan.
      if (useSettingsStore.getState().ynabPlanId !== planId) return;
      if (!result.ok) {
        noteProblem(result.problem);
        // A refused token or a plan that's gone leaves nothing to act on. Any
        // other failure keeps the last read, the call the WaniKani store makes.
        set(result.problem === 'unauthorized' || result.problem === 'notFound'
          ? { problem: result.problem, snapshot: null }
          : { problem: result.problem });
        return;
      }
      set({ snapshot: result.snapshot, problem: null, hasToken: true });
    } finally {
      if (snapshotGuard.isCurrent(guard)) set({ refreshing: false });
    }
  },

  clear() {
    snapshotGuard.invalidate();
    plansGuard.invalidate();
    set({ snapshot: null, plans: null, problem: null, refreshing: false });
  },
}));
