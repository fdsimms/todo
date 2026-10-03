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

// ==== Pricing a reward by how often you want it ====
//
// A cost typed as a bare number is a guess, and a wrong guess is how this kind
// of system goes stale: priced too low and a reward stops meaning anything,
// too high and it's never reached. So a reward is priced in *time*: you say
// how often you'd want it, and the cost is your own recent earning rate times
// that. The rate is read off completed tasks rather than the coin ledger, so
// it works on the day rewards are switched on, from history already kept.
//
// The suggestion fills the field and is never applied behind your back: a
// price that moved after you'd saved toward it would be the goalposts moving.
// What does move is `describeRewardPace`, the "about every 6 days" line, so a
// reward drifting toward too easy or too hard is visible and yours to reprice.

/** How far back the earning rate looks. Four weeks, so one odd week can't swing it. */
export const EARN_RATE_WINDOW_DAYS = 28;
/** Less history than this and the rate is too noisy to price anything from. */
export const MIN_EARN_HISTORY_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RewardFrequency {
  id: 'daily' | 'few-weekly' | 'weekly' | 'biweekly' | 'monthly';
  label: string;
  /** Days between claims. */
  days: number;
}

export const REWARD_FREQUENCIES: readonly RewardFrequency[] = [
  { id: 'daily', label: 'Daily', days: 1 },
  { id: 'few-weekly', label: 'A few times a week', days: 2.5 },
  { id: 'weekly', label: 'Weekly', days: 7 },
  { id: 'biweekly', label: 'Every two weeks', days: 14 },
  { id: 'monthly', label: 'Monthly', days: 30 },
];

/** What `earnRatePerDay` reads off a task row. */
export type EarnHistoryTask = EstimateSource & {
  parentId: string | null;
  completed: boolean;
  completedAt: string | null;
  missedAt?: string | null;
  streakCount: number;
};

/**
 * Coins a day, net of misses, over the last `EARN_RATE_WINDOW_DAYS` of
 * completed tasks, as the coin rules would have paid them. Null when there is
 * less than `MIN_EARN_HISTORY_DAYS` of history to read.
 *
 * Divides by the history actually there (from the oldest completion in the
 * window), not by the whole window, so a retention window shorter than four
 * weeks, or a new install, isn't read as a slow month.
 *
 * Slips aren't counted: a negative habit keeps only today's slip count, not a
 * history of them. Nor are the app's own neutral completions told apart from
 * yours, since a stored row doesn't record which it was. Both make this an
 * estimate, which is all a suggested price needs.
 */
export function earnRatePerDay(tasks: readonly EarnHistoryTask[], now: Date): number | null {
  const nowMs = now.getTime();
  const from = nowMs - EARN_RATE_WINDOW_DAYS * DAY_MS;
  let total = 0;
  let oldest = nowMs;
  for (const t of tasks) {
    if (!t.completed || !t.completedAt || !taskEarnsCoins(t)) continue;
    const at = Date.parse(t.completedAt);
    if (!Number.isFinite(at) || at < from || at > nowMs) continue;
    oldest = Math.min(oldest, at);
    // The same truthiness test `isMissed` makes, which takes a whole Task.
    total += t.missedAt ? -coinsForLoss(t) : coinsForCompletion(t, t.streakCount);
  }
  const spanDays = (nowMs - oldest) / DAY_MS;
  if (spanDays < MIN_EARN_HISTORY_DAYS) return null;
  return total / spanDays;
}

/**
 * A clean price for a reward claimed every `days` at `ratePerDay`: whole
 * coins under 20, then fives, tens and fifties, so it reads as a price rather
 * than as arithmetic. Null when the rate can't price anything (no history, or
 * losing more than earning lately).
 */
export function suggestRewardCost(ratePerDay: number | null, days: number): number | null {
  if (ratePerDay === null || !(ratePerDay > 0)) return null;
  const raw = ratePerDay * days;
  const step = raw < 20 ? 1 : raw < 100 ? 5 : raw < 1000 ? 10 : 50;
  return Math.min(MAX_REWARD_COST, Math.max(1, Math.round(raw / step) * step));
}

/**
 * "about every 6 days": how often a reward at this cost comes round at the
 * current rate. Null when the rate says nothing (too little history, or not
 * earning), which the screen shows as no line at all rather than a guess.
 */
export function describeRewardPace(ratePerDay: number | null, cost: number): string | null {
  if (ratePerDay === null || !(ratePerDay > 0) || !(cost > 0)) return null;
  const days = cost / ratePerDay;
  if (days < 0.75) return 'more than once a day at your current pace';
  if (days < 1.5) return 'about every day at your current pace';
  if (days < 13) return `about every ${Math.round(days)} days at your current pace`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `about every ${weeks} weeks at your current pace`;
  }
  // Past 60 days, so this is always two months or more.
  return `about every ${Math.round(days / 30)} months at your current pace`;
}

// ==== Reward ideas ====
//
// A starter set, offered rather than inserted: rewards the app wrote unasked
// would be clutter for anyone with their own ideas, and two devices each
// seeding the same list would sync into duplicates. Each idea carries a
// frequency rather than a price, so it's priced by the same rule as a
// reward you type yourself.

export interface RewardIdea {
  title: string;
  frequency: RewardFrequency['id'];
}

export const REWARD_IDEAS: readonly RewardIdea[] = [
  { title: 'An episode of a show', frequency: 'daily' },
  { title: 'An hour of gaming', frequency: 'daily' },
  { title: 'A fancy coffee', frequency: 'few-weekly' },
  { title: 'A dessert', frequency: 'few-weekly' },
  { title: 'Takeout dinner', frequency: 'weekly' },
  { title: 'A movie night', frequency: 'weekly' },
  { title: 'Sleeping in', frequency: 'weekly' },
  { title: 'A new book', frequency: 'biweekly' },
  { title: 'A day trip', frequency: 'monthly' },
  { title: 'A massage', frequency: 'monthly' },
];

/**
 * The rate ideas are priced at until there's a week of history to read: about
 * what three or four ordinary tasks a day earn. Only ever used to price an
 * idea, never to describe a pace, so it can't pass itself off as yours.
 */
export const DEFAULT_EARN_RATE_PER_DAY = 10;

export interface PricedRewardIdea extends RewardIdea {
  frequencyLabel: string;
  cost: number;
}

/**
 * The ideas not already on your list, each priced at your rate (or the
 * default while there's too little history). An idea is "already on your list"
 * by title, ignoring case and surrounding spaces, so adding one takes it out.
 */
export function rewardIdeas(existingTitles: readonly string[], ratePerDay: number | null): PricedRewardIdea[] {
  const have = new Set(existingTitles.map(t => t.trim().toLowerCase()));
  const rate = ratePerDay !== null && ratePerDay > 0 ? ratePerDay : DEFAULT_EARN_RATE_PER_DAY;
  const out: PricedRewardIdea[] = [];
  for (const idea of REWARD_IDEAS) {
    if (have.has(idea.title.toLowerCase())) continue;
    const frequency = REWARD_FREQUENCIES.find(f => f.id === idea.frequency)!;
    out.push({ ...idea, frequencyLabel: frequency.label, cost: suggestRewardCost(rate, frequency.days)! });
  }
  return out;
}
