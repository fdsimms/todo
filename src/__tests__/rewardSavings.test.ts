import type { CoinEntry } from '../types';
import {
  activeGoalPlan,
  cleanSavingsShare,
  daysToGoal,
  describeGoalPace,
  describeSetback,
  parseGoalPlan,
  savedForEarn,
  savedForLoss,
  savedForSpend,
  savingsBalance,
  savingsNeededFor,
  serializeGoalPlan,
  shareForDate,
  spendingBalance,
  spendingPerDay,
  splitsEntry,
  type GoalPlan,
} from '../utils/rewardSavings';
import { BALANCE_RESET_LABEL } from '../utils/rewards';

const SINCE = '2026-10-01T09:00:00.000Z';
const plan = (over: Partial<GoalPlan> = {}): GoalPlan => ({ rewardId: 'game', sharePct: 70, by: null, since: SINCE, deposit: 0, ...over });

let n = 0;
const entry = (kind: CoinEntry['kind'], amount: number, saved: number, at = '2026-10-02T09:00:00.000Z', extra: Partial<CoinEntry> = {}): CoinEntry => ({
  id: `e${n++}`, kind, amount, at, taskId: 't', rewardId: null, label: 'x', saved, ...extra,
});

describe('the stored plan', () => {
  it('round-trips', () => {
    const p = plan({ by: '2026-12-15', deposit: 58 });
    expect(parseGoalPlan(serializeGoalPlan(p))).toEqual(p);
  });

  it('reads nothing that is not a plan', () => {
    expect(parseGoalPlan('')).toBeNull();
    expect(parseGoalPlan('nope')).toBeNull();
    expect(parseGoalPlan(JSON.stringify({ rewardId: 'game' }))).toBeNull();
    expect(serializeGoalPlan(null)).toBe('');
  });

  it('cleans a stored share and date', () => {
    const p = parseGoalPlan(JSON.stringify({ rewardId: 'g', since: SINCE, sharePct: 250, by: 'soon', deposit: -3 }));
    expect(p).toMatchObject({ sharePct: 100, by: null, deposit: 0 });
    expect(cleanSavingsShare(0)).toBe(1);
    expect(cleanSavingsShare(NaN)).toBe(50);
  });

  it('is in force only for the goal, while it can be claimed', () => {
    expect(activeGoalPlan(plan(), 'game', true)).not.toBeNull();
    expect(activeGoalPlan(plan(), 'other', true)).toBeNull();
    expect(activeGoalPlan(plan(), 'game', false)).toBeNull();
    expect(activeGoalPlan(null, 'game', true)).toBeNull();
  });

  it('splits only entries from when it started', () => {
    expect(splitsEntry('2026-10-01T08:59:00.000Z', plan())).toBe(false);
    expect(splitsEntry(SINCE, plan())).toBe(true);
    expect(splitsEntry(SINCE, null)).toBe(false);
  });
});

describe('savingsBalance', () => {
  it('adds the deposit and what earnings put in, less what losses and claims took', () => {
    const entries = [entry('earn', 10, 7), entry('loss', 4, 3), entry('spend', 15, 6), entry('earn', 5, 0)];
    expect(savingsBalance(entries, plan({ deposit: 58 }))).toBe(58 + 7 - 3 - 6);
  });

  it('is zero with no plan', () => {
    expect(savingsBalance([entry('earn', 10, 7)], null)).toBe(0);
  });

  it('ignores entries from before the plan, so a new goal starts from its deposit', () => {
    const entries = [entry('earn', 10, 7, '2026-09-30T09:00:00.000Z'), entry('earn', 10, 7)];
    expect(savingsBalance(entries, plan())).toBe(7);
  });

  it('starts again after a reset, deposit included', () => {
    const reset = entry('spend', 80, 0, '2026-10-03T09:00:00.000Z', { taskId: null, rewardId: null, label: BALANCE_RESET_LABEL });
    const entries = [entry('earn', 10, 7), reset, entry('earn', 10, 7, '2026-10-04T09:00:00.000Z')];
    expect(savingsBalance(entries, plan({ deposit: 58 }))).toBe(7);
  });
});

describe('splitting an entry', () => {
  it('puts the share of an earning aside, rounded on the running total', () => {
    const p = plan({ sharePct: 70 });
    const entries: CoinEntry[] = [];
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const saved = savedForEarn(1, p, entries);
      total += saved;
      entries.push(entry('earn', 1, saved));
    }
    expect(total).toBe(7);
  });

  it('leaves out the entry being rewritten', () => {
    const p = plan({ sharePct: 50 });
    const existing = entry('earn', 10, 5);
    expect(savedForEarn(10, p, [existing], existing.id)).toBe(5);
  });

  it('takes a loss from savings by the share, never more than is saved', () => {
    expect(savedForLoss(10, plan(), 100)).toBe(7);
    expect(savedForLoss(10, plan(), 3)).toBe(3);
    expect(savedForLoss(10, plan(), 0)).toBe(0);
  });

  it('pays the goal from savings first', () => {
    expect(savedForSpend(600, 650, 580, true)).toBe(580);
    expect(savedForSpend(600, 700, 650, true)).toBe(600);
  });

  it('pays anything else from spending, and savings only for the rest', () => {
    expect(savedForSpend(15, 100, 50, false)).toBe(0);
    expect(savedForSpend(15, 59, 50, false)).toBe(6);
    expect(savingsNeededFor(15, 59, 50)).toBe(6);
    expect(savingsNeededFor(15, 100, 50)).toBe(0);
  });

  it('treats spending below zero as nothing to spend', () => {
    expect(spendingBalance(40, 50)).toBe(-10);
    expect(savingsNeededFor(15, 40, 50)).toBe(15);
  });
});

describe('pace', () => {
  const today = new Date(2026, 10, 3);

  it('works out the share that reaches the goal by a date', () => {
    expect(shareForDate(600, 0, 20, 42)).toBe(72);
    expect(shareForDate(600, 58, 20, 42)).toBe(65);
    expect(shareForDate(600, 0, 1, 10)).toBe(100);
    expect(shareForDate(600, 0, null, 42)).toBeNull();
  });

  it('counts the days left and what is left to spend', () => {
    expect(daysToGoal(600, 300, 20, 50)).toBe(30);
    expect(daysToGoal(600, 600, 20, 50)).toBe(0);
    expect(daysToGoal(600, 0, null, 50)).toBeNull();
    expect(spendingPerDay(20, 70)).toBe(6);
    expect(spendingPerDay(null, 70)).toBeNull();
  });

  it('says whether the goal is on track for the date it was wanted by', () => {
    const p = plan({ sharePct: 50, by: '2026-12-15' });
    expect(describeGoalPace(600, 300, 20, p, today)).toBe('On track for Dec 15');
    expect(describeGoalPace(600, 0, 10, p, today)).toBe('About Mar 3 at this pace');
    expect(describeGoalPace(600, 600, 10, p, today)).toBe('Ready to claim');
    expect(describeGoalPace(600, 300, 20, plan({ sharePct: 50 }), today)).toBe('About Dec 3');
    expect(describeGoalPace(600, 300, null, p, today)).toBeNull();
  });

  it('says how far taking savings sets the goal back', () => {
    expect(describeSetback(6, 20, 70)).toBe('about a day');
    expect(describeSetback(42, 20, 70)).toBe('about 3 days');
    expect(describeSetback(6, null, 70)).toBeNull();
  });
});
