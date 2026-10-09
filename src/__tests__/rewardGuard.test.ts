import {
  canGuard,
  claimedSince,
  describeGuard,
  guardChargeSeed,
  guardedSlipPrompt,
  guardingReward,
  isGuardableHabit,
  planGuardedSlip,
} from '../utils/rewardGuard';
import type { CoinEntry, Reward, Task } from '../types';

const DAY = new Date(2026, 9, 9, 4, 0, 0);

const reward = (over: Partial<Reward> = {}): Reward => ({
  id: 'dessert', title: 'A dessert', cost: 110, createdAt: '2026-01-01T00:00:00.000Z',
  linkUrl: null, note: null, oneTime: false, taskId: null, priceMinor: null, guardsTaskId: 'no-dessert',
  ...over,
});

const habit = (over: Partial<Task> = {}) => ({
  id: 'no-dessert', polarity: 'negative' as const, slipCount: 0, slipDate: null, slipAllowance: null,
  streakCount: 12, streakDate: null, previousStreakCount: 0, previousStreakDate: null, priorBestStreak: 0,
  ...over,
}) as Task;

const plan = (over: { task?: Task; rewards?: Reward[]; balance?: number; rewardsEnabled?: boolean } = {}) =>
  planGuardedSlip({
    task: over.task ?? habit(),
    rewards: over.rewards ?? [reward()],
    balance: over.balance ?? 207,
    todayStart: DAY,
    rewardsEnabled: over.rewardsEnabled ?? true,
  });

describe('canGuard', () => {
  it('refuses a one-time or wish list reward', () => {
    expect(canGuard({ oneTime: false, taskId: null })).toBe(true);
    expect(canGuard({ oneTime: true, taskId: null })).toBe(false);
    expect(canGuard({ oneTime: true, taskId: 'boots' })).toBe(false);
  });
});

describe('isGuardableHabit', () => {
  it('takes only a live top-level avoid habit', () => {
    const base = { polarity: 'negative' as const, parentId: null, completed: false, archived: false };
    expect(isGuardableHabit(base)).toBe(true);
    expect(isGuardableHabit({ ...base, polarity: 'positive' })).toBe(false);
    expect(isGuardableHabit({ ...base, parentId: 'p' })).toBe(false);
    expect(isGuardableHabit({ ...base, archived: true })).toBe(false);
    expect(isGuardableHabit({ ...base, completed: true })).toBe(false);
  });
});

describe('guardingReward', () => {
  it('finds the reward naming the habit, cheapest first', () => {
    const cheap = reward({ id: 'cheap', cost: 50 });
    expect(guardingReward([cheap, reward()], 'no-dessert')?.id).toBe('cheap');
    expect(guardingReward([reward()], 'other')).toBeNull();
  });

  it('ignores a link left on a reward that can no longer guard', () => {
    expect(guardingReward([reward({ oneTime: true })], 'no-dessert')).toBeNull();
  });
});

describe('planGuardedSlip', () => {
  it('claims the reward when the balance covers it', () => {
    expect(plan()).toEqual({ kind: 'claim', reward: reward() });
    expect(plan({ balance: 110 })?.kind).toBe('claim');
  });

  it('charges the whole balance when it falls short, never below zero', () => {
    expect(plan({ balance: 50 })).toEqual({ kind: 'charge', reward: reward(), amount: 50 });
    expect(plan({ balance: 0 })).toEqual({ kind: 'charge', reward: reward(), amount: 0 });
    expect(plan({ balance: -20 })).toEqual({ kind: 'charge', reward: reward(), amount: 0 });
  });

  it('is an ordinary slip with rewards off or no guarding reward', () => {
    expect(plan({ rewardsEnabled: false })).toBeNull();
    expect(plan({ rewards: [reward({ guardsTaskId: null })] })).toBeNull();
  });

  // A slip inside the habit's own allowance costs nothing either way, so
  // there is nothing to claim the reward for.
  it('leaves a slip inside the allowance alone', () => {
    expect(plan({ task: habit({ slipAllowance: 1 }) })).toBeNull();
    const used = habit({ slipAllowance: 1, slipCount: 1, slipDate: DAY.toISOString() });
    expect(plan({ task: used })?.kind).toBe('claim');
  });
});

describe('guardChargeSeed', () => {
  it('names the habit, the day and which slip it was', () => {
    expect(guardChargeSeed('h', DAY, 0)).toBe('coin-slip-guard:h:2026-10-09:0');
    expect(guardChargeSeed('h', DAY, 1)).not.toBe(guardChargeSeed('h', DAY, 0));
  });
});

describe('claimedSince', () => {
  const entry = (at: Date, over: Partial<CoinEntry> = {}): CoinEntry => ({
    id: 'e', kind: 'spend', amount: 110, at: at.toISOString(), taskId: null, rewardId: 'dessert', label: 'A dessert', ...over,
  });

  it('counts a claim on the logical day only', () => {
    expect(claimedSince([entry(new Date(2026, 9, 9, 13))], 'dessert', DAY)).toBe(true);
    // 2am is still yesterday under a 4am day start.
    expect(claimedSince([entry(new Date(2026, 9, 9, 2))], 'dessert', DAY)).toBe(false);
    expect(claimedSince([entry(new Date(2026, 9, 9, 13), { rewardId: 'coffee' })], 'dessert', DAY)).toBe(false);
  });
});

describe('guardedSlipPrompt', () => {
  it('offers the claim', () => {
    const p = guardedSlipPrompt({ kind: 'claim', reward: reward() }, 207, false);
    expect(p.title).toBe('Claim A dessert?');
    expect(p.message).toBe('This spends 110 coins on A dessert instead of counting a slip, so your streak stays.');
    expect(p.confirm).toBe('Claim it');
  });

  it('says when it was already claimed today', () => {
    expect(guardedSlipPrompt({ kind: 'claim', reward: reward() }, 207, true).message).toMatch(/already claimed it once today/);
  });

  it('names what a charge takes', () => {
    expect(guardedSlipPrompt({ kind: 'charge', reward: reward(), amount: 50 }, 50, false).message)
      .toBe('A dessert costs 110 coins and you have 50 coins, so this slip takes all of it.');
    expect(guardedSlipPrompt({ kind: 'charge', reward: reward(), amount: 0 }, 0, false).message)
      .toBe('A dessert costs 110 coins and you have no coins, so this slip costs none.');
  });
});

describe('describeGuard', () => {
  it('names the habit', () => {
    expect(describeGuard('No dessert unless claimed')).toBe('Slips on “No dessert unless claimed” pay for this');
  });
});
