import {
  COINS_BY_EFFORT,
  STREAK_BONUS_CAP,
  STREAK_BONUS_EVERY,
  baseCoinsFor,
  DEFAULT_EARN_RATE_PER_DAY,
  EARN_RATE_WINDOW_DAYS,
  REWARD_FREQUENCIES,
  REWARD_IDEAS,
  rewardIdeas,
  describeLastClaimed,
  goalProgress,
  lastClaimedAt,
  rewardDisplay,
  rewardIsOpen,
  canClaimReward,
  coinBalance,
  describeRewardPace,
  earnRatePerDay,
  suggestRewardCost,
  coinsForCompletion,
  coinsForLoss,
  fullBountyFor,
  DIFFICULTY_MULTIPLIER,
  formatCoins,
  latestLossFor,
  parseRewardCost,
  signedAmount,
  sortCoinEntries,
  streakBonusFor,
  taskEarnsCoins,
  BOUNTY_MIN_COINS,
  BOUNTY_PUSHES_TO_EXPIRE,
  BOUNTY_WITHDRAWN,
  DEFAULT_BOUNTY_LIMIT,
  MAX_BOUNTY_LIMIT,
  bountyCoinsFor,
  canPostBounty,
  describeBounty,
  isBountyLive,
  liveBountyCount,
  nextBountyPushes,
  parseBountyLimit,
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

describe('difficulty', () => {
  const rated = (estimatedMinutes: number | null, difficulty: 'easy' | 'normal' | 'hard') =>
    ({ ...task(estimatedMinutes), difficulty });

  it('leaves a normal or unrated task exactly as it was', () => {
    expect(DIFFICULTY_MULTIPLIER.normal).toBe(1);
    expect(baseCoinsFor(rated(30, 'normal'))).toBe(baseCoinsFor(task(30)));
    expect(baseCoinsFor(rated(600, 'normal'))).toBe(12);
    expect(baseCoinsFor({ ...task(30), difficulty: null })).toBe(3);
  });

  it('doubles a hard task, so a quick dreaded call is worth more than a coin', () => {
    expect(baseCoinsFor(rated(1, 'hard'))).toBe(2);
    expect(baseCoinsFor(rated(30, 'hard'))).toBe(6);
    expect(baseCoinsFor(rated(600, 'hard'))).toBe(24);
  });

  it('halves an easy task, rounding, and never below 1', () => {
    expect(baseCoinsFor(rated(600, 'easy'))).toBe(6);
    expect(baseCoinsFor(rated(90, 'easy'))).toBe(3);
    expect(baseCoinsFor(rated(1, 'easy'))).toBe(1);
  });

  it('carries into a completion and a bounty', () => {
    expect(coinsForCompletion(rated(30, 'hard'), 0)).toBe(6);
    expect(fullBountyFor(rated(30, 'hard'))).toBe(6);
  });

  it('never makes a miss cost more than the time amount', () => {
    expect(coinsForLoss(rated(30, 'hard'))).toBe(3);
    expect(coinsForLoss(rated(30, 'normal'))).toBe(3);
  });

  it('never makes an easy task cost more to miss than it earns', () => {
    expect(coinsForLoss(rated(600, 'easy'))).toBe(6);
    expect(coinsForLoss(rated(600, 'easy'))).toBeLessThanOrEqual(baseCoinsFor(rated(600, 'easy')));
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

describe('earnRatePerDay', () => {
  const now = new Date(2026, 9, 3, 12);
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
  const done = (over: Partial<Parameters<typeof earnRatePerDay>[0][number]> = {}) => ({
    ...task(30),
    parentId: null,
    completed: true,
    completedAt: daysAgo(1),
    missedAt: null,
    streakCount: 0,
    ...over,
  });

  it('averages coins over the history actually there', () => {
    // Ten days of history, 3 coins a day.
    const tasks = Array.from({ length: 10 }, (_, i) => done({ completedAt: daysAgo(i + 0.5) }));
    expect(earnRatePerDay(tasks, now)).toBeCloseTo(30 / 9.5);
  });

  it('takes misses off and leaves subtasks and open tasks out', () => {
    const tasks = [
      done({ completedAt: daysAgo(10) }),
      done({ completedAt: daysAgo(2), missedAt: daysAgo(2) }),
      done({ completedAt: daysAgo(3), parentId: 'p' }),
      done({ completedAt: null, completed: false }),
    ];
    expect(earnRatePerDay(tasks, now)).toBeCloseTo(0 / 10);
  });

  it('counts the streak bonus each completion was paid', () => {
    const tasks = [done({ completedAt: daysAgo(10), streakCount: 7 })];
    expect(earnRatePerDay(tasks, now)).toBeCloseTo(4 / 10);
  });

  it('ignores completions older than the window', () => {
    const tasks = [
      done({ completedAt: daysAgo(EARN_RATE_WINDOW_DAYS + 5) }),
      done({ completedAt: daysAgo(10) }),
    ];
    expect(earnRatePerDay(tasks, now)).toBeCloseTo(3 / 10);
  });

  it('refuses to guess from less than a week of history', () => {
    expect(earnRatePerDay([done({ completedAt: daysAgo(3) })], now)).toBeNull();
    expect(earnRatePerDay([], now)).toBeNull();
  });
});

describe('suggestRewardCost', () => {
  it('multiplies the rate by the days between claims', () => {
    expect(suggestRewardCost(3, 1)).toBe(3);
    expect(suggestRewardCost(3, 2.5)).toBe(8);
  });

  it('rounds to a clean price as it grows', () => {
    expect(suggestRewardCost(9.3, 7)).toBe(65);
    expect(suggestRewardCost(9.3, 30)).toBe(280);
    expect(suggestRewardCost(50, 30)).toBe(1500);
  });

  it('never suggests less than one coin', () => {
    expect(suggestRewardCost(0.1, 1)).toBe(1);
  });

  it('suggests nothing without a rate to price from', () => {
    expect(suggestRewardCost(null, 7)).toBeNull();
    expect(suggestRewardCost(0, 7)).toBeNull();
    expect(suggestRewardCost(-2, 7)).toBeNull();
  });
});

describe('describeRewardPace', () => {
  it('names the interval in days, then weeks, then months', () => {
    expect(describeRewardPace(10, 5)).toBe('more than once a day at your current pace');
    expect(describeRewardPace(10, 10)).toBe('about every day at your current pace');
    expect(describeRewardPace(10, 60)).toBe('about every 6 days at your current pace');
    expect(describeRewardPace(10, 210)).toBe('about every 3 weeks at your current pace');
    expect(describeRewardPace(10, 300)).toBe('about every 4 weeks at your current pace');
    expect(describeRewardPace(10, 700)).toBe('about every 2 months at your current pace');
    expect(describeRewardPace(10, 610)).toBe('about every 2 months at your current pace');
  });

  it('says nothing without a rate', () => {
    expect(describeRewardPace(null, 50)).toBeNull();
    expect(describeRewardPace(0, 50)).toBeNull();
  });
});

describe('rewardIdeas', () => {
  it('prices every idea by its frequency at your rate', () => {
    const ideas = rewardIdeas([], 4);
    expect(ideas).toHaveLength(REWARD_IDEAS.length);
    const takeout = ideas.find(i => i.title === 'Takeout dinner')!;
    expect(takeout).toMatchObject({ frequencyLabel: 'Weekly', cost: 30 });
  });

  it('falls back to the default rate with too little history', () => {
    const weekly = REWARD_FREQUENCIES.find(f => f.id === 'weekly')!;
    const takeout = rewardIdeas([], null).find(i => i.title === 'Takeout dinner')!;
    expect(takeout.cost).toBe(DEFAULT_EARN_RATE_PER_DAY * weekly.days);
    expect(rewardIdeas([], -3).find(i => i.title === 'Takeout dinner')!.cost).toBe(takeout.cost);
  });

  it('leaves out ideas already on the list, ignoring case and spaces', () => {
    const ideas = rewardIdeas(['  takeout DINNER '], 4);
    expect(ideas.some(i => i.title === 'Takeout dinner')).toBe(false);
    expect(ideas).toHaveLength(REWARD_IDEAS.length - 1);
  });

  it('names only frequencies that exist', () => {
    const ids = new Set(REWARD_FREQUENCIES.map(f => f.id));
    expect(REWARD_IDEAS.every(i => ids.has(i.frequency))).toBe(true);
  });
});

describe('a reward on the list', () => {
  const spend = (rewardId: string, at: string) => entry({ id: `s-${at}`, kind: 'spend', rewardId, at });
  const item = (over = {}) => ({ title: 'Headphones', notes: 'The blue ones', linkUrl: 'https://example.com', completed: false, archived: false, ...over });
  const reward = (over = {}) => ({ id: 'r', title: 'Old title', note: null, linkUrl: null, oneTime: false, taskId: null, ...over });

  it('finds when a reward was last claimed', () => {
    const entries = [spend('r', '2026-10-01T09:00:00.000Z'), spend('r', '2026-10-02T09:00:00.000Z'), spend('x', '2026-10-03T09:00:00.000Z')];
    expect(lastClaimedAt(entries, 'r')).toBe('2026-10-02T09:00:00.000Z');
    expect(lastClaimedAt(entries, 'none')).toBeNull();
  });

  it('keeps a repeatable reward open after a claim', () => {
    expect(rewardIsOpen(reward(), [spend('r', '2026-10-01T09:00:00.000Z')], null)).toBe(true);
  });

  it('retires a one-time reward once claimed, and brings it back when the claim is undone', () => {
    const r = reward({ oneTime: true });
    expect(rewardIsOpen(r, [spend('r', '2026-10-01T09:00:00.000Z')], null)).toBe(false);
    expect(rewardIsOpen(r, [], null)).toBe(true);
  });

  it('retires a list reward whose item is checked off, archived or gone', () => {
    const r = reward({ taskId: 't', oneTime: true });
    expect(rewardIsOpen(r, [], item())).toBe(true);
    expect(rewardIsOpen(r, [], item({ completed: true }))).toBe(false);
    expect(rewardIsOpen(r, [], item({ archived: true }))).toBe(false);
    expect(rewardIsOpen(r, [], null)).toBe(false);
  });

  it('shows a list reward as its item, and its own fields otherwise', () => {
    expect(rewardDisplay(reward({ taskId: 't' }), item())).toEqual({ title: 'Headphones', note: 'The blue ones', linkUrl: 'https://example.com' });
    expect(rewardDisplay(reward({ taskId: 't' }), item({ notes: '  ' })).note).toBeNull();
    expect(rewardDisplay(reward({ taskId: 't' }), null).title).toBe('Old title');
    expect(rewardDisplay(reward({ note: 'n', linkUrl: 'ubereats://' }), null)).toEqual({ title: 'Old title', note: 'n', linkUrl: 'ubereats://' });
  });

  it('says when it was last claimed by calendar day', () => {
    const now = new Date(2026, 9, 3, 9);
    expect(describeLastClaimed(new Date(2026, 9, 3, 1).toISOString(), now)).toBe('Claimed today');
    expect(describeLastClaimed(new Date(2026, 9, 2, 23).toISOString(), now)).toBe('Claimed yesterday');
    expect(describeLastClaimed(new Date(2026, 8, 28, 12).toISOString(), now)).toBe('Last claimed 5 days ago');
  });

  it('measures progress toward a goal, clamped', () => {
    expect(goalProgress(30, 120)).toBe(0.25);
    expect(goalProgress(500, 120)).toBe(1);
    expect(goalProgress(-10, 120)).toBe(0);
    expect(goalProgress(10, 0)).toBe(0);
  });
});

describe('bounties', () => {
  const open = { completed: false, archived: false, parentId: null, polarity: 'positive' as const };
  const withBounty = (minutes: number | null, bountyPushes: number | null) => ({
    ...task(minutes), ...open, bountyPushes,
  });

  it('pays nothing without a bounty', () => {
    expect(bountyCoinsFor(withBounty(30, null))).toBe(0);
    expect(bountyCoinsFor(task(30))).toBe(0);
  });

  it('is never worth more after a push, and is gone at the expiry', () => {
    const values = [0, 1, 2, 3, 4].map(p => bountyCoinsFor(withBounty(480, p)));
    expect(values).toEqual([12, 8, 4, 0, 0]);
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeLessThanOrEqual(values[i - 1]);
  });

  it('floors a small task at the minimum, and every live step pays something', () => {
    const values = [0, 1, 2].map(p => bountyCoinsFor(withBounty(5, p)));
    expect(values[0]).toBe(BOUNTY_MIN_COINS);
    expect(values).toEqual([3, 2, 1]);
  });

  it('adds the bounty to a completion but not to a loss', () => {
    expect(coinsForCompletion(withBounty(30, 0), 0)).toBe(3 + 3);
    expect(coinsForLoss(withBounty(30, 0))).toBe(3);
  });

  it('counts pushes from the post and never resets on a pull', () => {
    expect(nextBountyPushes(null, true)).toBeNull();
    expect(nextBountyPushes(undefined, true)).toBeNull();
    expect(nextBountyPushes(0, true)).toBe(1);
    expect(nextBountyPushes(2, false)).toBe(2);
    expect(nextBountyPushes(BOUNTY_PUSHES_TO_EXPIRE, true)).toBe(BOUNTY_PUSHES_TO_EXPIRE);
  });

  it('takes a slot only while it is live', () => {
    expect(isBountyLive(withBounty(30, 0))).toBe(true);
    expect(isBountyLive(withBounty(30, BOUNTY_WITHDRAWN))).toBe(false);
    expect(isBountyLive({ ...withBounty(30, 0), completed: true })).toBe(false);
    expect(liveBountyCount([withBounty(30, 0), withBounty(30, 2), withBounty(30, 3), withBounty(30, null)])).toBe(2);
  });

  it('refuses a repost on the same occurrence, a subtask and a negative habit', () => {
    expect(canPostBounty(withBounty(30, null))).toBe(true);
    expect(canPostBounty(withBounty(30, BOUNTY_WITHDRAWN))).toBe(false);
    expect(canPostBounty({ ...withBounty(30, null), parentId: 'p' })).toBe(false);
    expect(canPostBounty({ ...withBounty(30, null), polarity: 'negative' })).toBe(false);
    expect(canPostBounty({ ...withBounty(30, null), completed: true })).toBe(false);
  });

  it('reads a stored limit back, clamped', () => {
    expect(parseBountyLimit(null)).toBe(DEFAULT_BOUNTY_LIMIT);
    expect(parseBountyLimit('')).toBe(DEFAULT_BOUNTY_LIMIT);
    expect(parseBountyLimit('nope')).toBe(DEFAULT_BOUNTY_LIMIT);
    expect(parseBountyLimit('0')).toBe(1);
    expect(parseBountyLimit('99')).toBe(MAX_BOUNTY_LIMIT);
    expect(parseBountyLimit('3')).toBe(3);
  });

  it('says what the next push costs', () => {
    expect(describeBounty(withBounty(480, 0))).toBe('+12 coins extra when done. Moving it again drops it to +8 coins.');
    expect(describeBounty(withBounty(480, 2))).toBe('+4 coins extra when done. Moving it again ends the bounty.');
    expect(describeBounty(withBounty(480, null))).toBeNull();
  });
});
