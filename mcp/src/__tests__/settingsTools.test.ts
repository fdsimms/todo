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
  it('reads every allowed setting with what it means', () => {
    const read = getSettings(replica);
    expect(read.settings.day.dayResetTime).toMatchObject({ value: expect.any(String), means: expect.stringMatching(/day turns over/) });
    expect(read.settings.rewards.rewardsEnabled.value).toBe(false);
  });

  it('changes several at once and stores them in the settings table', () => {
    const result = updateSettings(replica, { dayResetTime: '04:00', weekStartsOn: 1, rewardsEnabled: true, quietHours: { start: '22:00', end: '07:00' } });
    expect(result.changed.map(c => c.setting)).toEqual(['dayResetTime', 'weekStartsOn', 'rewardsEnabled', 'quietHours']);
    expect(replica.settings().dayResetTime).toBe('04:00');
    expect(getSettings(replica).settings.day.quietHours.value).toEqual({ start: '22:00', end: '07:00' });
    expect(mockRaw.getFirstSync<{ value: string }>("SELECT value FROM settings WHERE key = 'dayResetTime'")?.value).toBe('04:00');
  });

  it('refuses the whole call when one value is wrong, and an unknown setting', () => {
    expect(() => updateSettings(replica, { weekStartsOn: 0, dayResetTime: '25:00' })).toThrow(/HH:MM/);
    expect(replica.settings().weekStartsOn).toBe(1);
    expect(() => updateSettings(replica, { anthropicApiKey: 'x' })).toThrow(/Not a setting this can change/);
  });

  it('says when the app kept a value within its own range', () => {
    const result = updateSettings(replica, { weekendNudgeLeadDays: 14 });
    expect(result.changed[0].to).toBeLessThanOrEqual(14);
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
