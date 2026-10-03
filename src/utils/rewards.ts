import type { CoinEntry } from '../types';
import { estimatedMinutesFor, minutesToEffort, type EstimateSource } from './effort';

/**
 * Coins and rewards: a light, Habitica-style economy over tasks you already
 * have. Completing a task earns coins, marking one missed or logging a slip
 * costs coins, and the coins buy rewards you define yourself ("an episode of
 * something", "takeout"). Off unless the user turns it on (`rewardsEnabled`);
 * while off, nothing here is written at all.
 *
 * The rules, each of which exists for a reason worth keeping:
 *
 * - **The balance is derived, never stored.** It is `coinBalance(entries)`.
 *   Sync is last-writer-wins per row, so a stored balance would keep whichever
 *   device wrote last and silently drop the other's coins. An append-only
 *   ledger with one row per event merges by union instead, and the entries
 *   tied to a completion or a miss carry derived ids so the same occurrence
 *   completed on two devices is one row (`spawnSeed.coinEarn`/`coinMiss`).
 *   It also can't be derived from completed tasks: `completedRetentionDays`
 *   purges those, and the balance would fall when it ran.
 *
 * - **Only what a person did moves it.** Completions passed `neutral` (the
 *   overshoot and interval sweeps), the quota rollover (which never reaches
 *   `completeTask`) and the expiry sweep earn and cost nothing. Losses come
 *   only from `markMissed` and `logSlip`, both of which are a person saying
 *   so. The app never claims a miss on the user's behalf (see
 *   `sweepExpiredTasks`), so it doesn't charge for one either: a task left
 *   undone at the end of the day costs nothing until you say you missed it.
 *
 * - **Undo takes the entry back, exactly.** Unticking a task deletes the
 *   entry its completion or miss wrote; undoing a slip deletes that slip's
 *   entry. Unlike `undoSlip` and the penalty block, this can't be gamed: the
 *   entry removed is the one the action wrote, so a tick-untick round trip
 *   nets zero rather than buying anything.
 *
 * - **The balance can go below zero.** Losses are taken in full, and
 *   unticking a task whose coins were already spent takes them back anyway.
 *   Refusing the undo would be the app overruling a correction, and flooring
 *   the balance would make a miss free once you were broke. A negative
 *   balance just means nothing can be claimed until it's earned back.
 *
 * - **Coins never touch the app shield.** `penaltyCreditFor` says it plainly:
 *   anything that hands out unblocked minutes is a rewards feature wearing the
 *   penalty's clothes. A reward here is a note to yourself, and claiming one
 *   records it; it unlocks nothing in the app.
 */

/**
 * What a task is worth, by effort bucket (index = `Effort`). Index 0 is "no
 * estimate at all" and pays the same as a 15-minute task, so a list nobody
 * has estimated still earns something sensible.
 */
export const COINS_BY_EFFORT: readonly number[] = [2, 1, 2, 3, 5, 8, 12];

/** A completion earns one extra coin for each this-many in a row on its streak... */
export const STREAK_BONUS_EVERY = 7;
/** ...up to this many extra coins. */
export const STREAK_BONUS_CAP = 5;

/** The most a single reward can cost. Keeps a typo from making one unreachable. */
export const MAX_REWARD_COST = 100_000;

/**
 * A task's base value in coins: its effort bucket, read through
 * `estimatedMinutesFor` so a chain pays for the step being done rather than
 * the whole routine at every step.
 */
export function baseCoinsFor(task: EstimateSource): number {
  return COINS_BY_EFFORT[minutesToEffort(estimatedMinutesFor(task))] ?? COINS_BY_EFFORT[0];
}

/** The extra coins a streak of this length adds to a completion. */
export function streakBonusFor(streakCount: number): number {
  if (!Number.isFinite(streakCount) || streakCount <= 0) return 0;
  return Math.min(STREAK_BONUS_CAP, Math.floor(streakCount / STREAK_BONUS_EVERY));
}

/**
 * What completing a task earns. `streakCount` is the streak *after* this
 * completion, so the completion that reaches 7 in a row is the first to get
 * the bonus.
 */
export function coinsForCompletion(task: EstimateSource, streakCount: number): number {
  return baseCoinsFor(task) + streakBonusFor(streakCount);
}

/**
 * What marking an occurrence missed, or logging a slip, costs: the task's base
 * value. No streak term, because the miss is what ends the streak.
 */
export function coinsForLoss(task: EstimateSource): number {
  return baseCoinsFor(task);
}

/**
 * Whether a task takes part at all. Subtasks don't: they are steps of the task
 * that pays, and paying for each would make splitting a task into ten
 * subtasks the way to earn more.
 */
export function taskEarnsCoins(task: { parentId: string | null }): boolean {
  return !task.parentId;
}

/** The current balance: everything earned, less everything lost or spent. */
export function coinBalance(entries: readonly Pick<CoinEntry, 'kind' | 'amount'>[]): number {
  let total = 0;
  for (const e of entries) total += e.kind === 'earn' ? e.amount : -e.amount;
  return total;
}

/** Whether the balance covers a reward. */
export function canClaimReward(balance: number, cost: number): boolean {
  return cost > 0 && balance >= cost;
}

/**
 * Reads a typed cost: a positive whole number up to `MAX_REWARD_COST`, or null.
 * Digits only, so "1,000" and " 25 " both read and "2.5" doesn't.
 */
export function parseRewardCost(text: string): number | null {
  const digits = text.replace(/[,\s]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  if (n <= 0 || n > MAX_REWARD_COST) return null;
  return n;
}

/** "1 coin", "12 coins", "-3 coins". */
export function formatCoins(n: number): string {
  return `${n} ${Math.abs(n) === 1 ? 'coin' : 'coins'}`;
}

/** The signed figure a history row shows: "+3", "-2". */
export function signedAmount(entry: Pick<CoinEntry, 'kind' | 'amount'>): string {
  return entry.kind === 'earn' ? `+${entry.amount}` : `-${entry.amount}`;
}

/** Newest first, the order the history list reads in. */
export function sortCoinEntries(entries: readonly CoinEntry[]): CoinEntry[] {
  return [...entries].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/**
 * The entry a slip undo should take back: the newest loss recorded against
 * this task. Null when there is none (rewards were off when the slip was
 * logged), in which case there is nothing to refund.
 */
export function latestLossFor(entries: readonly CoinEntry[], taskId: string): CoinEntry | null {
  let latest: CoinEntry | null = null;
  for (const e of entries) {
    if (e.kind !== 'loss' || e.taskId !== taskId) continue;
    if (!latest || e.at > latest.at) latest = e;
  }
  return latest;
}
