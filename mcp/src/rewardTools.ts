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
import type { CoinEntry, Reward, RewardUnlock } from '../../src/types';
import type { Replica, UnlockInput } from './replica';
import { serializeTasks, type SerializedTask } from './serialize';

export interface SerializedReward {
  id: string;
  title: string;
  cost: number;
  /** The dollar price in major units, for a reward priced in money. `cost` is that price at the current rate. */
  price?: number;
  /** Sales tax is added to `price` before it becomes coins. Absent when the reward isn't taxable. */
  taxable?: true;
  note?: string;
  link?: string;
  /** Claimed once, then gone from the list. */
  oneTime: boolean;
  /** The wish-list task this reward is. Claimed in the app only. */
  wishListTaskId?: string;
  /**
   * The "don't do this" habit this reward guards, and its title: a slip logged
   * on it claims this reward when the balance covers it, and otherwise costs
   * the balance up to its price.
   */
  guardsHabitId?: string;
  guardsHabit?: string;
  /** Claimable once per this many days (a week is 7, a month 30). Absent when unlimited. */
  claimEveryDays?: number;
  /** The emoji on the reward's tile. Absent when it has none. */
  glyph?: string;
  /** Days until a limited reward can be claimed again. Absent when it can be claimed now. */
  availableInDays?: number;
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
  /** Coins of this entry that went into (an earning) or came out of (a loss or claim) the savings for the goal. */
  saved?: number;
}

/** An unlock: something opened by doing a share of today's work, costing no coins. */
export interface SerializedUnlock {
  id: string;
  title: string;
  /** locked, open (worked for, or play already started today), or free (a weekend or vacation it is set to open on). */
  status: 'locked' | 'open' | 'free';
  /** Percent of today's work (counted in coins) that opens it. */
  unlocksAtPct: number;
  /** Percent of today's work done so far. */
  donePct: number;
  /** Coins still to earn today before it opens. Absent once open. */
  coinsShort?: number;
  /** Required tasks due today and not done yet. */
  stillNeeds?: string[];
  /** The tasks it also needs done on the days they are due (ids; any repeat of one counts). */
  alsoNeedsTaskIds?: string[];
  /** Minutes of play a day, when it has a timer. */
  playMinutes?: number;
  /** Minutes of today's play left, when it has a timer. */
  playLeftMinutes?: number;
  playing: boolean;
  freeOnWeekends: boolean;
  freeOnVacation: boolean;
  /** The "don't do this" habit it is linked to, and its id. */
  linkedHabit?: string;
  linkedHabitId?: string;
  /** It keeps a code (a parental controls PIN) for the person. The code itself is never shown here. */
  hasCode?: true;
}

