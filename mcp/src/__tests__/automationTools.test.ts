/**
 * Automations against a real database and the real settings store: a rule is
 * checked by the app's own parser, refused when the parser would drop it, and
 * reported as stored when the parser changed it; an edit that changes what a
 * weather rule asks clears its day mark; and a switch lands as the stored
 * value the app reads back.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { deleteRule, listAutomations, saveRule, setAutomation } from '../automationTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

let replica: ReturnType<typeof openReplica>;

beforeAll(() => {
  replica = openReplica(':memory:');
});

beforeEach(() => {
  // One replica for the file, so each test starts from an empty settings
  // table: the switch one test turns on, and the rule lists another saves, are
  // otherwise what the next test reads back. The refresh re-reads the store
  // from the table, defaults and all.
  mockRaw.runSync('DELETE FROM settings');
  replica.refresh();
});

describe('automations', () => {
  it('lists every automation with its switch, and says what each needs on the phone', () => {
    const { automations } = listAutomations(replica);
    const weather = automations.find(a => a.kind === 'weather')!;
    expect(weather).toMatchObject({ on: false, rules: { type: 'weather' }, needsOnPhone: expect.stringMatching(/location/) });
    expect(automations.length).toBeGreaterThan(20);
  });

  it('turns one on as the stored value the app reads back', () => {
    expect(setAutomation(replica, 'weather', true).on).toBe(true);
    replica.refresh();
    expect(listAutomations(replica).automations.find(a => a.kind === 'weather')!.on).toBe(true);
    expect(() => setAutomation(replica, 'telepathy', true)).toThrow(/No automation/);
  });

  it('adds a weather rule, and clears its day mark when an edit changes what it asks', () => {
    const { saved, created } = saveRule(replica, 'weather', { condition: 'rainy', title: 'Take an umbrella' });
    expect(created).toBe(true);
    const id = saved.id as string;
    // As if the phone had already judged it today.
    const spent = replica.ruleLists().weather.map(r => (r.id === id ? { ...r, lastFiredDayKey: '2026-10-04' } : r));
    replica.setRuleList('weather', spent);

    saveRule(replica, 'weather', { id, title: 'Take the big umbrella' });
    expect(replica.ruleLists().weather.find(r => r.id === id)!.lastFiredDayKey).toBe('2026-10-04');
    saveRule(replica, 'weather', { id, condition: 'snowy' });
    expect(replica.ruleLists().weather.find(r => r.id === id)!.lastFiredDayKey).toBeNull();
  });

  it('refuses a title rule the app would drop, and reports one it adjusted', () => {
    expect(() => saveRule(replica, 'title', { keywords: ['ab'], priority: 3 })).toThrow(/3 or more letters/);
    const result = saveRule(replica, 'title', { keywords: ['Pay', 'xy'], priority: 3 });
    expect(result.saved).toMatchObject({ keywords: ['pay'], priority: 3 });
    expect(result.adjusted?.[0]).toMatch(/keywords/);
  });

  it('clamps a Screen Time threshold the way the sheet does, and says so', () => {
    const result = saveRule(replica, 'screenTime', { thresholdMinutes: 2, title: 'Go outside' });
    expect((result.saved.thresholdMinutes as number)).toBeGreaterThanOrEqual(5);
    expect(result.adjusted?.join(' ')).toMatch(/thresholdMinutes/);
  });

  it('deletes by id, and refuses an id it does not have', () => {
    const { saved } = saveRule(replica, 'event', { matches: ['dentist'], title: 'Floss the night before', leadDays: 1 });
    expect(deleteRule(replica, 'event', saved.id as string).removed).toMatchObject({ title: 'Floss the night before' });
    expect(() => deleteRule(replica, 'event', 'nope')).toThrow(/No event rule/);
    expect(() => saveRule(replica, 'event', { id: 'nope', title: 'x' })).toThrow(/No event rule/);
  });
});
