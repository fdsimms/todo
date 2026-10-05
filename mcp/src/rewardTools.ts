/**
 * The rewards tools: reading the coin balance, the rewards and the history, and
 * the writes around them. Same contract as stackTools.ts: ordinary functions
 * over a `Replica`, no SDK, so they run in the repo's jest.
 *
 * The rules are the app's own (docs/arch/rewards.md) and live in
 * `src/utils/rewards.ts`; this file only shapes what Claude reads. The one rule
 * worth keeping in front of the tool descriptions is the first one: coins move
 * only when the person did the thing or said so. Nothing here earns or spends
 * unasked, and `get_rewards` says what a claim would leave before it is made.
 */
import type { CoinEntry, Reward } from '../../src/types';
import type { Replica } from './replica';
import { serializeTasks, type SerializedTask } from './serialize';

export interface SerializedReward {
  id: string;
  title: string;
  cost: number;
  note?: string;
  link?: string;
  /** Claimed once, then gone from the list. */
  oneTime: boolean;
  /** The wish-list task this reward is. Claimed in the app only. */
  wishListTaskId?: string;
  /** Whether the balance covers it right now. */
  affordable: boolean;
  /** Coins still needed; 0 when affordable. */
  shortBy: number;
  /** ISO instant of its newest claim, when it has ever been claimed. */
  lastClaimedAt?: string;
  /** True for the reward being saved for. */
  goal?: boolean;
}

export interface SerializedCoinEntry {
  id: string;
  kind: CoinEntry['kind'];
  /** Positive; `kind` says which way it moved the balance. */
  amount: number;
  at: string;
  label: string;
  taskId?: string;
  rewardId?: string;
}

export interface RewardsReport {
  /** False when rewards are switched off. Nothing below is being kept then. */
  enabled: boolean;
  balance: number;
  goal: { id: string; title: string; cost: number; progress: number; shortBy: number } | null;
  /** The rewards on the list. A claimed one-time reward is not here. */
  rewards: SerializedReward[];
  /** Tasks with a live coin bounty, and how many may be live at once. */
  bounties: { limit: number; tasks: { id: string; title: string; summary: string }[] };
  /** Newest first. */
  history: SerializedCoinEntry[];
}

export const DEFAULT_HISTORY_LIMIT = 15;

function serializeEntry(e: CoinEntry): SerializedCoinEntry {
  return {
    id: e.id,
    kind: e.kind,
    amount: e.amount,
    at: e.at,
    label: e.label,
    ...(e.taskId ? { taskId: e.taskId } : {}),
    ...(e.rewardId ? { rewardId: e.rewardId } : {}),
  };
}

/** The balance, the goal, the rewards, the live bounties and the latest ledger entries. */
export function getRewards(replica: Replica, input: { historyLimit?: number } = {}): RewardsReport {
  const { rewards: lib } = replica.lib();
  const settings = replica.settings();
  const { entries, rewards } = replica.rewardState();
  const balance = lib.coinBalance(entries);

  const open = rewards.flatMap((reward: Reward): SerializedReward[] => {
    const source = reward.taskId ? replica.taskById(reward.taskId) : null;
    if (!lib.rewardIsOpen(reward, entries, source)) return [];
    const shown = lib.rewardDisplay(reward, source);
    const last = lib.lastClaimedAt(entries, reward.id);
    return [{
      id: reward.id,
      title: shown.title,
      cost: reward.cost,
      ...(shown.note ? { note: shown.note } : {}),
      ...(shown.linkUrl ? { link: shown.linkUrl } : {}),
      oneTime: reward.oneTime,
      ...(reward.taskId ? { wishListTaskId: reward.taskId } : {}),
      affordable: lib.canClaimReward(balance, reward.cost),
      shortBy: Math.max(0, reward.cost - balance),
      ...(last ? { lastClaimedAt: last } : {}),
      ...(reward.id === settings.rewardGoalId ? { goal: true } : {}),
    }];
  });

  const goalReward = open.find(r => r.goal);
  const limit = Math.max(0, Math.floor(input.historyLimit ?? DEFAULT_HISTORY_LIMIT));
  return {
    enabled: settings.rewardsEnabled,
    balance,
    goal: goalReward
      ? { id: goalReward.id, title: goalReward.title, cost: goalReward.cost, progress: lib.goalProgress(balance, goalReward.cost), shortBy: goalReward.shortBy }
      : null,
    rewards: open,
    bounties: {
      limit: settings.bountyLimit,
      tasks: replica
        .tasks()
        .filter(t => lib.isBountyLive(t))
        .map(t => ({ id: t.id, title: replica.displayTitle(t), summary: lib.describeBounty(t) ?? '' })),
    },
    history: entries.slice(0, limit).map(serializeEntry),
  };
}

export interface RewardInput {
  title: string;
  cost: number;
  note?: string | null;
  link?: string | null;
  oneTime?: boolean;
}