export interface RewardsReport {
  /** False when rewards are switched off. Nothing below is being kept then. */
  enabled: boolean;
  balance: number;
  goal: { id: string; title: string; cost: number; progress: number; shortBy: number } | null;
  /**
   * Savings for the goal, while a plan is in force: that share of every coin
   * earned is set aside, and other rewards are paid from `spending`. A claim
   * that needs some of `saved` needs useSavings. Null with no plan, when the
   * goal reads off the whole balance.
   */
  savings: { sharePct: number; saved: number; spending: number; wantedBy?: string; pace?: string } | null;
  /** Unlocks: opened by today's work, not bought. They never move coins. */
  unlocks: SerializedUnlock[];
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
    ...(e.saved ? { saved: e.saved } : {}),
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
    const wait = lib.claimWaitDays(reward, entries, replica.currentDayStart());
    return [{
      id: reward.id,
      title: shown.title,
      cost: reward.cost,
      ...(reward.priceMinor !== null ? { price: reward.priceMinor / 100 } : {}),
      ...(reward.priceMinor !== null && reward.taxable ? { taxable: true as const } : {}),
      ...(shown.note ? { note: shown.note } : {}),
      ...(shown.linkUrl ? { link: shown.linkUrl } : {}),
      oneTime: reward.oneTime,
      ...(reward.taskId ? { wishListTaskId: reward.taskId } : {}),
      ...guardOf(replica, reward),
      ...(reward.glyph ? { glyph: reward.glyph } : {}),
      ...(reward.claimEveryDays && !reward.oneTime ? { claimEveryDays: reward.claimEveryDays } : {}),
      ...(wait > 0 ? { availableInDays: wait } : {}),
      affordable: lib.canClaimReward(balance, reward.cost),
      shortBy: Math.max(0, reward.cost - balance),
      ...(last ? { lastClaimedAt: last } : {}),
      ...(reward.id === settings.rewardGoalId ? { goal: true } : {}),
    }];
  });

  const goalReward = open.find(r => r.goal);
  const limit = Math.max(0, Math.floor(input.historyLimit ?? DEFAULT_HISTORY_LIMIT));
  const { rewardSavings, rewardUnlocks } = replica.lib();
  const plan = rewardSavings.activeGoalPlan(settings.rewardGoalPlan, settings.rewardGoalId, !!goalReward);
  const saved = rewardSavings.savingsBalance(entries, plan);
  const spending = rewardSavings.spendingBalance(balance, saved);
  const today = replica.currentDayStart();
  const rate = plan ? lib.earnRatePerDay(replica.tasks(), new Date()) : null;
  // While saving, a reward other than the goal is paid from spending money.
  if (plan) {
    for (const r of open) {
      if (r.goal) continue;
      r.affordable = lib.canClaimReward(spending, r.cost);
      r.shortBy = Math.max(0, r.cost - Math.max(0, spending));
    }
  }
  const goalHave = plan ? saved : balance;
  return {
    enabled: settings.rewardsEnabled,
    balance,
    goal: goalReward
      ? { id: goalReward.id, title: goalReward.title, cost: goalReward.cost, progress: lib.goalProgress(goalHave, goalReward.cost), shortBy: Math.max(0, goalReward.cost - goalHave) }
      : null,
    savings: plan && goalReward
      ? {
        sharePct: plan.sharePct,
        saved,
        spending,
        ...(plan.by ? { wantedBy: plan.by } : {}),
        ...(() => {
          const pace = rewardSavings.describeGoalPace(goalReward.cost, saved, rate, plan, today);
          return pace ? { pace } : {};
        })(),
      }
      : null,
    unlocks: unlocksOf(replica, entries),
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
  /** Coins. Give this or `price`. */
  cost?: number;
  /** Dollars (major units, up to two decimals), converted to coins at the person's rate. Null on an update clears it. */
  price?: number | null;
  /** Add the person's sales tax rate to `price`. Needs a rate set in Rewards. Dropped with the price. */
  taxable?: boolean;
  note?: string | null;
  link?: string | null;
  oneTime?: boolean;
  /** The "don't do this" habit's task id this reward guards. Null on an update unlinks it. */
  guardsHabitId?: string | null;
  /** Claimable once per this many days (a week is 7, a month 30). Null on an update removes the limit. Not on a oneTime reward. */
  claimEveryDays?: number | null;
  /** The emoji on the reward's tile, like "☕". Null on an update clears it. */
  glyph?: string | null;
}

/** The habit a reward guards, as the serialized reward names it. */
function guardOf(replica: Replica, reward: Reward): Pick<SerializedReward, 'guardsHabitId' | 'guardsHabit'> {
  if (!reward.guardsTaskId || reward.oneTime || reward.taskId) return {};
  const habit = replica.taskById(reward.guardsTaskId);
  return habit ? { guardsHabitId: habit.id, guardsHabit: replica.displayTitle(habit) } : {};
}

/**
 * Coins per dollar: the person's weekly earning over their typed weekly reward
 * budget (`coinsPerDollar`). Null until both exist, and a dollar price is
 * refused rather than guessed while it is.
 */
function exchangeRate(replica: Replica): number | null {
  const { rewards: lib } = replica.lib();
  const rate = lib.earnRatePerDay(replica.tasks(), new Date());
  return lib.coinsPerDollar(rate, replica.settings().rewardWeeklyBudgetMinor);
}

/** A typed dollar amount to minor units, refusing more than two decimals so nothing is rounded silently. */
function priceToMinor(price: number): number {
  const minor = Math.round(price * 100);
  if (!(price > 0) || Math.abs(minor - price * 100) > 1e-6) {
    throw new Error('price must be a positive amount with at most two decimals, like 4.5.');
  }
  return minor;
}

/**
 * The tax rate to add when `taxable`. A call that asks for tax is refused when
 * no rate is set rather than quietly skipping it; a reward that was already
 * marked taxable is priced as typed, the way the app prices it ("no rate means
 * no tax, not an error"), so a new price alone doesn't fail on it.
 */
