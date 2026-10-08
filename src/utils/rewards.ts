import type { CoinEntry, Difficulty, Reward, Task } from '../types';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
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
 * What a task's difficulty does to its effort bucket's value. Time says how
 * long something takes and nothing about how hard it is to start, so a
 * two-minute call you dread would otherwise pay a coin. 'normal' is 1 so the
 * column's default, and a task with no rating, earns exactly what it did.
 * 'trivial' is 0, and is the one rating `baseCoinsFor` doesn't floor at 1: it
 * means the task isn't worth paying for at all.
 */
export const DIFFICULTY_MULTIPLIER: Readonly<Record<Difficulty, number>> = {
  trivial: 0,
  easy: 0.5,
  normal: 1,
  hard: 2,
};

/** The difficulty picker's options, shared by the task and template item editors. */
export const DIFFICULTY_SEGMENTS: { value: Difficulty; label: string }[] = [
  { value: 'trivial', label: 'Trivial' },
  { value: 'easy', label: 'Easy' },
  { value: 'normal', label: 'Normal' },
  { value: 'hard', label: 'Hard' },
];

/**
 * The same, led by "Not set" for the pickers that edit a rating already given
 * (the editors, quick add): a segmented control can't be tapped off, so this
 * is the one way back to unrated. The backfill card asks about unrated tasks
 * only, so it offers the four ratings alone.
 */
export const DIFFICULTY_PICKER_SEGMENTS: { value: Difficulty | null; label: string }[] = [
  { value: null, label: 'Not set' },
  ...DIFFICULTY_SEGMENTS,
];

/** The editor's one-line hint, so the two editors can't describe it differently. */
export const DIFFICULTY_HINT = 'How hard this is to make yourself do, apart from how long it takes. Hard tasks earn double coins and easy ones half. Trivial tasks earn no coins.';

/** What the coin rules read off a task: its estimate, and how hard it is. */
export type CoinSource = EstimateSource & Partial<Pick<Task, 'difficulty'>>;

/**
 * The effort bucket's value alone, before difficulty. Read through
 * `estimatedMinutesFor` so a chain pays for the step being done rather than
 * the whole routine at every step.
 */
function effortCoinsFor(task: EstimateSource): number {
  return COINS_BY_EFFORT[minutesToEffort(estimatedMinutesFor(task))] ?? COINS_BY_EFFORT[0];
}

/**
 * A task's base value in coins: its effort bucket scaled by its difficulty,
 * and never below 1, so an easy quick task still earns something. A trivial
 * task is the exception and is worth nothing.
 */
export function baseCoinsFor(task: CoinSource): number {
  if (task.difficulty === 'trivial') return 0;
  const multiplier = DIFFICULTY_MULTIPLIER[task.difficulty ?? 'normal'] ?? 1;
  return Math.max(1, Math.round(effortCoinsFor(task) * multiplier));
}

/** The extra coins a streak of this length adds to a completion. */
export function streakBonusFor(streakCount: number): number {
  if (!Number.isFinite(streakCount) || streakCount <= 0) return 0;
  return Math.min(STREAK_BONUS_CAP, Math.floor(streakCount / STREAK_BONUS_EVERY));
}

/**
 * What completing a task earns. `streakCount` is the streak *after* this
 * completion, so the completion that reaches 7 in a row is the first to get
 * the bonus. A trivial task earns nothing at all, streak bonus included.
 */
export function coinsForCompletion(
  task: CoinSource & Partial<Pick<Task, 'bountyPushes'>>,
  streakCount: number,
): number {
  if (task.difficulty === 'trivial') return 0;
  return baseCoinsFor(task) + streakBonusFor(streakCount) + bountyCoinsFor(task);
}

