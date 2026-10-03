import { create } from 'zustand';
import type { CoinEntry, Reward } from '../types';
import {
  dbGetAllCoinEntries,
  dbUpsertCoinEntry,
  dbDeleteCoinEntry,
  dbGetAllRewards,
  dbInsertReward,
  dbUpdateReward,
  dbDeleteReward,
} from '../db/database';
import { generateId } from '../utils/id';
import { derivedId, spawnSeed } from '../utils/syncIds';
import {
  canClaimReward,
  coinBalance,
  latestLossFor,
  sortCoinEntries,
} from '../utils/rewards';
import { useSettingsStore } from './useSettingsStore';

/**
 * Coins and rewards — see `src/utils/rewards.ts` for every rule, including
 * why the balance is derived from the ledger rather than stored.
 *
 * Its own store, the same call `useMedicationStore` makes: rows with their own
 * lifecycle that only point at a task for provenance. The task store calls the
 * four `record*`/`take*` actions from its completion, miss and slip paths;
 * each is a no-op while `rewardsEnabled` is off, so nothing is written for a
 * feature nobody turned on.
 */
interface RewardStore {
  /** Newest first. */
  entries: CoinEntry[];
  /** Cheapest first. */
  rewards: Reward[];
  initialized: boolean;
  initialize: () => void;
  /** The balance, summed off `entries`. */
  balance: () => number;

  /** A completion earned `amount`. Keyed by the completed row. */
  recordEarn: (taskId: string, amount: number, label: string, at: string) => void;
  /** Marking an occurrence missed cost `amount`. Keyed by the missed row. */
  recordMiss: (taskId: string, amount: number, label: string, at: string) => void;
  /** A slip on a negative habit cost `amount`. Every slip is its own entry. */
  recordSlip: (taskId: string, amount: number, label: string) => void;
  /** Unticking a task: drop whatever its completion or miss wrote. */
  takeBackTask: (taskId: string) => void;
  /** Undoing a slip: drop the newest slip entry for the task. */
  takeBackSlip: (taskId: string) => void;

  addReward: (title: string, cost: number) => Reward | null;
  updateReward: (id: string, patch: Partial<Pick<Reward, 'title' | 'cost'>>) => void;
  /** Deletes the reward. Coins already spent on it stay spent. */
  deleteReward: (id: string) => void;
  /**
   * Spend the reward's cost. Returns the entry, or null when the balance
   * doesn't cover it (or rewards are off). `at` backdates the claim, which
   * only the demo seed uses.
   */
  claimReward: (id: string, at?: Date) => CoinEntry | null;
  /** Take back a claim: the undo for `claimReward`. */
  unclaim: (entryId: string) => void;
}

function enabled(): boolean {
  return useSettingsStore.getState().rewardsEnabled;
}

export const useRewardStore = create<RewardStore>((set, get) => {
  const write = (entry: CoinEntry) => {
    dbUpsertCoinEntry(entry);
    set(s => ({ entries: sortCoinEntries([entry, ...s.entries.filter(e => e.id !== entry.id)]) }));
  };
  const remove = (ids: string[]) => {
    if (ids.length === 0) return;
    ids.forEach(id => dbDeleteCoinEntry(id));
    const gone = new Set(ids);
    set(s => ({ entries: s.entries.filter(e => !gone.has(e.id)) }));
  };

  return {
    entries: [],
    rewards: [],
    initialized: false,

    initialize() {
      set({ entries: dbGetAllCoinEntries(), rewards: dbGetAllRewards(), initialized: true });
    },

    balance() {
      return coinBalance(get().entries);
    },

    recordEarn(taskId, amount, label, at) {
      if (!enabled() || amount <= 0) return;
      write({ id: derivedId(spawnSeed.coinEarn(taskId)), kind: 'earn', amount, at, taskId, rewardId: null, label });
    },

    recordMiss(taskId, amount, label, at) {
      if (!enabled() || amount <= 0) return;
      write({ id: derivedId(spawnSeed.coinMiss(taskId)), kind: 'loss', amount, at, taskId, rewardId: null, label });
    },

    recordSlip(taskId, amount, label) {
      if (!enabled() || amount <= 0) return;
      write({ id: generateId(), kind: 'loss', amount, at: new Date().toISOString(), taskId, rewardId: null, label });
    },

    // Not gated on `rewardsEnabled`: an entry written while the feature was on
    // still has to go when its completion is undone after it was switched off,
    // or switching back on would show coins for something that didn't happen.
    takeBackTask(taskId) {
      remove([derivedId(spawnSeed.coinEarn(taskId)), derivedId(spawnSeed.coinMiss(taskId))]
        .filter(id => get().entries.some(e => e.id === id)));
    },

    takeBackSlip(taskId) {
      const entry = latestLossFor(get().entries, taskId);
      if (entry) remove([entry.id]);
    },

    addReward(title, cost) {
      const trimmed = title.trim();
      if (!trimmed || !(cost > 0)) return null;
      const reward: Reward = { id: generateId(), title: trimmed, cost: Math.round(cost), createdAt: new Date().toISOString() };
      dbInsertReward(reward);
      set(s => ({ rewards: sortRewards([...s.rewards, reward]) }));
      return reward;
    },

    updateReward(id, patch) {
      const current = get().rewards.find(r => r.id === id);
      if (!current) return;
      const title = patch.title !== undefined ? patch.title.trim() : current.title;
      const cost = patch.cost !== undefined ? Math.round(patch.cost) : current.cost;
      if (!title || !(cost > 0)) return;
      const next = { ...current, title, cost };
      dbUpdateReward(next);
      set(s => ({ rewards: sortRewards(s.rewards.map(r => (r.id === id ? next : r))) }));
    },

    deleteReward(id) {
      dbDeleteReward(id);
      set(s => ({ rewards: s.rewards.filter(r => r.id !== id) }));
    },

    claimReward(id, at) {
      if (!enabled()) return null;
      const reward = get().rewards.find(r => r.id === id);
      if (!reward || !canClaimReward(get().balance(), reward.cost)) return null;
      const entry: CoinEntry = {
        id: generateId(),
        kind: 'spend',
        amount: reward.cost,
        at: (at ?? new Date()).toISOString(),
        taskId: null,
        rewardId: reward.id,
        label: reward.title,
      };
      write(entry);
      return entry;
    },

    unclaim(entryId) {
      const entry = get().entries.find(e => e.id === entryId);
      if (entry?.kind === 'spend') remove([entryId]);
    },
  };
});

function sortRewards(rewards: Reward[]): Reward[] {
  return [...rewards].sort((a, b) => a.cost - b.cost || (a.createdAt < b.createdAt ? -1 : 1));
}
