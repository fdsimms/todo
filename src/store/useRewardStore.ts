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
  claimWaitDays,
  cleanClaimLimit,
  cleanRewardGlyph,
  coinBalance,
  coinsForPrice,
  priceWithTax,
  lastClaimedAt,
  latestLossFor,
  sortCoinEntries,
} from '../utils/rewards';
import { canGuard, claimedSince, planGuardedSlip, type GuardedSlip } from '../utils/rewardGuard';
import type { NegativeHabitFields } from '../utils/negativeHabits';
import { getCurrentDayStart, getDayStart } from '../utils/dateUtils';
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
  /**
   * One tap on a target paid `amount` (`Task.coinsPerTap`). Keyed by the
   * occurrence and the tap number, so the tap that is undone names its entry.
   */
  recordTap: (taskId: string, tap: number, amount: number, label: string) => void;
  /** Undoing tap number `tap`: drop what `recordTap` wrote for it. */
  takeBackTap: (taskId: string, tap: number) => void;
  /**
   * Coins already paid to an occurrence's taps. The completion earns the
   * total less this, so paying per tap never pays twice.
   */
  tapCoinsPaid: (taskId: string) => number;
  /** A slip on a negative habit cost `amount`. Every slip is its own entry. */
  recordSlip: (taskId: string, amount: number, label: string) => void;
  /**
   * One clean day on a "don't do" habit earned `amount`. Keyed by habit and
   * day (`dayKey`), so collecting early and the rollover finding it later is one row.
   */
  recordCleanDay: (taskId: string, dayKey: string, amount: number, label: string, at: string) => void;
  /** Reopening a day, or a slip that spoils it: drop what `recordCleanDay` wrote. */
  takeBackCleanDay: (taskId: string, dayKey: string) => void;
  /** Unticking a task: drop whatever its completion or miss wrote. Returns the entries removed. */
  takeBackTask: (taskId: string) => CoinEntry[];
  /** Writes back entries `takeBackTask` returned, for the undo of an action that took them. */
  restoreEntries: (entries: readonly CoinEntry[]) => void;
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
   * and only for a reward whose price is in dollars. `savingForId` (the
   * reward being saved for) is left alone, so the goal doesn't move while you
   * save toward it. A taxable reward is priced with `taxPercent` added.
   * Returns how many changed.
   */
  repriceDollarRewards: (rate: number, savingForId?: string | null, taxPercent?: number | null) => number;
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
  /**
   * Sets the balance to zero by writing one entry that offsets it (a spend
   * against a positive balance, an earning against a negative one), so the
   * balance stays a sum over the ledger and the history keeps every row.
   * Returns the entry, or null when the balance is already zero or rewards
   * are off.
   */
  resetBalance: (at?: Date) => CoinEntry | null;
  /** The undo for `resetBalance`: drops that entry and nothing else. */
  unreset: (entryId: string) => void;
}

/** The label a balance reset's entry carries, and how the history spots one. */
export const BALANCE_RESET_LABEL = 'Balance reset';

/** A reset belongs to no task and no reward, which no other entry can say. */
export function isBalanceReset(entry: Pick<CoinEntry, 'taskId' | 'rewardId'>): boolean {
  return entry.taskId === null && entry.rewardId === null;
}

/** How recent an entry's own time has to be for `CoinToast` to announce it. */
const ANNOUNCE_WINDOW_MS = 60_000;

/**
 * How long `CoinToast` stays up after a change, and so how long a following
 * change of the same kind keeps adding to the one shown instead of replacing it.
 */
export const COIN_BURST_MS = 1500;

