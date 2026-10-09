import type { CoinEntry, Reward, Task } from '../types';
import { canClaimReward, formatCoins } from './rewards';
import { isNegativeTask, nextSlipIsFree, type NegativeHabitFields } from './negativeHabits';
import { format } from 'date-fns/format';

/**
 * A reward that guards a "don't do this" habit (`Reward.guardsTaskId`): "No
 * dessert unless claimed", paired with the "A dessert" reward.
 *
 * The habit is the honor system for the reward. Claiming it is how you have
 * the thing, and claiming touches nothing on the habit. Logging a slip on the
 * habit says you had it without claiming, which settles one of two ways:
 *
 * - **You can afford it: the slip becomes the claim.** The reward's cost is
 *   spent and no slip is recorded, so the streak stands. Doing the thing and
 *   then paying for it is the same outcome as paying first; what this exists to
 *   stop is never paying at all.
 * - **You can't: a real slip, charged the reward's price up to what you have.**
 *   The streak breaks as for any slip, and the charge replaces the habit's own
 *   slip cost. It takes the balance to zero and never below, the one loss in
 *   the app with a floor (`docs/arch/rewards.md` says why every other loss has
 *   none).
 *
 * Store-free so the row's confirmation, the store's `logSlip` and the MCP
 * replica all decide with this one function, and can't disagree about which
 * of the two a tap will do.
 */

/** What a slip on a guarded habit does instead of the ordinary slip. */
export type GuardedSlip =
  | { kind: 'claim'; reward: Reward }
  | { kind: 'charge'; reward: Reward; amount: number };

/**
 * Whether a reward can guard a habit at all. A one-time reward is gone after
 * one claim, which would leave the habit charging a price nobody can pay, and a
 * wish list reward is a thing you buy once, not a thing you keep earning.
 */
export function canGuard(reward: Pick<Reward, 'oneTime' | 'taskId'>): boolean {
  return !reward.oneTime && !reward.taskId;
}

/** Whether a task is one a reward can guard: a live "don't do this" habit. */
export function isGuardableHabit(task: Pick<Task, 'polarity' | 'parentId' | 'completed' | 'archived'>): boolean {
  return isNegativeTask(task) && !task.parentId && !task.completed && !task.archived;
}

/**
 * The reward guarding this habit, if any. Rewards are kept cheapest first, so
 * when two name the same habit (two devices linking it apart before a sync)
 * the cheaper one guards, which is the kinder reading.
 */
export function guardingReward(rewards: readonly Reward[], taskId: string): Reward | null {
  return rewards.find(r => r.guardsTaskId === taskId && canGuard(r)) ?? null;
}

/**
 * What logging the next slip on `task` does, or null for an ordinary slip:
 * rewards off, no guarding reward, or a slip inside the habit's own allowance
 * (which costs nothing either way, so there is nothing to claim for).
 */
export function planGuardedSlip(input: {
  task: NegativeHabitFields & Pick<Task, 'id'>;
  rewards: readonly Reward[];
  balance: number;
  todayStart: Date;
  rewardsEnabled: boolean;
}): GuardedSlip | null {
  const { task, rewards, balance, todayStart, rewardsEnabled } = input;
  if (!rewardsEnabled || !isNegativeTask(task)) return null;
  const reward = guardingReward(rewards, task.id);
  if (!reward) return null;
  if (nextSlipIsFree(task, todayStart)) return null;
  if (canClaimReward(balance, reward.cost)) return { kind: 'claim', reward };
  return { kind: 'charge', reward, amount: Math.max(0, Math.min(reward.cost, balance)) };
}

/**
 * The id of the coin entry a guarded slip's charge writes, by habit, day and
 * which slip of the day it was. Derived rather than random so the undo takes
 * back exactly this slip's charge: a charge floored to zero writes nothing, and
 * "the newest loss on this habit" (what an ordinary slip's undo removes) would
 * then be an earlier slip's. It also makes two devices logging the same slip
 * one row, like every other derived coin id.
 */
export function guardChargeSeed(taskId: string, todayStart: Date, slipIndex: number): string {
  return `coin-slip-guard:${taskId}:${format(todayStart, 'yyyy-MM-dd')}:${slipIndex}`;
}

/** Whether `rewardId` has been claimed since `todayStart`. */
export function claimedSince(entries: readonly CoinEntry[], rewardId: string, todayStart: Date): boolean {
  const since = todayStart.toISOString();
  return entries.some(e => e.kind === 'spend' && e.rewardId === rewardId && e.at >= since);
}

/** The confirmation a slip tap shows for a guarded habit. */
export function guardedSlipPrompt(
  plan: GuardedSlip,
  balance: number,
  claimedToday: boolean,
): { title: string; message: string; confirm: string } {
  const { reward } = plan;
  if (plan.kind === 'claim') {
    return {
      title: `Claim ${reward.title}?`,
      message: [
        `This spends ${formatCoins(reward.cost)} on ${reward.title} instead of counting a slip, so your streak stays.`,
        claimedToday ? 'You already claimed it once today.' : null,
      ].filter(Boolean).join(' '),
      confirm: 'Claim it',
    };
  }
  return {
    title: 'Log a slip?',
    message: plan.amount > 0
      ? `${reward.title} costs ${formatCoins(reward.cost)} and you have ${formatCoins(balance)}, so this slip takes all of it.`
      : `${reward.title} costs ${formatCoins(reward.cost)} and you have no coins, so this slip costs none.`,
    confirm: 'Log it',
  };
}

/** The line on a reward's card naming the habit it guards. */
export function describeGuard(habitTitle: string): string {
  return `Slips on “${habitTitle}” pay for this`;
}
