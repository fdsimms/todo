import { isTaskVisible, isTaskDeferred, getVisibleAt } from '../utils/visibilityUtils';
import type { Task } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      dayResetTime: '00:00',
      morningStart: '06:00',
      afternoonStart: '12:00',
      eveningStart: '18:00',
    }),
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
  timeSegments: [],
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
  projectId: null,
  category: null,
  cycleEnabled: false,
  cycleIndex: 0,
  cycleItems: [],
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

  it('hides tasks deferred to a future day', () => {
    const deferUntil = new Date(2025, 5, 11, 12, 0, 0).toISOString();
    expect(isTaskVisible({ ...baseTask, deferUntil })).toBe(false);
  });

  it('shows tasks whose deferUntil day has arrived (noon today)', () => {
    const deferUntil = new Date(2025, 5, 10, 12, 0, 0).toISOString();
    expect(isTaskVisible({ ...baseTask, deferUntil })).toBe(true);
  });

  it('hides tasks with afternoon segment before noon', () => {
    // NOW is 10:00 AM, afternoon starts at 12:00
    expect(isTaskVisible({ ...baseTask, timeSegments: ['afternoon'] })).toBe(false);
  });

  it('shows tasks with morning segment at 10 AM (morning started at 6 AM)', () => {
    expect(isTaskVisible({ ...baseTask, timeSegments: ['morning'] })).toBe(true);
  });

  it('hides tasks with evening segment before 6 PM', () => {
    expect(isTaskVisible({ ...baseTask, timeSegments: ['evening'] })).toBe(false);
  });

  it('shows tasks when earliest segment (morning) has started even if other segment (evening) has not', () => {
    // morning started at 6 AM — task is visible even though evening hasn't started
    expect(isTaskVisible({ ...baseTask, timeSegments: ['morning', 'evening'] })).toBe(true);
  });

  it('hides tasks where all segments are in the future', () => {
    // both afternoon (12:00) and evening (18:00) haven't started at 10 AM
    expect(isTaskVisible({ ...baseTask, timeSegments: ['afternoon', 'evening'] })).toBe(false);
  });

  it('shows tasks due today', () => {
    const dueDate = new Date(2025, 5, 10, 0, 0, 0).toISOString();
    expect(isTaskVisible({ ...baseTask, dueDate })).toBe(true);
  });

  it('shows overdue tasks (due in the past)', () => {
    const dueDate = new Date(2025, 5, 8, 0, 0, 0).toISOString();
    expect(isTaskVisible({ ...baseTask, dueDate })).toBe(true);
  });

  it('hides tasks with a future due date', () => {
    const dueDate = new Date(2025, 5, 11, 0, 0, 0).toISOString();
    expect(isTaskVisible({ ...baseTask, dueDate })).toBe(false);
  });

  it('hides when both deferUntil (future day) and segment block visibility', () => {
    const task: Task = {
      ...baseTask,
      deferUntil: new Date(2025, 5, 11, 12, 0, 0).toISOString(),
      timeSegments: ['evening'],
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

  it('returns true for tasks deferred to a future day', () => {
    const deferUntil = new Date(2025, 5, 11, 12, 0, 0).toISOString();
    expect(isTaskDeferred({ ...baseTask, deferUntil })).toBe(true);
  });

  it('returns true when evening segment has not started yet', () => {
    expect(isTaskDeferred({ ...baseTask, timeSegments: ['evening'] })).toBe(true);
  });

  it('returns false when morning segment has already started', () => {
    expect(isTaskDeferred({ ...baseTask, timeSegments: ['morning'] })).toBe(false);
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

  it('returns the deferUntil day start when deferred to a future day', () => {
    const deferUntil = new Date(2025, 5, 11, 12, 0, 0);
    const task: Task = { ...baseTask, deferUntil: deferUntil.toISOString() };
    const result = getVisibleAt(task);
    expect(result.getDate()).toBe(11);
  });

  it('returns earliest segment threshold when no segment has started today', () => {
    // NOW is 10:00 AM, evening starts at 18:00
    const task: Task = { ...baseTask, timeSegments: ['evening'] };
    const result = getVisibleAt(task);
    expect(result.getHours()).toBe(18);
    expect(result.getMinutes()).toBe(0);
    expect(result.getDate()).toBe(10);
  });

  it('returns afternoon start when afternoon has not started', () => {
    const task: Task = { ...baseTask, timeSegments: ['afternoon'] };
    const result = getVisibleAt(task);
    expect(result.getHours()).toBe(12);
    expect(result.getMinutes()).toBe(0);
  });

  it('returns earliest of multiple segments when none have started', () => {
    // afternoon (12:00) is earlier than evening (18:00), both are future at 10 AM
    const task: Task = { ...baseTask, timeSegments: ['evening', 'afternoon'] };
    const result = getVisibleAt(task);
    expect(result.getHours()).toBe(12);
  });

  it('returns dueDate day start when due date is in the future', () => {
    const dueDate = new Date(2025, 5, 11, 0, 0, 0);
    const task: Task = { ...baseTask, dueDate: dueDate.toISOString() };
    const result = getVisibleAt(task);
    expect(result.getDate()).toBe(11);
    expect(result.getHours()).toBe(0);
  });

  it('applies earliest segment to the deferUntil day', () => {
    const deferUntil = new Date(2025, 5, 11, 12, 0, 0);
    const task: Task = { ...baseTask, deferUntil: deferUntil.toISOString(), timeSegments: ['evening'] };
    const result = getVisibleAt(task);
    expect(result.getDate()).toBe(11);
    expect(result.getHours()).toBe(18);
  });

  it('ignores past deferUntil when building candidates', () => {
    const deferUntil = new Date(2025, 5, 10, 8, 0, 0); // 8 AM today, before NOW
    const task: Task = { ...baseTask, deferUntil: deferUntil.toISOString() };
    const result = getVisibleAt(task);
    expect(result.getTime()).toBe(NOW.getTime());
  });
});