/** A new reward. The cost is the person's to set; the app prices ideas off the earning rate, which Claude can ask them about. */
export function createReward(replica: Replica, input: RewardInput): SerializedReward {
  const reward = replica.addReward(input.title, input.cost, { note: input.note, linkUrl: input.link, oneTime: input.oneTime });
  return rewardById(replica, reward.id);
}

export function updateReward(
  replica: Replica,
  id: string,
  patch: Partial<RewardInput>,
): SerializedReward {
  const reward = replica.updateReward(id, {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.cost !== undefined ? { cost: patch.cost } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.link !== undefined ? { linkUrl: patch.link } : {}),
    ...(patch.oneTime !== undefined ? { oneTime: patch.oneTime } : {}),
  });
  return rewardById(replica, reward.id);
}

export function deleteReward(replica: Replica, id: string): { deleted: { id: string; title: string } } {
  const reward = replica.deleteReward(id);
  return { deleted: { id: reward.id, title: reward.title } };
}

/** Spend a reward's cost. The result carries the claim id `unclaim_reward` takes back. */
export function claimReward(replica: Replica, id: string): { claimId: string; reward: string; spent: number; balance: number; checkedOff?: string } {
  const listItem = replica.rewardState().rewards.find(r => r.id === id)?.taskId;
  const itemTitle = listItem ? replica.taskById(listItem)?.title : undefined;
  const entry = replica.claimReward(id);
  return {
    claimId: entry.id,
    reward: entry.label,
    spent: entry.amount,
    balance: getRewards(replica, { historyLimit: 0 }).balance,
    ...(itemTitle ? { checkedOff: itemTitle } : {}),
  };
}

export function unclaimReward(replica: Replica, claimId: string): { returned: number; reward: string; balance: number } {
  const entry = replica.unclaimReward(claimId);
  return { returned: entry.amount, reward: entry.label, balance: getRewards(replica, { historyLimit: 0 }).balance };
}

/** The reward being saved for, or null to stop. */
export function setRewardGoal(replica: Replica, id: string | null): { goal: { id: string; title: string; cost: number } | null } {
  const reward = replica.setRewardGoal(id);
  return { goal: reward ? { id: reward.id, title: reward.title, cost: reward.cost } : null };
}

function rewardById(replica: Replica, id: string): SerializedReward {
  const found = getRewards(replica, { historyLimit: 0 }).rewards.find(r => r.id === id);
  if (found) return found;
  // A one-time reward claimed a moment ago is no longer on the list; say what it is.
  const raw = replica.rewardState().rewards.find(r => r.id === id)!;
  return { id: raw.id, title: raw.title, cost: raw.cost, oneTime: raw.oneTime, affordable: false, shortBy: raw.cost };
}

/** Post a coin bounty on a task, or withdraw the live one. */
export function setBounty(replica: Replica, taskId: string, posted: boolean): { id: string; title: string; bounty: string | null } {
  const task = posted ? replica.postBounty(taskId) : replica.withdrawBounty(taskId);
  return { id: task.id, title: replica.displayTitle(task), bounty: replica.lib().rewards.describeBounty(task) };
}

export interface MissedResult {
  missed: SerializedTask;
  /** What else the miss did, in plain words: the next occurrence, the streak, the coins. */
  effects: string[];
  nextTask: SerializedTask | null;
}

/**
 * Mark a repeating task's occurrence missed. The person has to have said so: the
 * app never claims a miss on their behalf (docs/arch/rewards.md), and neither
 * does this. `reopen_task` is the way back.
 */
export function markMissed(replica: Replica, id: string): MissedResult {
  const before = replica.taskById(id);
  const { rewardsEnabled } = replica.settings();
  const result = replica.markMissed(id);
  const effects = ['The occurrence is recorded as missed, which is not a completion.'];
  if (before && before.streakCount > 0) effects.push(`Its streak of ${before.streakCount} was broken.`);
  if (result.nextTask) effects.push(`The next occurrence was created${result.nextTask.dueDate ? `, due ${result.nextTask.dueDate.slice(0, 10)}` : ''}.`);
  if (rewardsEnabled) {
    const cost = replica.lib().rewards.coinsForLoss(result.completed);
    effects.push(`Rewards are on, so the miss costs ${cost} ${cost === 1 ? 'coin' : 'coins'}.`);
  }
  return {
    missed: serializeTasks(replica, [result.completed])[0],
    effects,
    nextTask: result.nextTask ? serializeTasks(replica, [result.nextTask])[0] : null,
  };
}

/** Log a slip against a "don't do this" habit, or take back today's latest one. */
export function setSlip(replica: Replica, id: string, logged: boolean): { task: SerializedTask } {
  const task = logged ? replica.logSlip(id) : replica.undoSlip(id);
  return { task: serializeTasks(replica, [task])[0] };
}
