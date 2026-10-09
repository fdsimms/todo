import { create } from 'zustand';
import type { CoinEntry, Reward, Task } from '../types';
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
  coinsForPrice,
  lastClaimedAt,
  latestLossFor,
  sortCoinEntries,
} from '../utils/rewards';
import { canGuard, claimedSince, planGuardedSlip, type GuardedSlip } from '../utils/rewardGuard';
import type { NegativeHabitFields } from '../utils/negativeHabits';
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
  /**
   * The last earning or loss that happened just now, for `CoinToast`. Null
   * until one does. `at` is a wall-clock ms, so two equal amounts in a row
   * still read as two changes.
   */
  lastChange: { amount: number; kind: 'earn' | 'loss'; at: number } | null;
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
  /**
   * A slip on a habit a reward guards cost `amount` (the reward's price, down
   * to the balance). Keyed by `guardChargeSeed`, so its undo can name it.
   */
  recordGuardCharge: (taskId: string, amount: number, label: string, seed: string) => void;
  /**
   * Undoing a guarded slip: drop the charge `recordGuardCharge` wrote under
   * `seed`. False when it wrote none (a charge floored to zero, or a slip
   * logged before the reward guarded the habit).
   */
  takeBackGuardCharge: (seed: string) => boolean;
  /**
   * What the next slip on `task` does if a reward guards it, with what the
   * confirmation needs to say so; null for an ordinary slip. The one reading
   * both the slip's confirmation and `logSlip` act on.
   */
  slipGuardFor: (
    task: NegativeHabitFields & Pick<Task, 'id'>,
    todayStart: Date,
  ) => { plan: GuardedSlip; balance: number; claimedToday: boolean } | null;

  /**
   * `details` carries the optional fields. A reward made from a wish list item
   * passes its `taskId` and is always one-time, whatever `oneTime` says.
   */
  addReward: (title: string, cost: number, details?: Partial<RewardDetails>) => Reward | null;
  updateReward: (id: string, patch: Partial<Pick<Reward, 'title' | 'cost'> & RewardDetails>) => void;
  /**
   * Rewrites the coin cost of every dollar-priced reward from its price at
   * `rate` (coins per dollar). The one place a saved cost moves on its own,
   * and only for a reward whose price is in dollars. Returns how many changed.
   */
  repriceDollarRewards: (rate: number) => number;
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

/** How recent an entry's own time has to be for `CoinToast` to announce it. */
const ANNOUNCE_WINDOW_MS = 60_000;

/** The optional half of a reward, as the form edits it. */
export type RewardDetails = Pick<Reward, 'linkUrl' | 'note' | 'oneTime' | 'taskId' | 'priceMinor' | 'guardsTaskId'>;

/** Blank text is no value, so a cleared field stores null rather than "". */
function cleanText(text: string | null | undefined): string | null {
  return text?.trim() || null;
}

function enabled(): boolean {
  return useSettingsStore.getState().rewardsEnabled;
}

