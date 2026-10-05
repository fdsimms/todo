/**
 * The rewards tools against a real replica: the report Claude reads and the
 * results the writes hand back. The rules themselves (what earns, what a claim
 * needs) are the app's and are tested in rewards.test.ts and replica.test.ts;
 * this holds the shape of what the tools say.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { claimReward, createReward, getRewards, markMissed, setBounty, setRewardGoal, unclaimReward, updateReward } from '../rewardTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

describe('the rewards tools', () => {
  let replica: ReturnType<typeof openReplica>;

  beforeAll(() => {
    replica = openReplica(':memory:');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../../src/store/useCategoryStore').useCategoryStore.getState().addCategory('Home');
    replica.refresh();
  });

  it('reports rewards as off, with nothing kept, until the person turns them on', () => {
    const report = getRewards(replica);
    expect(report.enabled).toBe(false);
    expect(report.balance).toBe(0);
    expect(() => createReward(replica, { title: 'Treat', cost: 10 })).toThrow(/switched off/);
  });

  describe('with rewards on', () => {
    beforeAll(() => {
      mockRaw.runSync("INSERT OR REPLACE INTO settings (key, value) VALUES ('rewardsEnabled', 'true')");
      replica.refresh();
      const t = replica.createTask({ title: 'Write the report', estimatedMinutes: 90 });
      replica.completeTask(t.id, {});
    });

    it('reports the balance, the goal and what each reward still needs', () => {
      const cheap = createReward(replica, { title: 'Coffee', cost: 2, note: 'the good place', oneTime: true });
      const dear = createReward(replica, { title: 'Weekend away', cost: 50 });
      expect(setRewardGoal(replica, dear.id).goal!.title).toBe('Weekend away');

      const report = getRewards(replica);
      expect(report.enabled).toBe(true);
      expect(report.balance).toBe(5);
      expect(report.rewards.map(r => r.title)).toEqual(['Coffee', 'Weekend away']);
      expect(report.rewards[0]).toMatchObject({ affordable: true, shortBy: 0, note: 'the good place', oneTime: true });
      expect(report.rewards[1]).toMatchObject({ affordable: false, shortBy: 45, goal: true });
      expect(report.goal).toMatchObject({ title: 'Weekend away', cost: 50, shortBy: 45 });
      expect(report.goal!.progress).toBeCloseTo(0.1);
      expect(report.history[0]).toMatchObject({ kind: 'earn', amount: 5, label: 'Write the report' });
      expect(getRewards(replica, { historyLimit: 0 }).history).toEqual([]);

      const claim = claimReward(replica, cheap.id);
      expect(claim).toMatchObject({ spent: 2, balance: 3 });
      // A claimed one-time reward leaves the list, and unclaiming brings it back.
      expect(getRewards(replica).rewards.map(r => r.title)).toEqual(['Weekend away']);
      expect(unclaimReward(replica, claim.claimId)).toMatchObject({ returned: 2, balance: 5 });
      expect(getRewards(replica).rewards.map(r => r.title)).toEqual(['Coffee', 'Weekend away']);

      expect(updateReward(replica, dear.id, { cost: 8 }).cost).toBe(8);
      expect(getRewards(replica).goal!.shortBy).toBe(3);
    });

    it('lists a live bounty and says what the miss costs', () => {
      const task = replica.createTask({ title: 'Ring the dentist' });
      expect(setBounty(replica, task.id, true).bounty).toMatch(/\d/);
      expect(getRewards(replica).bounties).toMatchObject({ limit: 1, tasks: [{ id: task.id, title: 'Ring the dentist' }] });
      setBounty(replica, task.id, false);
      expect(getRewards(replica).bounties.tasks).toEqual([]);

      const daily = replica.createTask({
        title: 'Stretch', recurrenceType: 'daily', estimatedMinutes: 30,
        dueDate: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      });
      const missed = markMissed(replica, daily.id);
      expect(missed.effects.join(' ')).toMatch(/missed.*not a completion/);
      expect(missed.effects.join(' ')).toMatch(/costs \d+ coins?/);
      expect(missed.nextTask).not.toBeNull();
    });
  });
});
