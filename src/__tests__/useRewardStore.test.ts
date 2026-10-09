import { useRewardStore } from '../store/useRewardStore';
import {
  dbGetAllCoinEntries,
  dbUpsertCoinEntry,
  dbDeleteCoinEntry,
  dbInsertReward,
  dbDeleteReward,
} from '../db/database';
import { derivedId, spawnSeed } from '../utils/syncIds';

jest.mock('../db/database', () => ({
  dbGetAllCoinEntries: jest.fn(() => []),
  dbUpsertCoinEntry: jest.fn(),
  dbDeleteCoinEntry: jest.fn(),
  dbGetAllRewards: jest.fn(() => []),
  dbInsertReward: jest.fn(),
  dbUpdateReward: jest.fn(),
  dbDeleteReward: jest.fn(),
}));

const settings = { rewardsEnabled: true };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => settings },
}));

const AT = '2026-10-01T09:00:00.000Z';

beforeEach(() => {
  jest.clearAllMocks();
  settings.rewardsEnabled = true;
  useRewardStore.setState({ entries: [], rewards: [], initialized: false, lastChange: null });
});

const state = () => useRewardStore.getState();

describe('initialize', () => {
  it('loads the ledger', () => {
    state().initialize();
    expect(dbGetAllCoinEntries).toHaveBeenCalled();
    expect(state().initialized).toBe(true);
  });
});

describe('earning and losing', () => {
  it('keys an earning by the completed row, so a redo writes the same entry', () => {
    state().recordEarn('t1', 3, 'Run', AT);
    state().recordEarn('t1', 3, 'Run', AT);
    expect(state().entries).toHaveLength(1);
    expect(state().entries[0].id).toBe(derivedId(spawnSeed.coinEarn('t1')));
    expect(state().balance()).toBe(3);
    expect(dbUpsertCoinEntry).toHaveBeenCalledTimes(2);
  });

  it('charges a miss under its own id', () => {
    state().recordMiss('t1', 2, 'Run', AT);
    expect(state().entries[0]).toMatchObject({ kind: 'loss', amount: 2, taskId: 't1' });
    expect(state().balance()).toBe(-2);
  });

  it('writes a separate entry for every slip', () => {
    state().recordSlip('neg', 2, 'Smoke');
    state().recordSlip('neg', 2, 'Smoke');
    expect(state().entries).toHaveLength(2);
    expect(state().balance()).toBe(-4);
  });

  it('writes nothing while rewards are off', () => {
    settings.rewardsEnabled = false;
    state().recordEarn('t1', 3, 'Run', AT);
    state().recordMiss('t2', 3, 'Run', AT);
    state().recordSlip('neg', 2, 'Smoke');
    expect(state().entries).toEqual([]);
    expect(dbUpsertCoinEntry).not.toHaveBeenCalled();
  });

  it('ignores a zero amount', () => {
    state().recordEarn('t1', 0, 'Run', AT);
    expect(state().entries).toEqual([]);
  });
});

describe('announcing a change', () => {
  it('announces an earning or a loss that happens now', () => {
    state().recordEarn('t1', 3, 'Run', new Date().toISOString());
    expect(state().lastChange).toMatchObject({ kind: 'earn', amount: 3 });
    state().recordSlip('neg', 2, 'Smoke');
    expect(state().lastChange).toMatchObject({ kind: 'loss', amount: 2 });
  });

  it('stays quiet for a backdated entry', () => {
    state().recordEarn('t1', 3, 'Run', AT);
    state().recordMiss('t2', 3, 'Run', AT);
    expect(state().lastChange).toBeNull();
  });

  it('does not announce a claim', () => {
    state().recordEarn('t1', 12, 'Run', AT);
    const r = state().addReward('Episode', 10)!;
    state().claimReward(r.id);
    expect(state().lastChange).toBeNull();
  });
});

