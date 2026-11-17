/**
 * The vacation switch against a real replica: the hide is the app's own
 * `isHiddenForVacation`, the forgiveness is `vacationStreaks.ts`, and the
 * setter is the settings store's. What is checked here is that flipping the
 * switch from the server does what the Settings toggle does, and says so.
 *
 * Every test builds its own state (mode off, three tasks, one hidden category),
 * so none of them depends on the one before it.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { setVacationMode, vacationState } from '../vacationTools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

describe('the vacation switch', () => {
  let replica: ReturnType<typeof openReplica>;
  let pausedId: string;
  let choreId: string;

  beforeAll(() => {
    replica = openReplica(':memory:');
  });

  beforeEach(() => {
    mockRaw.runSync('DELETE FROM tasks');
    mockRaw.runSync('DELETE FROM categories');
    mockRaw.runSync("DELETE FROM settings WHERE key IN ('vacationMode', 'vacationStart', 'vacationEnd', 'vacationScheduledStart', 'vacationDrivenBy')");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSettingsStore } = require('../../../src/store/useSettingsStore');
    useSettingsStore.setState({ vacationMode: false, vacationStart: null, vacationEnd: null, vacationScheduledStart: null, vacationDrivenBy: null });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useCategoryStore } = require('../../../src/store/useCategoryStore');
    useCategoryStore.setState({ categories: [] });
    useCategoryStore.getState().addCategory('Home');
    useCategoryStore.getState().addCategory('Chores');
    useCategoryStore.getState().setCategoryHideOnVacation('Chores', true);

    // A daily habit marked for vacation pause, mid-streak; a chore in the
    // hidden category; and one plain task the mode leaves alone.
    pausedId = replica.createTask({ title: 'Meditate', category: 'Home' }).id;
    mockRaw.runSync(
      "UPDATE tasks SET vacation_pause = 1, recurrence_type = 'daily', streak_count = 4, streak_date = ? WHERE id = ?",
      ['2026-09-20T04:00:00.000Z', pausedId]
    );
    choreId = replica.createTask({ title: 'Vacuum', category: 'Chores' }).id;
    replica.createTask({ title: 'Call the bank', category: 'Home' });
    replica.refresh();
  });

  it('reads as off, naming the categories it would hide', () => {
    expect(vacationState(replica)).toEqual({ on: false, hiding: { tasks: 0, categories: ['Chores'] } });
  });

  it('turns on, hiding the paused task and the hidden category, and reports what it hides', () => {
    const result = setVacationMode(replica, { on: true });
    expect(result.on).toBe(true);
    expect(result.since).toBeTruthy();
    expect(result.until).toBeUndefined();
    expect(result.hiding).toEqual({ tasks: 2, categories: ['Chores'] });
    expect(result.forgivenStreaks).toBeUndefined();
    expect(result.note).toMatch(/Vacation mode is on until it is turned off\. It hides 2 tasks marked for vacation pause and the category Chores/);
    expect(replica.isHiddenForVacation(replica.taskById(pausedId)!)).toBe(true);
    expect(replica.isHiddenForVacation(replica.taskById(choreId)!)).toBe(true);
  });

  it('refuses to turn on again without an end date, and an end that is not after today', () => {
    setVacationMode(replica, { on: true });
    expect(() => setVacationMode(replica, { on: true })).toThrow(/already on/);
    expect(() => setVacationMode(replica, { on: true, until: replica.todayKey() })).toThrow(/not after today/);
    expect(() => setVacationMode(replica, { on: true, until: 'someday' })).toThrow(/not a date I can read/);
  });

  it('moves only the end date while already on, and clears it with null', () => {
    setVacationMode(replica, { on: true });
    const until = replica.shiftDayKey(replica.todayKey(), 5);
    const moved = setVacationMode(replica, { on: true, until });
    expect(moved.until).toBe(until);
    expect(moved.note).toMatch(new RegExp(`already on; it now turns itself off on ${until}`));
    expect(vacationState(replica).until).toBe(until);

    const cleared = setVacationMode(replica, { on: true, until: null });
    expect(cleared.until).toBeUndefined();
    expect(cleared.note).toMatch(/end date is cleared/);
  });

  it('turns off, bringing the tasks back and forgiving the protected streak, and refuses a second off', () => {
    setVacationMode(replica, { on: true });
    const result = setVacationMode(replica, { on: false });
    expect(result.on).toBe(false);
    expect(result.forgivenStreaks).toBe(1);
    expect(result.note).toMatch(/Vacation mode is off\. 2 tasks marked for vacation pause and the category Chores are back on their lists, and 1 protected streak was forgiven/);

    const paused = replica.taskById(pausedId)!;
    expect(paused.streakCount).toBe(4);
    expect(new Date(paused.streakDate!).getTime()).toBeGreaterThan(new Date('2026-09-20T04:00:00.000Z').getTime());
    expect(replica.isHiddenForVacation(paused)).toBe(false);

    expect(() => setVacationMode(replica, { on: false })).toThrow(/already off/);
    expect(() => setVacationMode(replica, { on: false, until: null })).toThrow(/until goes with on: true/);
  });

  it('scales a weekly target to the days of the week that were not vacation, as the app does on the way off', () => {
    // Thursday Nov 19 2026 with Monday-start weeks: three days of this week were vacation.
    jest.useFakeTimers({ now: new Date(2026, 10, 19, 10, 0, 0) });
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useSettingsStore } = require('../../../src/store/useSettingsStore');
      const weeklyId = replica.createTask({ title: 'Run', category: 'Home' }).id;
      mockRaw.runSync(
        "UPDATE tasks SET vacation_pause = 1, recurrence_type = 'weekly', quota_period = 'week', target_count = 3, progress_count = 1, due_date = ? WHERE id = ?",
        [new Date(2026, 10, 10, 12).toISOString(), weeklyId],
      );
      replica.refresh();
      setVacationMode(replica, { on: true });
      useSettingsStore.setState({ vacationStart: new Date(2026, 10, 12, 9).toISOString(), weekStartsOn: 1 });
      const result = setVacationMode(replica, { on: false });
      expect(result.scaledTargets).toBe(1);
      expect(result.note).toMatch(/1 weekly target was scaled/);
      const rows = mockRaw.getAllSync('SELECT id, completed, target_count FROM tasks WHERE title = ?', ['Run']) as
        { id: string; completed: number; target_count: number }[];
      expect(rows.find(r => r.id === weeklyId)!.completed).toBe(1);
      expect(rows.filter(r => r.completed === 0).map(r => r.target_count)).toEqual([2]);
    } finally {
      jest.useRealTimers();
    }
  });

  describe('a planned vacation', () => {
    /** The day key `n` days after `key`, on the local calendar. */
    const dayAfter = (key: string, n: number) => {
      const d = new Date(`${key}T12:00`);
      d.setDate(d.getDate() + n);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };

    it('plans it for a later day, stored as Settings stores it, and hides nothing yet', () => {
      const from = dayAfter(replica.todayKey(), 3);
      const until = dayAfter(replica.todayKey(), 10);
      const result = setVacationMode(replica, { on: true, from, until });
      expect(result).toMatchObject({ on: false, planned: { from, until }, hiding: { tasks: 0 } });
      expect(result.note).toMatch(new RegExp(`turns itself on on ${from} and off on ${until}`));
      const settings = replica.settings();
      expect(settings.vacationMode).toBe(false);
      // The day's start, which the phone's checkScheduledVacation compares against.
      expect(new Date(settings.vacationScheduledStart!).getHours()).toBe(0);
      expect(replica.logicalDayKeyOf(settings.vacationScheduledStart!)).toBe(from);
      expect(replica.isHiddenForVacation(replica.taskById(pausedId)!)).toBe(false);
      expect(vacationState(replica).planned).toEqual({ from, until });
    });

    it('refuses a start that is not after today, an end not after the start, and a plan while the mode is on', () => {
      const today = replica.todayKey();
      expect(() => setVacationMode(replica, { on: true, from: today })).toThrow(/from: .* is not after today/);
      expect(() => setVacationMode(replica, { on: true, from: dayAfter(today, 3), until: dayAfter(today, 3) })).toThrow(/until: .* is not after/);
      expect(() => setVacationMode(replica, { on: false, from: dayAfter(today, 3) })).toThrow(/from goes with on: true/);
      setVacationMode(replica, { on: true });
      expect(() => setVacationMode(replica, { on: true, from: dayAfter(today, 3) })).toThrow(/already on/);
      expect(replica.settings().vacationScheduledStart).toBeNull();
    });

    it('cancels the plan and its end with on: false, leaving the mode off', () => {
      const from = dayAfter(replica.todayKey(), 2);
      setVacationMode(replica, { on: true, from, until: dayAfter(from, 5) });
      const result = setVacationMode(replica, { on: false });
      expect(result.note).toBe(`The vacation planned for ${from} is cancelled, and vacation mode stays off.`);
      expect(result.planned).toBeUndefined();
      expect(replica.settings()).toMatchObject({ vacationMode: false, vacationScheduledStart: null, vacationEnd: null });
    });
  });
});
