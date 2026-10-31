/**
 * The rewards tools against a real replica: the report Claude reads and the
 * results the writes hand back. The rules themselves (what earns, what a claim
 * needs) are the app's and are tested in rewards.test.ts and replica.test.ts;
 * this holds the shape of what the tools say.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { claimReward, createReward, createUnlock, deleteUnlock, getRewards, markMissed, setBounty, setRewardGoal, setUnlockPlay, unclaimReward, updateReward, updateUnlock } from '../rewardTools';

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
    // Off by its own hand: in random order the block below may already have
    // turned the switch on.
    mockRaw.runSync("DELETE FROM settings WHERE key = 'rewardsEnabled'");
    mockRaw.runSync('DELETE FROM coin_entries');
    mockRaw.runSync('DELETE FROM rewards');
    replica.refresh();
    const report = getRewards(replica);
    expect(report.enabled).toBe(false);
    expect(report.balance).toBe(0);
    expect(() => createReward(replica, { title: 'Treat', cost: 10 })).toThrow(/switched off/);
  });

  describe('with rewards on', () => {
    beforeEach(() => {
      // A fresh ledger, reward list and task table for each test: the balance
      // one test reads is what another's claim or miss moved, so sharing them
      // across the block passed in declaration order and in no other.
      mockRaw.runSync('DELETE FROM coin_entries');
      mockRaw.runSync('DELETE FROM rewards');
      mockRaw.runSync('DELETE FROM tasks');
      mockRaw.runSync("INSERT OR REPLACE INTO settings (key, value) VALUES ('rewardsEnabled', 'true')");
      replica.refresh();
      const t = replica.createTask({ title: 'Write the report', estimatedMinutes: 90 });
      replica.completeTask(t.id, {});
    });

    it('sets money aside for the goal, pays other rewards from the rest, and lists unlocks without their code', () => {
      mockRaw.runSync('DELETE FROM reward_unlocks');
      const coffee = createReward(replica, { title: 'Coffee', cost: 4 });
      const game = createReward(replica, { title: 'Game', cost: 60 });
      // The 5 coins already earned go in, and 60% of what comes next.
      const set = setRewardGoal(replica, game.id, { sharePct: 60 });
      expect(set.savings).toMatchObject({ sharePct: 60, saved: 5, spending: 0 });
      const t = replica.createTask({ title: 'Clean the garage', estimatedMinutes: 90 });
      replica.completeTask(t.id, {});
      const report = getRewards(replica);
      expect(report.savings).toMatchObject({ saved: 8, spending: 2 });
      expect(report.goal).toMatchObject({ shortBy: 52 });
      expect(report.rewards.find(r => r.id === coffee.id)).toMatchObject({ affordable: false, shortBy: 2 });
      expect(report.history[0]).toMatchObject({ label: 'Clean the garage', saved: 3 });

      // Coffee needs 2 of the goal's savings, which takes a yes.
      expect(() => claimReward(replica, coffee.id)).toThrow(/useSavings/);
      expect(claimReward(replica, coffee.id, true)).toMatchObject({ spent: 4, fromSavings: 2 });
      expect(getRewards(replica).savings).toMatchObject({ saved: 6, spending: 0 });

      // Stopping returns the savings to spending money.
      setRewardGoal(replica, null);
      expect(getRewards(replica).savings).toBeNull();

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { dbUpsertRewardUnlock } = require('../../../src/db/database');
      dbUpsertRewardUnlock({
        id: 'u1', title: 'Switch', glyph: null, createdAt: new Date().toISOString(), sharePct: 60, requiredTaskIds: [], playMinutes: 120,
        freeOnWeekends: false, freeOnVacation: false, guardsTaskId: null, pin: '4817',
        playDay: null, playUsedMs: 0, playExtraMs: 0, playStartedAt: null,
      });
      const [unlock] = getRewards(replica).unlocks;
      expect(unlock).toMatchObject({ title: 'Switch', unlocksAtPct: 60, playMinutes: 120, playing: false, hasCode: true });
      expect(JSON.stringify(getRewards(replica))).not.toContain('4817');
    });

    it('makes, changes, times and deletes an unlock, with the app\'s checks and never a code', () => {
      mockRaw.runSync('DELETE FROM reward_unlocks');
      // Today's work is the one finished task, so it is open.
      const made = createUnlock(replica, { title: 'Switch', glyph: '🎮', playMinutes: 60 });
      expect(made).toMatchObject({ title: 'Switch', unlocksAtPct: 60, playMinutes: 60, playLeftMinutes: 60, status: 'open', playing: false });

      const habit = replica.createTask({ title: 'No games while locked', polarity: 'negative' } as never);
      const walk = replica.createTask({ title: 'Walk' });
      expect(updateUnlock(replica, made.id, { linkedHabitId: habit.id, alsoNeedsTaskIds: [walk.id] }))
        .toMatchObject({ linkedHabitId: habit.id, alsoNeedsTaskIds: [walk.id] });
      // An avoid habit is never a task to require, and a plain task never a linked habit.
      expect(() => updateUnlock(replica, made.id, { alsoNeedsTaskIds: [habit.id] })).toThrow(/habit to avoid/);
      expect(() => updateUnlock(replica, made.id, { linkedHabitId: walk.id })).toThrow(/Avoid this/);
      // A habit has one link.
      expect(() => createUnlock(replica, { title: 'TV', linkedHabitId: habit.id })).toThrow(/already linked/);
      // A code can't be written here, even passed through.
      updateUnlock(replica, made.id, { pin: '1234' } as never);
      expect(replica.rewardState().unlocks[0].pin).toBeNull();

      updateUnlock(replica, made.id, { alsoNeedsTaskIds: [] });
      expect(setUnlockPlay(replica, made.id, 'start')).toMatchObject({ playing: true });
      expect(setUnlockPlay(replica, made.id, 'stop')).toMatchObject({ playing: false });
      expect(setUnlockPlay(replica, made.id, 'add', 15).playLeftMinutes).toBeGreaterThanOrEqual(74);

      // Once play has started it stays open for the day, whatever is added.
      // Due today, so it is part of today's work.
      replica.createTask({ title: 'Big job', estimatedMinutes: 240, dueDate: replica.currentDayStart().toISOString() });
      expect(updateUnlock(replica, made.id, { unlocksAtPct: 100 }).status).toBe('open');
      // A fresh one, locked by work still open: start is refused and says how far along it is.
      const tv = createUnlock(replica, { title: 'TV', unlocksAtPct: 100 });
      expect(tv.status).toBe('locked');
      expect(() => setUnlockPlay(replica, tv.id, 'start')).toThrow(/is locked/);
      deleteUnlock(replica, tv.id);

      expect(deleteUnlock(replica, made.id)).toEqual({ deleted: { id: made.id, title: 'Switch' } });
      expect(getRewards(replica).unlocks).toEqual([]);
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

    it('refuses a dollar price with no rate, and a cost and price together', () => {
      expect(() => createReward(replica, { title: 'Coffee', price: 4.5 })).toThrow(/weekly reward budget/);
      expect(() => createReward(replica, { title: 'Coffee', cost: 5, price: 4.5 })).toThrow(/either cost/);
      expect(() => createReward(replica, { title: 'Coffee' })).toThrow(/either cost/);
      expect(() => createReward(replica, { title: 'Coffee', price: 4.567 })).toThrow(/two decimals/);
      expect(() => createReward(replica, { title: 'Coffee', cost: 5, taxable: true })).toThrow(/dollar price/);
    });

    it('reprices a reward still marked taxable once the tax rate is cleared, as typed', () => {
      // A week of history and a budget, so a dollar price has a rate.
      mockRaw.runSync("UPDATE tasks SET completed_at = ? WHERE completed = 1", [new Date(Date.now() - 10 * 86_400_000).toISOString()]);
      mockRaw.runSync("INSERT OR REPLACE INTO settings (key, value) VALUES ('rewardWeeklyBudgetMinor', '1000')");
      mockRaw.runSync("INSERT OR REPLACE INTO settings (key, value) VALUES ('rewardSalesTaxPercent', '10')");
      replica.refresh();
      const taxed = createReward(replica, { title: 'Book', price: 20, taxable: true });
      mockRaw.runSync("DELETE FROM settings WHERE key = 'rewardSalesTaxPercent'");
      replica.refresh();
      // No rate means no tax, not an error: a new price alone goes through.
      const repriced = updateReward(replica, taxed.id, { price: 10 });
      expect(repriced.cost).toBeLessThan(taxed.cost);
      // Asking for tax with no rate is still refused, rather than quietly skipped.
      expect(() => updateReward(replica, taxed.id, { price: 12, taxable: true })).toThrow(/sales tax rate/);
      mockRaw.runSync("DELETE FROM settings WHERE key = 'rewardWeeklyBudgetMinor'");
      replica.refresh();
    });

    it('will not take back a balance reset as though it were a claim', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useRewardStore } = require('../../../src/store/useRewardStore');
      const reset = useRewardStore.getState().resetBalance();
      expect(reset).not.toBeNull();
      replica.refresh();
      expect(() => unclaimReward(replica, reset.id)).toThrow(/Only a reward claim/);
      expect(getRewards(replica).balance).toBe(0);
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