function taxFor(replica: Replica, taxable: boolean, asked: boolean): number | null {
  if (!taxable) return null;
  const percent = replica.settings().rewardSalesTaxPercent;
  if (percent === null && asked) {
    throw new Error('taxable needs a sales tax rate: the person has to set one in Rewards under Exchange rate.');
  }
  return percent;
}

function costForPrice(replica: Replica, priceMinor: number, taxable = false, asked = taxable): number {
  const rate = exchangeRate(replica);
  if (rate === null) {
    throw new Error('A dollar price needs a coin-to-dollar rate: the person has to set a weekly reward budget in Rewards, and have about a week of completed tasks. Give a cost in coins instead.');
  }
  const { rewards: lib } = replica.lib();
  return lib.coinsForPrice(lib.priceWithTax(priceMinor, taxable, taxFor(replica, taxable, asked)), rate);
}

/** A new reward. Give a coin cost, or a dollar price the person's own rate converts to one. */
export function createReward(replica: Replica, input: RewardInput): SerializedReward {
  if ((input.cost === undefined) === (input.price == null)) {
    throw new Error('Give either cost (coins) or price (dollars), not both and not neither.');
  }
  const priceMinor = input.price != null ? priceToMinor(input.price) : null;
  if (input.taxable && priceMinor === null) throw new Error('taxable goes with a dollar price. Give price, or leave taxable out.');
  const taxable = !!input.taxable;
  const cost = priceMinor !== null ? costForPrice(replica, priceMinor, taxable) : input.cost!;
  const reward = replica.addReward(input.title, cost, { note: input.note, linkUrl: input.link, oneTime: input.oneTime, priceMinor, taxable, guardsTaskId: input.guardsHabitId, claimEveryDays: input.claimEveryDays, glyph: input.glyph });
  return rewardById(replica, reward.id);
}

export function updateReward(
  replica: Replica,
  id: string,
  patch: Partial<RewardInput>,
): SerializedReward {
  if (patch.cost !== undefined && patch.price != null) {
    throw new Error('Give either cost (coins) or price (dollars), not both.');
  }
  // A new price recomputes the coins; a coin cost on its own makes the reward
  // coin-priced, so a stale dollar price can't repaint it later.
  const priceMinor = patch.price != null ? priceToMinor(patch.price) : undefined;
  const current = replica.rewardState().rewards.find(r => r.id === id);
  // The price the reward ends up with, and whether it is taxed: tax follows the
  // price, so a coin cost or a null price drops it.
  const pricedAt = priceMinor !== undefined ? priceMinor : patch.cost !== undefined || patch.price === null ? null : current?.priceMinor ?? null;
  const taxable = pricedAt !== null && (patch.taxable ?? current?.taxable ?? false);
  if (patch.taxable && pricedAt === null) throw new Error('taxable goes with a dollar price. Give price, or leave taxable out.');
  // A change to the tax alone reprices the reward it applies to.
  const cost = pricedAt !== null && (priceMinor !== undefined || patch.taxable !== undefined)
    ? costForPrice(replica, pricedAt, taxable, patch.taxable === true)
    : patch.cost;
  const reward = replica.updateReward(id, {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(cost !== undefined ? { cost } : {}),
    ...(priceMinor !== undefined ? { priceMinor } : patch.cost !== undefined || patch.price === null ? { priceMinor: null } : {}),
    ...(patch.taxable !== undefined || priceMinor !== undefined || pricedAt === null ? { taxable } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.link !== undefined ? { linkUrl: patch.link } : {}),
    ...(patch.oneTime !== undefined ? { oneTime: patch.oneTime } : {}),
    ...(patch.guardsHabitId !== undefined ? { guardsTaskId: patch.guardsHabitId } : {}),
    ...(patch.claimEveryDays !== undefined ? { claimEveryDays: patch.claimEveryDays } : {}),
    ...(patch.glyph !== undefined ? { glyph: patch.glyph } : {}),
  });
  return rewardById(replica, reward.id);
}

export function deleteReward(replica: Replica, id: string): { deleted: { id: string; title: string } } {
  const reward = replica.deleteReward(id);
  return { deleted: { id: reward.id, title: reward.title } };
}

