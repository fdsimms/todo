import { completedOnDay, describeAllClear } from '../utils/allClear';
import type { Task } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00' }) },
}));

const baseTask = {
  id: 't1',
  title: 'Task',
  parentId: null,
  completed: false,
  completedAt: null,
  missedAt: null,
} as unknown as Task;

const done = (id: string, completedAt: string, over: Partial<Task> = {}): Task => ({
  ...baseTask, id, completed: true, completedAt, ...over,
});

// ─── completedOnDay ───────────────────────────────────────────────────────────

describe('completedOnDay', () => {
  it('keeps a task completed within the day', () => {
    const t = done('a', new Date(2025, 5, 10, 9, 0, 0).toISOString());
    expect(completedOnDay([t], '2025-06-10', '00:00').map(x => x.id)).toEqual(['a']);
  });

  it('drops one completed on another day', () => {
    const t = done('a', new Date(2025, 5, 9, 9, 0, 0).toISOString());
    expect(completedOnDay([t], '2025-06-10', '00:00')).toEqual([]);
  });

  // The whole reason this isn't date-fns isToday: under a 4am reset the day
  // runs past midnight, and a task ticked off at 1am belongs to the day before
  // by every other reading in the app.
  it('counts a small-hours completion against the day it belongs to', () => {
    const lateNight = done('a', new Date(2025, 5, 11, 1, 0, 0).toISOString());
    expect(completedOnDay([lateNight], '2025-06-10', '04:00').map(x => x.id)).toEqual(['a']);
    // Same instant, same calendar day, but under a midnight reset it's the
    // next day's completion instead.
    expect(completedOnDay([lateNight], '2025-06-10', '00:00')).toEqual([]);
  });

  it('drops subtasks, incomplete tasks and anything marked missed', () => {
    const at = new Date(2025, 5, 10, 9, 0, 0).toISOString();
    const tasks = [
      done('sub', at, { parentId: 'parent' }),
      done('missed', at, { missedAt: at }),
      { ...baseTask, id: 'open' },
      done('real', at),
    ];
    expect(completedOnDay(tasks, '2025-06-10', '00:00').map(t => t.id)).toEqual(['real']);
  });
});

// ─── describeAllClear ─────────────────────────────────────────────────────────

describe('describeAllClear', () => {
  it('names the day’s work once something has been finished', () => {
    expect(describeAllClear({ filtered: false, doneToday: 6 })).toBe('6 tasks done today');
  });

  it('resolves the plural', () => {
    expect(describeAllClear({ filtered: false, doneToday: 1 })).toBe('1 task done today');
  });

  // An empty Today with nothing finished can still have work later in it (a
  // segment that hasn't opened, a target on pace), so this stays the sentence
  // that's true of both rather than claiming the day is empty.
  it('says nothing about the day when nothing has been finished', () => {
    expect(describeAllClear({ filtered: false, doneToday: 0 })).toBe('Nothing to do right now');
  });

  it('explains an empty list caused by the filters instead', () => {
    expect(describeAllClear({ filtered: true, doneToday: 6 })).toBe('No tasks match these filters');
  });
});