/** The optional half of a reward, as the form edits it. */
export type RewardDetails = Pick<Reward, 'linkUrl' | 'note' | 'oneTime' | 'taskId' | 'priceMinor' | 'taxable' | 'guardsTaskId' | 'claimEveryDays' | 'glyph'>;

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
    // A change landing while the previous one is still on screen is part of
    // the same burst (a bulk or stack completion writes one entry per task),
    // so the pill shows the running total instead of only the last entry.
    const prev = get().lastChange;
    const sameBurst = prev !== null && prev.kind === entry.kind && now - prev.at < COIN_BURST_MS;
    set({ lastChange: { amount: sameBurst ? prev.amount + entry.amount : entry.amount, kind: entry.kind, at: now } });
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

    recordTap(taskId, tap, amount, label) {
      if (!enabled() || amount <= 0) return;
      const entry: CoinEntry = { id: derivedId(spawnSeed.coinTap(taskId, tap)), kind: 'earn', amount, at: new Date().toISOString(), taskId, rewardId: null, label };
      write(entry);
      announce(entry);
    },

    // Not gated, for the reason takeBackTask gives.
    takeBackTap(taskId, tap) {
      const id = derivedId(spawnSeed.coinTap(taskId, tap));
      if (get().entries.some(e => e.id === id)) remove([id]);
    },

    tapCoinsPaid(taskId) {
      const completionId = derivedId(spawnSeed.coinEarn(taskId));
      let paid = 0;
      for (const e of get().entries) {
        if (e.kind === 'earn' && e.taskId === taskId && e.id !== completionId) paid += e.amount;
      }
      return paid;
    },

    recordSlip(taskId, amount, label) {
      if (!enabled() || amount <= 0) return;
      const entry: CoinEntry = { id: generateId(), kind: 'loss', amount, at: new Date().toISOString(), taskId, rewardId: null, label };
      write(entry);
      announce(entry);
    },

    recordCleanDay(taskId, dayKey, amount, label, at) {
      if (!enabled() || amount <= 0) return;
      const entry: CoinEntry = { id: derivedId(spawnSeed.coinClean(taskId, dayKey)), kind: 'earn', amount, at, taskId, rewardId: null, label };
      write(entry);
      announce(entry);
    },

    // Not gated, for the reason takeBackTask gives.
    takeBackCleanDay(taskId, dayKey) {
      const id = derivedId(spawnSeed.coinClean(taskId, dayKey));
      if (get().entries.some(e => e.id === id)) remove([id]);
    },

    // Not gated on `rewardsEnabled`: an entry written while the feature was on
    // still has to go when its completion is undone after it was switched off,
    // or switching back on would show coins for something that didn't happen.
    takeBackTask(taskId) {
      const ids = new Set([derivedId(spawnSeed.coinEarn(taskId)), derivedId(spawnSeed.coinMiss(taskId))]);
      const taken = get().entries.filter(e => ids.has(e.id));
      remove(taken.map(e => e.id));
      return taken;
    },

    // Not gated, for the reason takeBackTask gives: it only puts back what was there.
    restoreEntries(entries) {
      entries.forEach(write);
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
      const plan = planGuardedSlip({ task, rewards: get().rewards, entries: get().entries, balance, todayStart, rewardsEnabled: enabled() });
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
        taxable: details?.priceMinor != null && !!details.taxable,
        guardsTaskId: canGuard({ oneTime, taskId }) ? details?.guardsTaskId ?? null : null,
        claimEveryDays: cleanClaimLimit(details?.claimEveryDays, oneTime),
        glyph: cleanRewardGlyph(details?.glyph),
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
      const priceMinor = patch.priceMinor !== undefined ? patch.priceMinor : current.priceMinor;
      const next: Reward = {
        ...current,
        title,
        cost,
        linkUrl: patch.linkUrl !== undefined ? cleanText(patch.linkUrl) : current.linkUrl,
        note: patch.note !== undefined ? cleanText(patch.note) : current.note,
        oneTime,
        taskId,
        priceMinor,
        // Tax belongs to a dollar price, so dropping the price drops it too.
        taxable: priceMinor !== null && (patch.taxable !== undefined ? patch.taxable : current.taxable),
        // Turning a reward one-time drops the habit it guarded (see canGuard).
        guardsTaskId: canGuard({ oneTime, taskId }) ? guardsTaskId : null,
        // Turning a reward one-time drops its limit, which it has no use for.
        claimEveryDays: cleanClaimLimit(patch.claimEveryDays !== undefined ? patch.claimEveryDays : current.claimEveryDays, oneTime),
        glyph: patch.glyph !== undefined ? cleanRewardGlyph(patch.glyph) : current.glyph,
      };
      dbUpdateReward(next);
      set(s => ({ rewards: sortRewards(s.rewards.map(r => (r.id === id ? next : r))) }));
    },

    repriceDollarRewards(rate, savingForId, taxPercent = null) {
      if (!(rate > 0)) return 0;
      let changed = 0;
      const next = get().rewards.map(r => {
        if (r.priceMinor === null || r.id === savingForId) return r;
        const cost = coinsForPrice(priceWithTax(r.priceMinor, r.taxable, taxPercent), rate);
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
      // A limited reward waits out its limit. The Claim button says so first;
      // this is the guard for a second device, the MCP replica and a backdated
      // claim, which `at` counts from its own day.
      if (claimWaitDays(reward, get().entries, at ? getDayStart(at, useSettingsStore.getState().dayResetTime) : getCurrentDayStart()) > 0) return null;
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
      // A reset is a spend too, but it is no claim: `unreset` is its undo.
      if (entry?.kind === 'spend' && !isBalanceReset(entry)) remove([entryId]);
    },

    resetBalance(at) {
      if (!enabled()) return null;
      const balance = get().balance();
      if (balance === 0) return null;
      const entry: CoinEntry = {
        id: generateId(),
        kind: balance > 0 ? 'spend' : 'earn',
        amount: Math.abs(balance),
        at: (at ?? new Date()).toISOString(),
        taskId: null,
        rewardId: null,
        label: BALANCE_RESET_LABEL,
      };
      write(entry);
      return entry;
    },

    // Not gated, for the reason takeBackTask gives.
    unreset(entryId) {
      const entry = get().entries.find(e => e.id === entryId);
      if (entry && isBalanceReset(entry)) remove([entryId]);
    },
  };
});

function sortRewards(rewards: Reward[]): Reward[] {
  return [...rewards].sort((a, b) => a.cost - b.cost || (a.createdAt < b.createdAt ? -1 : 1));
}
