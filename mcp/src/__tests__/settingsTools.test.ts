/**
 * The settings tools against a real database: what a change stores, what it
 * refuses before storing anything, and that the store's own clamp is said.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { getSettings, updateSettings } from '../settingsTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

let replica: ReturnType<typeof openReplica>;
beforeAll(() => { replica = openReplica(':memory:'); });

describe('settings', () => {
  it('lists the links saved in the Link picker, read-only', () => {
    expect(getSettings(replica).savedLinks).toEqual([]);
  });


  it('reads every allowed setting with what it means', () => {
    const read = getSettings(replica);
    expect(read.settings.day.dayResetTime).toMatchObject({ value: expect.any(String), means: expect.stringMatching(/day turns over/) });
    // A boolean, not `false`: the settings live in a store the other tests write
    // to, and the suite runs under --randomize.
    expect(typeof read.settings.rewards.rewardsEnabled.value).toBe('boolean');
  });

  it('changes several at once and stores them in the settings table', () => {
    const result = updateSettings(replica, { dayResetTime: '04:00', weekStartsOn: 1, rewardsEnabled: true, quietHours: { start: '22:00', end: '07:00' } });
    expect(result.changed.map(c => c.setting)).toEqual(['dayResetTime', 'weekStartsOn', 'rewardsEnabled', 'quietHours']);
    expect(replica.settings().dayResetTime).toBe('04:00');
    expect(getSettings(replica).settings.day.quietHours.value).toEqual({ start: '22:00', end: '07:00' });
    expect(mockRaw.getFirstSync<{ value: string }>("SELECT value FROM settings WHERE key = 'dayResetTime'")?.value).toBe('04:00');
  });

  it('refuses the whole call when one value is wrong, and an unknown setting', () => {
    updateSettings(replica, { weekStartsOn: 1 });
    expect(() => updateSettings(replica, { weekStartsOn: 0, dayResetTime: '25:00' })).toThrow(/HH:MM/);
    expect(replica.settings().weekStartsOn).toBe(1);
    expect(() => updateSettings(replica, { anthropicApiKey: 'x' })).toThrow(/Not a setting this can change/);
  });

  // A name a setting files things under has to be real: stored as given, a
  // typo made every new task on the phone land in a section nobody made.
  describe('settings that name a category or a project', () => {
    beforeAll(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../../src/store/useCategoryStore').useCategoryStore.getState().addCategory('Home');
      replica.refresh();
    });

    it('stores the category in the spelling it was made in, and refuses one that does not exist', () => {
      const result = updateSettings(replica, { newTaskDefaults: { category: 'home' }, limitsTodayCategory: 'HOME' });
      expect(replica.settingValues().limitsTodayCategory).toBe('Home');
      expect(getSettings(replica).settings.tasks.newTaskDefaults.value).toMatchObject({ category: 'Home' });
      expect(result.note).toMatch(/limitsTodayCategory is Home/);

      expect(() => updateSettings(replica, { newTaskDefaults: { category: 'Bogus' } })).toThrow(/newTaskDefaults\.category: "Bogus" isn't one of your categories/);
      expect(() => updateSettings(replica, { limitsTodayCategory: 'Bogus' })).toThrow(/limitsTodayCategory/);
      // Nothing was stored by the refused calls.
      expect(replica.settingValues().limitsTodayCategory).toBe('Home');
    });

    it('files use-up tasks under a real category, in the spelling it was made in', () => {
      updateSettings(replica, { groceryUseUpTaskCategory: 'HOME', leftoverUseUpTaskCategory: 'home', groceryUseUpTasks: true });
      expect(replica.settingValues()).toMatchObject({ groceryUseUpTaskCategory: 'Home', leftoverUseUpTaskCategory: 'Home', groceryUseUpTasks: true });
      expect(() => updateSettings(replica, { groceryUseUpTaskCategory: 'Bogus' })).toThrow(/groceryUseUpTaskCategory/);
      updateSettings(replica, { groceryUseUpTaskCategory: null });
      expect(replica.settingValues().groceryUseUpTaskCategory).toBeNull();
    });

    it('refuses a wish-list project that does not exist, whole call included', () => {
      updateSettings(replica, { weekStartsOn: 1 });
      expect(() => updateSettings(replica, { weekStartsOn: 0, rewardListProjectId: 'nope' })).toThrow(/no project with id "nope"/);
      expect(replica.settings().weekStartsOn).toBe(1);
    });

    it('still lets healthCategory name a category that does not exist yet', () => {
      updateSettings(replica, { healthCategory: 'Body' });
      expect(replica.settingValues().healthCategory).toBe('Body');
    });
  });

  it('says when the app kept a value within its own range', () => {
    const result = updateSettings(replica, { weekendNudgeLeadDays: 14 });
    expect(result.changed[0].to).toBeLessThanOrEqual(14);
  });

  it('changes the focus session plan, with null turning a break trigger off', () => {
    updateSettings(replica, { focusRestMinutes: 10, focusRestAfterTasks: null, focusBreaksEnabled: true });
    expect(getSettings(replica).settings.focus.focusRestMinutes.value).toBe(10);
    expect(getSettings(replica).settings.focus.focusRestAfterTasks.value).toBeNull();
    expect(mockRaw.getFirstSync<{ value: string }>("SELECT value FROM settings WHERE key = 'focusRestAfterTasks'")?.value).toBe('');
    expect(() => updateSettings(replica, { focusRestMinutes: 0 })).toThrow(/whole number from 1/);
  });

  it('takes known subway lines and refuses an unknown one', () => {
    updateSettings(replica, { transitLines: ['L', 'G'] });
    // The picker's own order, not the order given.
    expect(getSettings(replica).settings.automations.transitLines.value).toEqual(['G', 'L']);
    expect(() => updateSettings(replica, { transitLines: ['L', 'X'] })).toThrow(/list of 1, 2/);
  });

  it('files Health readings under a category, creating it, or hides them', () => {
    const result = updateSettings(replica, { healthCategory: 'Activity' });
    expect(result.changed[0]).toMatchObject({ setting: 'healthCategory', to: 'Activity' });
    expect(replica.categories().map(c => c.name)).toContain('Activity');
    expect(mockRaw.getFirstSync<{ value: string }>("SELECT value FROM settings WHERE key = 'healthCategory'")?.value).toBe('Activity');
    expect(() => updateSettings(replica, { healthCategory: '  ' })).toThrow(/category name/);
    updateSettings(replica, { healthCategory: null });
    expect(getSettings(replica).settings.features.healthCategory.value).toBeNull();
  });
});
