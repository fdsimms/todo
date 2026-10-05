/**
 * The vacation switch against a real replica: the hide is the app's own
 * `isHiddenForVacation`, the forgiveness is `vacationStreaks.ts`, and the
 * setter is the settings store's. What is checked here is that flipping the
 * switch from the server does what the Settings toggle does, and says so.
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useCategoryStore } = require('../../../src/store/useCategoryStore');
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
    expect(() => setVacationMode(replica, { on: true })).toThrow(/already on/);
    expect(() => setVacationMode(replica, { on: true, until: replica.todayKey() })).toThrow(/not after today/);
    expect(() => setVacationMode(replica, { on: true, until: 'someday' })).toThrow(/not a date I can read/);
  });

  it('moves only the end date while already on, and clears it with null', () => {
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
});