/** Spend a reward's cost. The result carries the claim id `unclaim_reward` takes back. */
export function claimReward(replica: Replica, id: string, useSavings = false): { claimId: string; reward: string; spent: number; fromSavings?: number; balance: number; checkedOff?: string } {
  const before = replica.rewardState().rewards.find(r => r.id === id);
  // A dollar-priced reward is claimed at today's rate, the way the app
  // reprices it when its screen opens, so a stale cost isn't what gets spent.
  if (before && before.priceMinor !== null && !before.taskId) {
    const rate = exchangeRate(replica);
    if (rate !== null) {
      const { rewards: lib } = replica.lib();
      const priced = lib.priceWithTax(before.priceMinor, before.taxable, replica.settings().rewardSalesTaxPercent);
      const fresh = lib.coinsForPrice(priced, rate);
      if (fresh !== before.cost) replica.updateReward(id, { cost: fresh });
    }
  }
  const listItem = before?.taskId;
  const itemTitle = listItem ? replica.taskById(listItem)?.title : undefined;
  const entry = replica.claimReward(id, useSavings);
  return {
    claimId: entry.id,
    reward: entry.label,
    spent: entry.amount,
    ...(entry.saved ? { fromSavings: entry.saved } : {}),
    balance: getRewards(replica, { historyLimit: 0 }).balance,
    ...(itemTitle ? { checkedOff: itemTitle } : {}),
  };
}

export function unclaimReward(replica: Replica, claimId: string): { returned: number; reward: string; balance: number } {
  const entry = replica.unclaimReward(claimId);
  return { returned: entry.amount, reward: entry.label, balance: getRewards(replica, { historyLimit: 0 }).balance };
}

/** The reward being saved for, or null to stop. */
export function setRewardGoal(
  replica: Replica,
  id: string | null,
  plan?: { sharePct?: number; byDate?: string; putBalanceIn?: boolean },
): { goal: { id: string; title: string; cost: number } | null; savings: RewardsReport['savings'] } {
  const reward = replica.setRewardGoal(id, plan);
  return { goal: reward ? { id: reward.id, title: reward.title, cost: reward.cost } : null, savings: getRewards(replica, { historyLimit: 0 }).savings };
}

