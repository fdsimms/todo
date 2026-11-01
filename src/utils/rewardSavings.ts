import type { CoinEntry } from '../types';
import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import { isBalanceReset } from './rewards';

/**
 * Savings for the goal: one balance, split into what's set aside for the
 * reward you're saving for and what's left to spend.
 *
 * The problem it answers: with one pool, every small claim (a coffee) visibly
 * set the goal (a game) back, even when the person always meant to have both.
 * Choosing a goal now makes the trade once: a share of every coin earned goes
 * to the goal, and the rest is spending money that small rewards draw from.
 *
 * The rules, each for a reason:
 *
 * - **Still one currency and one ledger.** The balance is `coinBalance` as
 *   before. Each entry records, when it is written, how much of it went into
 *   or came out of savings (`CoinEntry.saved`), and savings are the sum of
 *   those since the plan started. Spending money is the balance less savings.
 *   Nothing is stored as a running total, so the ledger still merges by union.
 *
 * - **The split is written once, never recomputed.** Changing the share
 *   changes what future entries put aside; it doesn't rewrite the past, or
 *   moving the date would make savings jump.
 *
 * - **The share is the person's answer.** The sheet works it out from the
 *   date they want the goal by and their earning rate, and they can set it
 *   directly. Falling behind moves the date shown; the share never rises on
 *   its own, since that would change the deal after it was made.
 *
 * - **Small rewards never take savings unasked.** A claim spending money
 *   can't cover is refused unless the person says to use savings
 *   (`claimReward`'s `useSavings`), and the prompt says what it costs the goal.
 *   The goal itself draws on savings first.
 *
 * - **Losses come out of both, by the same share.** A miss or slip costs the
 *   goal its share too, never more than what is saved. Taking it only from
 *   spending would push spending below zero while savings sat untouched.
 *
 * - **Changing or clearing the goal returns savings to spending.** Savings
 *   only count from the plan's `since`, so a new plan starts at its deposit
 *   and nothing is lost: the coins were always in the balance.
 *
 * - **A reset zeroes savings too.** It is the balance's zero, so savings start
 *   again after it like everything else, and the deposit no longer counts.
 */

/** The plan for the goal, kept as one synced setting so its fields can't drift apart. */
export interface GoalPlan {
  /** The reward it is for. The plan applies only while this is `rewardGoalId`. */
  rewardId: string;
  /** The share of every coin earned that goes to savings, 1..100. */
  sharePct: number;
  /** The date it was wanted by (`YYYY-MM-DD`), or null when the share was set directly. */
  by: string | null;
  /** ISO instant the plan started. Savings count only entries from here on. */
  since: string;
  /** Coins moved into savings when the plan started. */
  deposit: number;
}

export const MIN_SAVINGS_SHARE = 1;
export const MAX_SAVINGS_SHARE = 100;
/** The share a plan starts at before there is a rate to work one out from. */
export const DEFAULT_SAVINGS_SHARE = 50;

/** One-tap dates in the goal sheet, as days from today. */
export const GOAL_DATE_PRESETS: readonly { label: string; days: number }[] = [
  { label: '1 month', days: 30 },
  { label: '6 weeks', days: 42 },
  { label: '2 months', days: 60 },
  { label: '3 months', days: 90 },
];

export function cleanSavingsShare(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return DEFAULT_SAVINGS_SHARE;
  return Math.min(MAX_SAVINGS_SHARE, Math.max(MIN_SAVINGS_SHARE, Math.round(value)));
}

/** The stored setting, or null for none or anything that doesn't read as a plan. */
export function parseGoalPlan(stored: string | null | undefined): GoalPlan | null {
  if (!stored) return null;
  try {
    const raw = JSON.parse(stored) as Partial<GoalPlan>;
    if (!raw || typeof raw.rewardId !== 'string' || !raw.rewardId || typeof raw.since !== 'string' || Number.isNaN(Date.parse(raw.since))) return null;
    return {
      rewardId: raw.rewardId,
      sharePct: cleanSavingsShare(raw.sharePct),
      by: typeof raw.by === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.by) ? raw.by : null,
      since: raw.since,
      deposit: Math.max(0, Math.round(Number(raw.deposit) || 0)),
    };
  } catch {
    return null;
  }
}

export function serializeGoalPlan(plan: GoalPlan | null): string {
  return plan ? JSON.stringify(plan) : '';
}

/**
 * The plan in force: the stored one, when it is for the goal being saved for
 * and that goal can still be claimed. Null otherwise, and then the whole
 * balance is spending money (and a goal with no plan reads its progress off
 * the whole balance, as it always has).
 */
export function activeGoalPlan(plan: GoalPlan | null, goalId: string | null, goalOpen: boolean): GoalPlan | null {
  if (!plan || !goalId || plan.rewardId !== goalId || !goalOpen) return null;
  return plan;
}

type LedgerRow = Pick<CoinEntry, 'kind' | 'amount' | 'at' | 'taskId' | 'rewardId' | 'label' | 'saved'>;

function latestResetMs(entries: readonly LedgerRow[]): number {
  let zeroAt = -Infinity;
  for (const e of entries) {
    if (isBalanceReset(e)) zeroAt = Math.max(zeroAt, Date.parse(e.at));
  }
  return zeroAt;
}

/** Whether an entry dated `at` falls inside the plan's savings: from `since`, and after the latest reset. */
function inWindow(at: string, plan: GoalPlan, zeroAt: number): boolean {
  const ms = Date.parse(at);
  return ms >= Date.parse(plan.since) && ms > zeroAt;
}