describe('taking back', () => {
  it('drops what a completion earned when it is unticked', () => {
    state().recordEarn('t1', 3, 'Run', AT);
    state().recordEarn('t2', 5, 'Read', AT);
    state().takeBackTask('t1');
    expect(state().entries.map(e => e.taskId)).toEqual(['t2']);
    expect(dbDeleteCoinEntry).toHaveBeenCalledWith(derivedId(spawnSeed.coinEarn('t1')));
  });

  it('drops a miss charge the same way', () => {
    state().recordMiss('t1', 3, 'Run', AT);
    state().takeBackTask('t1');
    expect(state().balance()).toBe(0);
  });

  it('still takes back an entry after rewards were switched off', () => {
    state().recordEarn('t1', 3, 'Run', AT);
    settings.rewardsEnabled = false;
    state().takeBackTask('t1');
    expect(state().entries).toEqual([]);
  });

  it('touches nothing for a task that recorded nothing', () => {
    state().takeBackTask('nope');
    expect(dbDeleteCoinEntry).not.toHaveBeenCalled();
  });

  it('refunds only the newest slip', () => {
    state().recordSlip('neg', 2, 'Smoke');
    state().recordSlip('neg', 2, 'Smoke');
    state().takeBackSlip('neg');
    expect(state().entries).toHaveLength(1);
    expect(state().balance()).toBe(-2);
  });
});

describe('rewards', () => {
  it('adds a reward and keeps the list cheapest first', () => {
    state().addReward('Takeout', 100);
    state().addReward('  Episode  ', 20);
    expect(state().rewards.map(r => r.title)).toEqual(['Episode', 'Takeout']);
    expect(dbInsertReward).toHaveBeenCalledTimes(2);
  });

  it('refuses a reward with no title or no cost', () => {
    expect(state().addReward('  ', 10)).toBeNull();
    expect(state().addReward('Episode', 0)).toBeNull();
    expect(state().rewards).toEqual([]);
  });

  it('edits a reward', () => {
    const r = state().addReward('Episode', 20)!;
    state().updateReward(r.id, { cost: 25 });
    expect(state().rewards[0].cost).toBe(25);
  });

  it('claims a reward the balance covers', () => {
    state().recordEarn('t1', 12, 'Run', AT);
    const r = state().addReward('Episode', 10)!;
    const entry = state().claimReward(r.id);
    expect(entry).toMatchObject({ kind: 'spend', amount: 10, rewardId: r.id, label: 'Episode' });
    expect(state().balance()).toBe(2);
  });

  it('refuses a claim the balance does not cover', () => {
    state().recordEarn('t1', 5, 'Run', AT);
    const r = state().addReward('Episode', 10)!;
    expect(state().claimReward(r.id)).toBeNull();
    expect(state().balance()).toBe(5);
  });

  it('refuses a claim while rewards are off', () => {
    state().recordEarn('t1', 50, 'Run', AT);
    const r = state().addReward('Episode', 10)!;
    settings.rewardsEnabled = false;
    expect(state().claimReward(r.id)).toBeNull();
  });

  it('undoes a claim', () => {
    state().recordEarn('t1', 12, 'Run', AT);
    const r = state().addReward('Episode', 10)!;
    const entry = state().claimReward(r.id)!;
    state().unclaim(entry.id);
    expect(state().balance()).toBe(12);
  });

  it('will not unclaim an earning', () => {
    state().recordEarn('t1', 12, 'Run', AT);
    state().unclaim(state().entries[0].id);
    expect(state().balance()).toBe(12);
  });

  it('stores a link, a note and one-time, cleaning blank text to null', () => {
    const r = state().addReward('Takeout', 70, { linkUrl: ' ubereats:// ', note: '   ', oneTime: true })!;
    expect(r).toMatchObject({ linkUrl: 'ubereats://', note: null, oneTime: true, taskId: null });
  });

  it('makes a list reward one-time whatever it is told', () => {
    const r = state().addReward('Headphones', 300, { taskId: 't1', oneTime: false })!;
    expect(r).toMatchObject({ taskId: 't1', oneTime: true });
    state().updateReward(r.id, { oneTime: false });
    expect(state().rewards[0].oneTime).toBe(true);
  });

  it('edits the details', () => {
    const r = state().addReward('Takeout', 70)!;
    state().updateReward(r.id, { note: 'Thai place', linkUrl: 'doordash://' });
    expect(state().rewards[0]).toMatchObject({ note: 'Thai place', linkUrl: 'doordash://' });
    state().updateReward(r.id, { note: '' });
    expect(state().rewards[0].note).toBeNull();
  });

  it('claims a one-time reward only once', () => {
    state().recordEarn('t1', 50, 'Run', AT);
    const r = state().addReward('Book', 10, { oneTime: true })!;
    const first = state().claimReward(r.id)!;
    expect(first).not.toBeNull();
    expect(state().claimReward(r.id)).toBeNull();
    state().unclaim(first.id);
    expect(state().claimReward(r.id)).not.toBeNull();
  });

  it('keeps coins spent on a reward that is later deleted', () => {
    state().recordEarn('t1', 12, 'Run', AT);
    const r = state().addReward('Episode', 10)!;
    state().claimReward(r.id);
    state().deleteReward(r.id);
    expect(dbDeleteReward).toHaveBeenCalledWith(r.id);
    expect(state().balance()).toBe(2);
  });
});

