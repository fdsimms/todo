import {
  COINS_BY_EFFORT,
  STREAK_BONUS_CAP,
  STREAK_BONUS_EVERY,
  baseCoinsFor,
  canClaimReward,
  coinBalance,
  coinsForCompletion,
  coinsForLoss,
  formatCoins,
  latestLossFor,
  parseRewardCost,
  signedAmount,
  sortCoinEntries,
  streakBonusFor,
  taskEarnsCoins,
} from '../utils/rewards';
import type { CoinEntry, ChainItem, Effort } from '../types';

const task = (estimatedMinutes: number | null, effort: Effort = 0, chain?: ChainItem[]) => ({
  estimatedMinutes,
  effort,
  chainEnabled: !!chain,
  chainIndex: 0,
  chainItems: chain ?? [],
});

const entry = (over: Partial<CoinEntry>): CoinEntry => ({
  id: 'e',
  kind: 'earn',
  amount: 1,
  at: '2026-10-01T09:00:00.000Z',
  taskId: null,
  rewardId: null,
  label: 'x',
  ...over,
});

describe('baseCoinsFor', () => {
  it('pays the 15-minute rate for a task with no estimate', () => {
    expect(baseCoinsFor(task(null))).toBe(COINS_BY_EFFORT[0]);
    expect(COINS_BY_EFFORT[0]).toBe(COINS_BY_EFFORT[2]);
  });

  it('reads the effort bucket off the minutes', () => {
    expect(baseCoinsFor(task(1))).toBe(1);
    expect(baseCoinsFor(task(30))).toBe(3);
    expect(baseCoinsFor(task(90))).toBe(5);
    expect(baseCoinsFor(task(600))).toBe(12);
  });

  it('falls back to the coarse effort when there are no minutes', () => {
    expect(baseCoinsFor(task(null, 5))).toBe(8);
  });

  it('pays for the active chain step, not the whole routine', () => {
    const chain: ChainItem[] = [
      { id: 'a', title: 'Stretch', estimatedMinutes: 1 },
      { id: 'b', title: 'Run', estimatedMinutes: 90 },
    ];
    expect(baseCoinsFor(task(240, 0, chain))).toBe(1);
  });
});

describe('streakBonusFor', () => {
  it('adds nothing below the first step', () => {
    expect(streakBonusFor(0)).toBe(0);
    expect(streakBonusFor(STREAK_BONUS_EVERY - 1)).toBe(0);
  });

  it('adds one coin per step', () => {
    expect(streakBonusFor(STREAK_BONUS_EVERY)).toBe(1);
    expect(streakBonusFor(STREAK_BONUS_EVERY * 3 + 2)).toBe(3);
  });

  it('stops at the cap', () => {
    expect(streakBonusFor(10_000)).toBe(STREAK_BONUS_CAP);
  });

  it('treats junk as no streak', () => {
    expect(streakBonusFor(-4)).toBe(0);
    expect(streakBonusFor(NaN)).toBe(0);
  });
});

describe('coinsForCompletion and coinsForLoss', () => {
  it('adds the streak bonus to a completion', () => {
    expect(coinsForCompletion(task(30), STREAK_BONUS_EVERY * 2)).toBe(3 + 2);
  });

  it('charges a loss at the base value, with no streak term', () => {
    expect(coinsForLoss(task(30))).toBe(3);
  });
});

describe('taskEarnsCoins', () => {
  it('leaves subtasks out', () => {
    expect(taskEarnsCoins({ parentId: null })).toBe(true);
    expect(taskEarnsCoins({ parentId: 'p' })).toBe(false);
  });
});

describe('coinBalance', () => {
  it('adds earnings and takes off losses and spends', () => {
    expect(coinBalance([
      entry({ kind: 'earn', amount: 10 }),
      entry({ kind: 'loss', amount: 3 }),
      entry({ kind: 'spend', amount: 4 }),
    ])).toBe(3);
  });

  it('can go below zero', () => {
    expect(coinBalance([entry({ kind: 'loss', amount: 2 })])).toBe(-2);
  });

  it('is zero with nothing recorded', () => {
    expect(coinBalance([])).toBe(0);
  });
});

describe('canClaimReward', () => {
  it('needs the balance to cover the cost', () => {
    expect(canClaimReward(10, 10)).toBe(true);
    expect(canClaimReward(9, 10)).toBe(false);
    expect(canClaimReward(-1, 1)).toBe(false);
  });

  it('refuses a reward with no cost', () => {
    expect(canClaimReward(10, 0)).toBe(false);
  });
});

describe('parseRewardCost', () => {
  it('reads whole numbers, with separators and spaces', () => {
    expect(parseRewardCost('25')).toBe(25);
    expect(parseRewardCost(' 1,000 ')).toBe(1000);
  });

  it('refuses zero, fractions, words and anything past the ceiling', () => {
    expect(parseRewardCost('0')).toBeNull();
    expect(parseRewardCost('2.5')).toBeNull();
    expect(parseRewardCost('ten')).toBeNull();
    expect(parseRewardCost('')).toBeNull();
    expect(parseRewardCost('100001')).toBeNull();
  });
});

describe('formatting', () => {
  it('pluralizes coins', () => {
    expect(formatCoins(1)).toBe('1 coin');
    expect(formatCoins(-1)).toBe('-1 coin');
    expect(formatCoins(12)).toBe('12 coins');
  });

  it('signs a history row by kind', () => {
    expect(signedAmount(entry({ kind: 'earn', amount: 3 }))).toBe('+3');
    expect(signedAmount(entry({ kind: 'spend', amount: 3 }))).toBe('-3');
  });
});

describe('sortCoinEntries', () => {
  it('puts the newest first without touching the input', () => {
    const input = [
      entry({ id: 'old', at: '2026-10-01T09:00:00.000Z' }),
      entry({ id: 'new', at: '2026-10-02T09:00:00.000Z' }),
    ];
    expect(sortCoinEntries(input).map(e => e.id)).toEqual(['new', 'old']);
    expect(input[0].id).toBe('old');
  });
});

describe('latestLossFor', () => {
  it('finds the newest loss against the task', () => {
    const entries = [
      entry({ id: 'a', kind: 'loss', taskId: 't', at: '2026-10-01T09:00:00.000Z' }),
      entry({ id: 'b', kind: 'loss', taskId: 't', at: '2026-10-01T10:00:00.000Z' }),
      entry({ id: 'c', kind: 'earn', taskId: 't', at: '2026-10-01T11:00:00.000Z' }),
      entry({ id: 'd', kind: 'loss', taskId: 'other', at: '2026-10-01T12:00:00.000Z' }),
    ];
    expect(latestLossFor(entries, 't')?.id).toBe('b');
  });

  it('is null when nothing was charged', () => {
    expect(latestLossFor([], 't')).toBeNull();
  });
});