// ---------------------------------------------------------------------------
// Bounties
// ---------------------------------------------------------------------------
//
// A bounty is extra coins you post on a task you've been dreading. The one
// rule it has to keep: **a task is never worth more for having waited.** Any
// bonus that grew with `postponeCount` or with how long a task had drifted
// would pay you to push it once more, so this runs the other way. A bounty is
// worth the most the moment it's posted and loses a step every time the task
// is pushed, until after `BOUNTY_PUSHES_TO_EXPIRE` pushes it's gone.
//
// - **Pushes are counted from the post, not before it.** `Task.bountyPushes`
//   is its own count rather than a read of `postponeCount`, because the tasks
//   that most need a bounty are the ones already moved a dozen times, and
//   measured off that count they'd be posted already worthless. It also never
//   resets: pulling the task back to today doesn't buy the lost step back,
//   or push-then-pull would be free.
// - **Withdrawing spends it.** Taking a bounty down sets the count straight to
//   the expiry (`BOUNTY_WITHDRAWN`) rather than back to null, so post, push,
//   withdraw, repost can't restart the decay on the same occurrence.
// - **It belongs to the occurrence**, like `postponeCount`. A recurring task's
//   next occurrence starts with none, so the slot comes free when it's done.
// - **Only a few at once** (`bountyLimit`, 1 by default). A bounty on every
//   task is the same as a bigger base rate, which is no help with the one task
//   you're avoiding. An expired bounty frees its slot, so a bounty you let lapse
//   doesn't lock the feature.
// - **A miss costs the base value only.** The bounty is a bonus on doing it,
//   not a bigger stake on failing to.

/** Pushes after posting until a bounty is worth nothing. */
export const BOUNTY_PUSHES_TO_EXPIRE = 3;
/** What `bountyPushes` is set to when a bounty is withdrawn: spent, never reposted. */
export const BOUNTY_WITHDRAWN = BOUNTY_PUSHES_TO_EXPIRE;
/** The smallest full bounty, so a quick task you dread is still worth posting on. */
export const BOUNTY_MIN_COINS = 3;
/** How many live bounties are allowed at once: default and stepper bounds. */
export const DEFAULT_BOUNTY_LIMIT = 1;
export const MIN_BOUNTY_LIMIT = 1;
export const MAX_BOUNTY_LIMIT = 5;

type BountySource = CoinSource & Partial<Pick<Task, 'bountyPushes'>>;
type BountyState = Pick<Task, 'bountyPushes' | 'completed' | 'archived'> & Partial<Pick<Task, 'difficulty'>>;

/** A bounty's value before any pushes: the task's base value, floored at `BOUNTY_MIN_COINS`. */
export function fullBountyFor(task: CoinSource): number {
  return Math.max(BOUNTY_MIN_COINS, baseCoinsFor(task));
}

/**
 * What the bounty adds to a completion right now. Steps down linearly with
 * each push and never below 1 while it's live, so every push costs something
 * and none is free: 12 → 8 → 4 → 0, or 3 → 2 → 1 → 0.
 */
export function bountyCoinsFor(task: BountySource): number {
  if (task.difficulty === 'trivial') return 0;
  const pushes = task.bountyPushes;
  if (pushes === null || pushes === undefined || pushes >= BOUNTY_PUSHES_TO_EXPIRE) return 0;
  const left = BOUNTY_PUSHES_TO_EXPIRE - Math.max(0, pushes);
  return Math.max(1, Math.round((fullBountyFor(task) * left) / BOUNTY_PUSHES_TO_EXPIRE));
}

/**
 * Whether a task holds a bounty that still pays, and so takes up a slot. A task
 * rated trivial after a bounty went up holds none: it can't pay, and shouldn't
 * keep the slot.
 */
export function isBountyLive(task: BountyState): boolean {
  return (
    !task.completed &&
    !task.archived &&
    task.difficulty !== 'trivial' &&
    task.bountyPushes != null &&
    task.bountyPushes < BOUNTY_PUSHES_TO_EXPIRE
  );
}

/** How many slots are taken. */
export function liveBountyCount(tasks: readonly BountyState[]): number {
  let n = 0;
  for (const t of tasks) if (isBountyLive(t)) n++;
  return n;
}