describe('a reward guarding a habit', () => {
  it('stores the habit it guards', () => {
    const r = state().addReward('A dessert', 110, { guardsTaskId: 'no-dessert' })!;
    expect(r.guardsTaskId).toBe('no-dessert');
    state().updateReward(r.id, { guardsTaskId: null });
    expect(state().rewards[0].guardsTaskId).toBeNull();
  });

  it('never lets a one-time or list reward guard one', () => {
    expect(state().addReward('Boots', 300, { oneTime: true, guardsTaskId: 'h' })!.guardsTaskId).toBeNull();
    expect(state().addReward('Headphones', 300, { taskId: 't1', guardsTaskId: 'h' })!.guardsTaskId).toBeNull();
  });

  it('drops the habit when an edit makes the reward one-time', () => {
    const r = state().addReward('A dessert', 110, { guardsTaskId: 'no-dessert' })!;
    state().updateReward(r.id, { oneTime: true });
    expect(state().rewards[0].guardsTaskId).toBeNull();
  });

  it('writes a guarded slip’s charge under its seed, and takes back only that', () => {
    state().recordGuardCharge('no-dessert', 6, 'No dessert', 'seed-0');
    state().recordGuardCharge('no-dessert', 0, 'No dessert', 'seed-1');
    expect(state().balance()).toBe(-6);
    state().takeBackGuardCharge('seed-1');
    expect(state().balance()).toBe(-6);
    state().takeBackGuardCharge('seed-0');
    expect(state().balance()).toBe(0);
  });

  it('reads the plan a slip on the habit would follow', () => {
    state().recordEarn('t1', 120, 'Run', AT);
    state().addReward('A dessert', 110, { guardsTaskId: 'no-dessert' });
    const habit = { id: 'no-dessert', polarity: 'negative' as const, slipCount: 0, slipDate: null, slipAllowance: null,
      streakCount: 0, streakDate: null, previousStreakCount: 0, previousStreakDate: null, priorBestStreak: 0 };
    const guard = state().slipGuardFor(habit, new Date(2026, 0, 1))!;
    expect(guard).toMatchObject({ balance: 120, claimedToday: false, plan: { kind: 'claim' } });
    expect(state().slipGuardFor({ ...habit, id: 'other' }, new Date(2026, 0, 1))).toBeNull();
  });
});

describe('dollar-priced rewards', () => {
  it('keeps the price beside the coin cost', () => {
    const r = state().addReward('Coffee', 45, { priceMinor: 450 })!;
    expect(r.priceMinor).toBe(450);
    expect(state().addReward('Episode', 10)!.priceMinor).toBeNull();
  });

  it('rewrites only dollar-priced costs when the rate moves', () => {
    const coffee = state().addReward('Coffee', 45, { priceMinor: 450 })!;
    const episode = state().addReward('Episode', 10)!;
    expect(state().repriceDollarRewards(20)).toBe(1);
    expect(state().rewards.find(r => r.id === coffee.id)!.cost).toBe(90);
    expect(state().rewards.find(r => r.id === episode.id)!.cost).toBe(10);
  });

  it('writes nothing when the clean cost is unchanged or there is no rate', () => {
    state().addReward('Coffee', 45, { priceMinor: 450 });
    expect(state().repriceDollarRewards(10)).toBe(0);
    expect(state().repriceDollarRewards(0)).toBe(0);
  });

  it('claims at the repriced cost', () => {
    state().recordEarn('t1', 100, 'Run', AT);
    const r = state().addReward('Coffee', 45, { priceMinor: 450 })!;
    state().repriceDollarRewards(20);
    expect(state().claimReward(r.id)).toMatchObject({ amount: 90 });
  });

  it('clears the price when an edit passes null', () => {
    const r = state().addReward('Coffee', 45, { priceMinor: 450 })!;
    state().updateReward(r.id, { priceMinor: null });
    expect(state().rewards[0].priceMinor).toBeNull();
  });
});
