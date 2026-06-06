import { isTaskVisible, isTaskDeferred, getVisibleAt } from '../utils/visibilityUtils';
import type { Task } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ dayResetTime: '00:00' }),
  },
}));

const baseTask: Task = {
  id: 'test-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  createdAt: new Date(2025, 0, 1).toISOString(),
  dueDate: null,
  deferUntil: null,
  showAfterTime: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceEndDate: null,
  tags: [],
  sortOrder: 0,
  focused: false,
  priority: 0,
  effort: 0,
  streakCount: 0,
  streakDate: null,
  recurrenceFromCompletion: false,
  reminderTime: null,
  parentId: null,
};

// June 10, 2025 at 10:00 AM
const NOW = new Date(2025, 5, 10, 10, 0, 0);

// ─── isTaskVisible ────────────────────────────────────────────────────────────

describe('isTaskVisible', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('hides completed tasks', () => {
    expect(isTaskVisible({ ...baseTask, completed: true })).toBe(false);
  });

  it('shows uncompleted tasks with no constraints', () => {
    expect(isTaskVisible(baseTask)).toBe(true);
  });

  it('hides tasks deferred to a future time', () => {
    const deferUntil = new Date(2025, 5, 10, 15, 0, 0).toISOString(); // 3 PM today
    expect(isTaskVisible({ ...baseTask, deferUntil })).toBe(false);
  });

  it('shows tasks whose deferUntil has already passed', () => {
    const deferUntil = new Date(2025, 5, 10, 8, 0, 0).toISOString(); // 8 AM today
    expect(isTaskVisible({ ...baseTask, deferUntil })).toBe(true);
  });

  it('hides tasks when showAfterTime has not been reached', () => {
    // NOW is 10:00, threshold is 14:00
    expect(isTaskVisible({ ...baseTask, showAfterTime: '14:00' })).toBe(false);
  });

  it('shows tasks when showAfterTime is in the past', () => {
    // NOW is 10:00, threshold is 08:00
    expect(isTaskVisible({ ...baseTask, showAfterTime: '08:00' })).toBe(true);
  });

  it('shows tasks due today', () => {
    const dueDate = new Date(2025, 5, 10, 0, 0, 0).toISOString();
    expect(isTaskVisible({ ...baseTask, dueDate })).toBe(true);
  });

  it('shows overdue tasks (due in the past)', () => {
    const dueDate = new Date(2025, 5, 8, 0, 0, 0).toISOString(); // June 8
    expect(isTaskVisible({ ...baseTask, dueDate })).toBe(true);
  });

  it('hides tasks with a future due date', () => {
    const dueDate = new Date(2025, 5, 11, 0, 0, 0).toISOString(); // tomorrow
    expect(isTaskVisible({ ...baseTask, dueDate })).toBe(false);
  });

  it('hides when both deferUntil and showAfterTime block visibility', () => {
    const task: Task = {
      ...baseTask,
      deferUntil: new Date(2025, 5, 10, 15, 0, 0).toISOString(),
      showAfterTime: '14:00',
    };
    expect(isTaskVisible(task)).toBe(false);
  });
});

// ─── isTaskDeferred ───────────────────────────────────────────────────────────

describe('isTaskDeferred', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns false for completed tasks', () => {
    expect(isTaskDeferred({ ...baseTask, completed: true })).toBe(false);
  });

  it('returns false for visible tasks with no constraints', () => {
    expect(isTaskDeferred(baseTask)).toBe(false);
  });

  it('returns true for tasks with a future deferUntil', () => {
    const deferUntil = new Date(2025, 5, 11, 0, 0, 0).toISOString();
    expect(isTaskDeferred({ ...baseTask, deferUntil })).toBe(true);
  });

  it('returns true when showAfterTime has not been reached', () => {
    expect(isTaskDeferred({ ...baseTask, showAfterTime: '20:00' })).toBe(true);
  });

  it('returns true for tasks with a future due date', () => {
    const dueDate = new Date(2025, 5, 15, 0, 0, 0).toISOString();
    expect(isTaskDeferred({ ...baseTask, dueDate })).toBe(true);
  });

  it('returns false (not deferred) for overdue tasks', () => {
    const dueDate = new Date(2025, 5, 5, 0, 0, 0).toISOString();
    expect(isTaskDeferred({ ...baseTask, dueDate })).toBe(false);
  });
});

// ─── getVisibleAt ─────────────────────────────────────────────────────────────

describe('getVisibleAt', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns now when there are no constraints', () => {
    const result = getVisibleAt(baseTask);
    expect(result.getTime()).toBe(NOW.getTime());
  });

  it('returns the deferUntil date when deferred to the future', () => {
    const deferTime = new Date(2025, 5, 10, 15, 0, 0);
    const task: Task = { ...baseTask, deferUntil: deferTime.toISOString() };
    const result = getVisibleAt(task);
    expect(result.getTime()).toBe(deferTime.getTime());
  });

  it('returns showAfterTime threshold when it is in the future', () => {
    // NOW is 10:00, showAfterTime = 14:00 → threshold is 14:00 today
    const task: Task = { ...baseTask, showAfterTime: '14:00' };
    const result = getVisibleAt(task);
    const expected = new Date(2025, 5, 10, 14, 0, 0);
    expect(result.getHours()).toBe(14);
    expect(result.getMinutes()).toBe(0);
    expect(result.getDate()).toBe(expected.getDate());
  });

  it('returns dueDate day start when due date is in the future', () => {
    const dueDate = new Date(2025, 5, 11, 0, 0, 0); // tomorrow midnight
    const task: Task = { ...baseTask, dueDate: dueDate.toISOString() };
    const result = getVisibleAt(task);
    // dayStart of tomorrow with reset 00:00 = tomorrow at midnight
    expect(result.getDate()).toBe(11);
    expect(result.getHours()).toBe(0);
  });

  it('returns the latest date when multiple constraints are present', () => {
    // deferUntil: today at 15:00 vs dueDate: tomorrow midnight — dueDate wins
    const task: Task = {
      ...baseTask,
      deferUntil: new Date(2025, 5, 10, 15, 0, 0).toISOString(),
      dueDate: new Date(2025, 5, 11, 0, 0, 0).toISOString(),
    };
    const result = getVisibleAt(task);
    expect(result.getDate()).toBe(11);
    expect(result.getHours()).toBe(0);
  });

  it('ignores past deferUntil when building candidates', () => {
    // deferUntil already passed — should not be a candidate
    const task: Task = {
      ...baseTask,
      deferUntil: new Date(2025, 5, 10, 8, 0, 0).toISOString(), // 8 AM, before NOW
    };
    const result = getVisibleAt(task);
    expect(result.getTime()).toBe(NOW.getTime());
  });
});