/**
 * Whether a bounty can go up on this task at all, slots aside: an open,
 * top-level, ordinary task that has never had one on this occurrence. A
 * negative habit is never completed, so a bounty on one could never pay, and
 * neither could one on a trivial task.
 */
export function canPostBounty(
  task: BountyState & Pick<Task, 'parentId' | 'polarity'>,
): boolean {
  return (
    !task.completed &&
    !task.archived &&
    task.difficulty !== 'trivial' &&
    taskEarnsCoins(task) &&
    task.polarity !== 'negative' &&
    task.bountyPushes == null
  );
}

/**
 * The count after a schedule write. Only a push moves it, and it stops at the
 * expiry. Unlike `nextPostponeCount`, a pull back to today leaves it alone.
 */
export function nextBountyPushes(current: number | null | undefined, pushed: boolean): number | null {
  if (current == null || !pushed) return current ?? null;
  return Math.min(BOUNTY_PUSHES_TO_EXPIRE, current + 1);
}

/**
 * A stored limit back into a usable number. The settings table is all TEXT,
 * so a missing or unreadable row is the default rather than NaN.
 */
export function parseBountyLimit(stored: string | null | undefined): number {
  if (stored === null || stored === undefined || stored.trim() === '') return DEFAULT_BOUNTY_LIMIT;
  const n = Number(stored);
  if (!Number.isFinite(n)) return DEFAULT_BOUNTY_LIMIT;
  return Math.min(MAX_BOUNTY_LIMIT, Math.max(MIN_BOUNTY_LIMIT, Math.round(n)));
}

/**
 * The one line saying what a live bounty is worth and what the next push
 * costs. Null when there's no live bounty to describe.
 */
export function describeBounty(task: BountySource & BountyState): string | null {
  if (!isBountyLive(task)) return null;
  const now = bountyCoinsFor(task);
  const after = bountyCoinsFor({ ...task, bountyPushes: (task.bountyPushes ?? 0) + 1 });
  return after > 0
    ? `+${formatCoins(now)} extra when done. Moving it again drops it to +${formatCoins(after)}.`
    : `+${formatCoins(now)} extra when done. Moving it again ends the bounty.`;
}

/**
 * What marking an occurrence missed, or logging a slip, costs: the effort
 * bucket's value, or what doing it would have earned if that is less. No
 * streak term, because the miss is what ends the streak.
 *
 * Difficulty can lower the cost but never raise it. A hard task that cost
 * double to miss would be a bigger stake on trying the very tasks the rating
 * is meant to get done, and an easy one that cost more to miss than to do
 * would make the rating a penalty.
 */