/** Whether an entry written now at `at` should be split at all. */
export function splitsEntry(at: string, plan: GoalPlan | null): plan is GoalPlan {
  return plan !== null && Date.parse(at) >= Date.parse(plan.since);
}

/** The coins set aside for the goal: the deposit, plus what entries put in, less what they took out. */
export function savingsBalance(entries: readonly LedgerRow[], plan: GoalPlan | null): number {
  if (!plan) return 0;
  const zeroAt = latestResetMs(entries);
  let total = Date.parse(plan.since) > zeroAt ? plan.deposit : 0;
  for (const e of entries) {
    if (isBalanceReset(e) || !e.saved || !inWindow(e.at, plan, zeroAt)) continue;
    total += e.kind === 'earn' ? e.saved : -e.saved;
  }
  return total;
}

/**
 * What an earning of `amount` puts aside. Rounded on the running total of
 * earnings since the plan started rather than per entry, so a stream of
 * 1-coin taps at 70% puts aside 70% of them, not all or none.
 */
export function savedForEarn(amount: number, plan: GoalPlan, entries: readonly LedgerRow[], excludeId?: string): number {
  if (!(amount > 0)) return 0;
  const zeroAt = latestResetMs(entries);
  let before = 0;
  for (const e of entries as readonly (LedgerRow & { id?: string })[]) {
    if (e.kind !== 'earn' || isBalanceReset(e) || (excludeId && e.id === excludeId) || !inWindow(e.at, plan, zeroAt)) continue;
    before += e.amount;
  }
  const share = plan.sharePct / 100;
  const saved = Math.round((before + amount) * share) - Math.round(before * share);
  return Math.min(amount, Math.max(0, saved));
}

/** What a loss of `amount` takes from savings: its share, never more than is saved. */
export function savedForLoss(amount: number, plan: GoalPlan, savings: number): number {
  if (!(amount > 0) || savings <= 0) return 0;
  return Math.min(Math.round(amount * plan.sharePct / 100), savings, amount);
}

/**
 * What a claim of `cost` takes from savings. The goal uses savings first; any
 * other reward uses spending money first and savings only for the rest, which
 * the caller has to have asked for (`savingsNeededFor` says how much).
 */
export function savedForSpend(cost: number, balance: number, savings: number, isGoal: boolean): number {
  if (!(cost > 0) || savings <= 0) return 0;
  if (isGoal) return Math.min(savings, cost);
  return Math.min(savings, cost, savingsNeededFor(cost, balance, savings));
}

/** How much of a claim of `cost` spending money can't cover, 0 when it can. */
export function savingsNeededFor(cost: number, balance: number, savings: number): number {
  const spending = balance - Math.max(0, savings);
  return Math.max(0, cost - Math.max(0, spending));
}

/** The money left to spend: the balance less savings. Can be below zero, as the balance can. */
export function spendingBalance(balance: number, savings: number): number {
  return balance - Math.max(0, savings);
}

/**
 * The share that reaches `cost` in `days` at `ratePerDay`, counting the coins
 * already put in (`have`). Null with no rate to work from. Rounded up, so the
 * date holds; capped at 100%, past which the date can't be reached.
 */
export function shareForDate(cost: number, have: number, ratePerDay: number | null, days: number): number | null {
  if (ratePerDay === null || !(ratePerDay > 0) || !(days > 0)) return null;
  const need = Math.max(0, cost - have);
  return cleanSavingsShare(Math.ceil((need / (ratePerDay * days)) * 100));
}

/** Days until savings reach `cost` at this rate and share; 0 when they have, null with no rate. */
export function daysToGoal(cost: number, savings: number, ratePerDay: number | null, sharePct: number): number | null {
  const remaining = cost - savings;
  if (remaining <= 0) return 0;
  const perDay = ratePerDay !== null ? ratePerDay * sharePct / 100 : 0;
  if (!(perDay > 0)) return null;
  return Math.ceil(remaining / perDay);
}

/** Coins a day left for everything else, or null with no rate. */
export function spendingPerDay(ratePerDay: number | null, sharePct: number): number | null {
  if (ratePerDay === null || !(ratePerDay > 0)) return null;
  return Math.max(0, Math.round(ratePerDay * (1 - sharePct / 100)));
}

/**
 * The line under the goal's bar: "On track for Dec 15" while the pace reaches
 * the date it was wanted by, "About Dec 22 at this pace" once it doesn't, and
 * "Ready to claim" once savings cover it. `today` is the logical today.
 */
export function describeGoalPace(cost: number, savings: number, ratePerDay: number | null, plan: GoalPlan, today: Date): string | null {
  if (savings >= cost) return 'Ready to claim';
  const days = daysToGoal(cost, savings, ratePerDay, plan.sharePct);
  if (days === null) return null;
  const eta = addDays(today, days);
  if (plan.by) {
    const by = new Date(`${plan.by}T00:00`);
    if (eta.getTime() <= by.getTime()) return `On track for ${format(by, 'MMM d')}`;
    return `About ${format(eta, 'MMM d')} at this pace`;
  }
  return `About ${format(eta, 'MMM d')}`;
}

/** "about a day", "about 3 days": how far taking `coins` out of savings moves the goal. */
export function describeSetback(coins: number, ratePerDay: number | null, sharePct: number): string | null {
  const perDay = ratePerDay !== null ? ratePerDay * sharePct / 100 : 0;
  if (!(perDay > 0) || !(coins > 0)) return null;
  const days = Math.max(1, Math.round(coins / perDay));
  return days === 1 ? 'about a day' : `about ${days} days`;
}