function rewardById(replica: Replica, id: string): SerializedReward {
  const found = getRewards(replica, { historyLimit: 0 }).rewards.find(r => r.id === id);
  if (found) return found;
  // A one-time reward claimed a moment ago is no longer on the list; say what it is.
  const raw = replica.rewardState().rewards.find(r => r.id === id)!;
  return { id: raw.id, title: raw.title, cost: raw.cost, oneTime: raw.oneTime, ...guardOf(replica, raw), affordable: false, shortBy: raw.cost };
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

/**
 * Log a slip against a "don't do this" habit, or take back today's latest one.
 * On a habit a reward guards, a slip the balance covers claims the reward
 * instead: `claimed` says so, with the `claimId` unclaim_reward takes back.
 */
export function setSlip(replica: Replica, id: string, logged: boolean): {
  task: SerializedTask;
  claimed?: { claimId: string; reward: string; spent: number; balance: number };
} {
  if (!logged) return { task: serializeTasks(replica, [replica.undoSlip(id)])[0] };
  const { task, claim } = replica.logSlip(id);
  return {
    task: serializeTasks(replica, [task])[0],
    ...(claim ? {
      claimed: {
        claimId: claim.id,
        reward: claim.label,
        spent: claim.amount,
        balance: replica.lib().rewards.coinBalance(replica.rewardState().entries),
      },
    } : {}),
  };
}

/** Each unlock as it stands today, read through the app's own rules. Never its code. */
function unlocksOf(replica: Replica, entries: CoinEntry[]): SerializedUnlock[] {
  const { unlocks } = replica.rewardState();
  if (unlocks.length === 0) return [];
  const world = { ...replica.unlockWorld(), entries };
  return unlocks.map(u => serializeUnlock(replica, u, world));
}

function serializeUnlock(
  replica: Replica,
  u: RewardUnlock,
  world: ReturnType<Replica['unlockWorld']>,
): SerializedUnlock {
  const { rewardUnlocks } = replica.lib();
  const { status } = rewardUnlocks.statusOfUnlock(u, world);
  const play = rewardUnlocks.playState(u, new Date(), world.todayKey);
  const habit = u.guardsTaskId ? replica.taskById(u.guardsTaskId) : null;
  const share = status.kind === 'free'
    ? rewardUnlocks.workShareDone(rewardUnlocks.coinsEarnedToday(world.entries, world.todayStart), rewardUnlocks.coinsStillOpenToday(world.onToday))
    : status.share;
  return {
    id: u.id,
    title: u.title,
    status: status.kind,
    unlocksAtPct: u.sharePct,
    donePct: Math.floor(share * 100),
    ...(status.kind === 'locked' && status.coinsShort > 0 ? { coinsShort: status.coinsShort } : {}),
    ...(status.kind === 'locked' && status.pending.length > 0 ? { stillNeeds: status.pending.map(t => replica.displayTitle(t)) } : {}),
    ...(u.requiredTaskIds.length > 0 ? { alsoNeedsTaskIds: u.requiredTaskIds } : {}),
    ...(u.playMinutes !== null ? { playMinutes: u.playMinutes, playLeftMinutes: Math.floor((play.remainingMs ?? 0) / 60_000) } : {}),
    playing: play.running,
    freeOnWeekends: u.freeOnWeekends,
    freeOnVacation: u.freeOnVacation,
    ...(habit ? { linkedHabit: replica.displayTitle(habit), linkedHabitId: habit.id } : {}),
    ...(u.pin ? { hasCode: true as const } : {}),
  };
}

/** What the unlock tools take: the form's fields under the names Claude reads back. */
export interface UnlockToolInput {
  title?: string;
  glyph?: string | null;
  unlocksAtPct?: number;
  alsoNeedsTaskIds?: string[];
  playMinutes?: number | null;
  freeOnWeekends?: boolean;
  freeOnVacation?: boolean;
  linkedHabitId?: string | null;
}

function unlockFields(input: UnlockToolInput): Partial<UnlockInput> {
  return {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.glyph !== undefined ? { glyph: input.glyph } : {}),
    ...(input.unlocksAtPct !== undefined ? { sharePct: input.unlocksAtPct } : {}),
    ...(input.alsoNeedsTaskIds !== undefined ? { requiredTaskIds: input.alsoNeedsTaskIds } : {}),
    ...(input.playMinutes !== undefined ? { playMinutes: input.playMinutes } : {}),
    ...(input.freeOnWeekends !== undefined ? { freeOnWeekends: input.freeOnWeekends } : {}),
    ...(input.freeOnVacation !== undefined ? { freeOnVacation: input.freeOnVacation } : {}),
    ...(input.linkedHabitId !== undefined ? { guardsTaskId: input.linkedHabitId } : {}),
  };
}

function unlockResult(replica: Replica, unlock: RewardUnlock): SerializedUnlock {
  return serializeUnlock(replica, unlock, replica.unlockWorld());
}

/** A new unlock. Defaults are the form's: 60% of today's work, two hours of play. */
export function createUnlock(replica: Replica, input: UnlockToolInput & { title: string }): SerializedUnlock {
  const { rewardUnlocks } = replica.lib();
  const fields = unlockFields(input);
  const unlock = replica.createUnlock({
    title: input.title,
    glyph: fields.glyph ?? null,
    sharePct: fields.sharePct ?? rewardUnlocks.DEFAULT_UNLOCK_SHARE,
    requiredTaskIds: fields.requiredTaskIds ?? [],
    playMinutes: fields.playMinutes !== undefined ? fields.playMinutes : 120,
    freeOnWeekends: fields.freeOnWeekends ?? false,
    freeOnVacation: fields.freeOnVacation ?? false,
    guardsTaskId: fields.guardsTaskId ?? null,
  });
  return unlockResult(replica, unlock);
}

export function updateUnlock(replica: Replica, id: string, input: UnlockToolInput): SerializedUnlock {
  return unlockResult(replica, replica.updateUnlock(id, unlockFields(input)));
}

export function deleteUnlock(replica: Replica, id: string): { deleted: { id: string; title: string } } {
  const unlock = replica.deleteUnlock(id);
  return { deleted: { id: unlock.id, title: unlock.title } };
}

/** Start, stop or add to today's play timer. */
export function setUnlockPlay(replica: Replica, id: string, action: 'start' | 'stop' | 'add', minutes?: number): SerializedUnlock {
  return unlockResult(replica, replica.unlockPlay(id, action, minutes));
}
