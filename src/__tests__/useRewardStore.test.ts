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

  it('keeps coins spent on a reward that is later deleted', () => {
    state().recordEarn('t1', 12, 'Run', AT);
    const r = state().addReward('Episode', 10)!;
    state().claimReward(r.id);
    state().deleteReward(r.id);
    expect(dbDeleteReward).toHaveBeenCalledWith(r.id);
    expect(state().balance()).toBe(2);
  });
});