export function coinsForLoss(task: CoinSource): number {
  return Math.min(effortCoinsFor(task), baseCoinsFor(task));
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
export type EarnHistoryTask = CoinSource & {
  parentId: string | null;
  completed: boolean;
  completedAt: string | null;
  missedAt?: string | null;
  doneByOtherAt?: string | null;
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
    if (!t.completed || !t.completedAt || !taskEarnsCoins(t) || t.doneByOtherAt) continue;
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
  return cleanCoins(ratePerDay * days);
}

/** Rounds a raw coin figure to the clean steps a price reads in, within 1..MAX_REWARD_COST. */
function cleanCoins(raw: number): number {
  const step = raw < 20 ? 1 : raw < 100 ? 5 : raw < 1000 ? 10 : 50;
  return Math.min(MAX_REWARD_COST, Math.max(1, Math.round(raw / step) * step));
}

// ==== Pricing a reward in dollars ====
//
// A reward that costs real money gets a dollar price, and the coin cost is that
// price at an exchange rate: the coins you earn in a week divided by what you'd
// spend on rewards in a week. Both halves are the person's own: the earning
// rate is the same one `suggestRewardCost` reads, and the budget is typed, so
// the rate is never a number the app made up. Because the earning rate moves,
// so does the rate, and `cost` is rewritten from the price when it does (see
// `repriceDollarRewards` in `useRewardStore`). That is the one place a saved
// price moves by itself, and only for a reward the person priced in dollars.

/** Reads the stored weekly budget: a positive whole number of minor units, or null. */
export function parseWeeklyBudget(stored: string | null | undefined): number | null {
  const n = Number(stored);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Coins per whole dollar: a week of earning over a week of spending. Null when
 * either half is missing, which leaves dollar prices unconverted rather than
 * guessed.
 */
export function coinsPerDollar(ratePerDay: number | null, weeklyBudgetMinor: number | null): number | null {
  if (ratePerDay === null || !(ratePerDay > 0)) return null;
  if (weeklyBudgetMinor === null || !(weeklyBudgetMinor > 0)) return null;
  return (ratePerDay * 7) / (weeklyBudgetMinor / 100);
}

/** The clean coin cost of a dollar price at an exchange rate. */
export function coinsForPrice(priceMinor: number, rate: number): number {
  return cleanCoins((priceMinor / 100) * rate);
}

/** "About 12 coins per $1", for the line under the budget field. */
export function describeExchangeRate(rate: number, symbol: string): string {
  const perDollar = rate >= 10 ? Math.round(rate) : Math.round(rate * 10) / 10;
  return `About ${perDollar} ${perDollar === 1 ? 'coin' : 'coins'} per ${symbol}1`;
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

// ==== A reward on the list ====

/** What a reward made from a wish list item reads off the item. */
export type RewardSourceTask = Pick<Task, 'title' | 'notes' | 'linkUrl' | 'completed' | 'archived'>;

/** When a reward was last claimed: its newest spend, or null if it never was. */
export function lastClaimedAt(entries: readonly CoinEntry[], rewardId: string): string | null {
  let latest: string | null = null;
  for (const e of entries) {
    if (e.kind !== 'spend' || e.rewardId !== rewardId) continue;
    if (latest === null || e.at > latest) latest = e.at;
  }
  return latest;
}

/**
 * Whether a reward belongs on the list. A one-time reward goes once claimed
 * (undoing the claim removes the spend, so it comes back). A wish list
 * reward also goes when its item is checked off, archived or deleted by hand:
 * the item was the reward, and it's been dealt with.
 */
export function rewardIsOpen(
  reward: Pick<Reward, 'id' | 'oneTime' | 'taskId'>,
  entries: readonly CoinEntry[],
  task: RewardSourceTask | null | undefined,
): boolean {
  if (reward.oneTime && lastClaimedAt(entries, reward.id) !== null) return false;
  if (reward.taskId && (!task || task.completed || task.archived)) return false;
  return true;
}

/**
 * The title, note and link to show. A wish list reward reads all three off its
 * item, so editing the item edits the reward; the stored title is only the
 * fallback for an item that's gone.
 */
export function rewardDisplay(
  reward: Pick<Reward, 'title' | 'note' | 'linkUrl' | 'taskId'>,
  task: RewardSourceTask | null | undefined,
): { title: string; note: string | null; linkUrl: string | null } {
  if (reward.taskId && task) {
    return { title: task.title, note: task.notes?.trim() || null, linkUrl: task.linkUrl ?? null };
  }
  return { title: reward.title, note: reward.note, linkUrl: reward.linkUrl };
}

/** "Claimed today", "Claimed yesterday", "Last claimed 5 days ago", by calendar day. */
export function describeLastClaimed(at: string, now: Date): string {
  const days = differenceInCalendarDays(now, new Date(at));
  if (days <= 0) return 'Claimed today';
  if (days === 1) return 'Claimed yesterday';
  return `Last claimed ${days} days ago`;
}

/** How far the balance is toward a goal's cost, 0..1. */
export function goalProgress(balance: number, cost: number): number {
  if (!(cost > 0)) return 0;
  return Math.min(1, Math.max(0, balance / cost));
}