export const useRewardStore = create<RewardStore>((set, get) => {
  const write = (entry: CoinEntry) => {
    dbUpsertCoinEntry(entry);
    set(s => ({ entries: sortCoinEntries([entry, ...s.entries.filter(e => e.id !== entry.id)]) }));
  };
  // Only a change happening now is announced. A backdated one (the morning
  // check-in, a widget tap drained later, the demo seed) is something nobody
  // is watching happen, and a "+3" for it would land on whatever screen
  // they've since moved to.
  const announce = (entry: CoinEntry) => {
    if (entry.kind === 'spend') return;
    const now = Date.now();
    if (Math.abs(now - Date.parse(entry.at)) > ANNOUNCE_WINDOW_MS) return;
    set({ lastChange: { amount: entry.amount, kind: entry.kind, at: now } });
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
    lastChange: null,

    initialize() {
      set({ entries: dbGetAllCoinEntries(), rewards: dbGetAllRewards(), initialized: true });
    },

    balance() {
      return coinBalance(get().entries);
    },

    recordEarn(taskId, amount, label, at) {
      if (!enabled() || amount <= 0) return;
      const entry: CoinEntry = { id: derivedId(spawnSeed.coinEarn(taskId)), kind: 'earn', amount, at, taskId, rewardId: null, label };
      write(entry);
      announce(entry);
    },

    recordMiss(taskId, amount, label, at) {
      if (!enabled() || amount <= 0) return;
      const entry: CoinEntry = { id: derivedId(spawnSeed.coinMiss(taskId)), kind: 'loss', amount, at, taskId, rewardId: null, label };
      write(entry);
      announce(entry);
    },

    recordSlip(taskId, amount, label) {
      if (!enabled() || amount <= 0) return;
      const entry: CoinEntry = { id: generateId(), kind: 'loss', amount, at: new Date().toISOString(), taskId, rewardId: null, label };
      write(entry);
      announce(entry);
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

    recordGuardCharge(taskId, amount, label, seed) {
      if (!enabled() || amount <= 0) return;
      const entry: CoinEntry = { id: derivedId(seed), kind: 'loss', amount, at: new Date().toISOString(), taskId, rewardId: null, label };
      write(entry);
      announce(entry);
    },

    // Not gated, for the reason takeBackTask gives.
    takeBackGuardCharge(seed) {
      const id = derivedId(seed);
      if (!get().entries.some(e => e.id === id)) return false;
      remove([id]);
      return true;
    },

    slipGuardFor(task, todayStart) {
      const balance = get().balance();
      const plan = planGuardedSlip({ task, rewards: get().rewards, balance, todayStart, rewardsEnabled: enabled() });
      if (!plan) return null;
      return { plan, balance, claimedToday: claimedSince(get().entries, plan.reward.id, todayStart) };
    },

    addReward(title, cost, details) {
      const trimmed = title.trim();
      if (!trimmed || !(cost > 0)) return null;
      const taskId = details?.taskId ?? null;
      const oneTime = !!taskId || !!details?.oneTime;
      const reward: Reward = {
        id: generateId(),
        title: trimmed,
        cost: Math.round(cost),
        createdAt: new Date().toISOString(),
        linkUrl: cleanText(details?.linkUrl),
        note: cleanText(details?.note),
        oneTime,
        taskId,
        priceMinor: details?.priceMinor ?? null,
        guardsTaskId: canGuard({ oneTime, taskId }) ? details?.guardsTaskId ?? null : null,
      };
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
      const taskId = patch.taskId !== undefined ? patch.taskId : current.taskId;
      const oneTime = !!taskId || (patch.oneTime !== undefined ? patch.oneTime : current.oneTime);
      const guardsTaskId = patch.guardsTaskId !== undefined ? patch.guardsTaskId : current.guardsTaskId;
      const next: Reward = {
        ...current,
        title,
        cost,
        linkUrl: patch.linkUrl !== undefined ? cleanText(patch.linkUrl) : current.linkUrl,
        note: patch.note !== undefined ? cleanText(patch.note) : current.note,
        oneTime,
        taskId,
        priceMinor: patch.priceMinor !== undefined ? patch.priceMinor : current.priceMinor,
        // Turning a reward one-time drops the habit it guarded (see canGuard).
        guardsTaskId: canGuard({ oneTime, taskId }) ? guardsTaskId : null,
      };
      dbUpdateReward(next);
      set(s => ({ rewards: sortRewards(s.rewards.map(r => (r.id === id ? next : r))) }));
    },

    repriceDollarRewards(rate) {
      if (!(rate > 0)) return 0;
      let changed = 0;
      const next = get().rewards.map(r => {
        if (r.priceMinor === null) return r;
        const cost = coinsForPrice(r.priceMinor, rate);
        if (cost === r.cost) return r;
        changed += 1;
        const updated = { ...r, cost };
        dbUpdateReward(updated);
        return updated;
      });
      if (changed > 0) set({ rewards: sortRewards(next) });
      return changed;
    },

    deleteReward(id) {
      dbDeleteReward(id);
      set(s => ({ rewards: s.rewards.filter(r => r.id !== id) }));
    },

    claimReward(id, at) {
      if (!enabled()) return null;
      const reward = get().rewards.find(r => r.id === id);
      if (!reward || !canClaimReward(get().balance(), reward.cost)) return null;
      // A one-time reward is claimed once. The list hides it after, so this is
      // the guard for a second device that claimed it before the first synced.
      if (reward.oneTime && lastClaimedAt(get().entries, reward.id) !== null) return null;
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
