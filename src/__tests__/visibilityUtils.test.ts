import {
  isTaskVisible,
  isTaskDeferred,
  isTaskWindowActive,
  isTaskExpired,
  getVisibleAt,
  isHiddenForVacation,
  isRecurrenceNotYetDue,
  isTaskNew,
  isInboxTask,
  isLiveRecurring,
} from '../utils/visibilityUtils';
import { useCategoryStore } from '../store/useCategoryStore';
import type { Task, Category } from '../types';

const mockSettingsState = {
  dayResetTime: '00:00',
  morningStart: '06:00',
  afternoonStart: '12:00',
  eveningStart: '18:00',
  vacationMode: false,
};

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
  },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: jest.fn(() => ({
      categories: [],
      getCategoryByName: jest.fn().mockReturnValue(null),
    })),
  },
}));

const mockCategorySchedule = (schedule: Partial<Category> | null) => {
  (useCategoryStore.getState as jest.Mock).mockReturnValue({
    categories: schedule ? [schedule] : [],
    getCategoryByName: (name: string) =>
      schedule && name === (schedule as Category).name ? schedule as Category : null,
  });
};

const workCategory: Category = {
  id: 'cat-work',
  name: 'Work',
  scheduleDays: [1, 2, 3, 4, 5],
  scheduleStart: '09:00',
  scheduleEnd: '18:00',
  hideOnVacation: false,
  sortOrder: 1,
};

const baseTask: Task = {
  id: 'test-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  createdAt: new Date(2025, 0, 1).toISOString(),
  seenAt: null,
  dueDate: null,
  deadline: null,
  deadlineOffsetDays: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceEndDate: null,
  recurrenceCount: null,
  tags: [],
  sortOrder: 0,
  focused: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  recurrenceFromCompletion: false,
  reminderTime: null,
  parentId: null,
  category: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  vacationPause: false,
  timerStartedAt: null,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesDefaults: null,
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

  it('hides a task due tomorrow (noon-anchored) even with an afternoon dayResetTime', () => {
    // WhenPicker anchors calendar-picked due dates at noon, regardless of
    // dayResetTime. With a 2 PM reset and "now" past that reset today, a due
    // date of tomorrow at noon must not collapse into today's logical day —
    // that anchor hour is just where the picker landed, not a signal that
    // the date belongs to the previous logical day.
    mockSettingsState.dayResetTime = '14:00';
    jest.setSystemTime(new Date(2025, 5, 10, 15, 0, 0)); // 3 PM, after today's reset
    const dueDate = new Date(2025, 5, 11, 12, 0, 0).toISOString(); // tomorrow, noon
    expect(isTaskVisible({ ...baseTask, dueDate })).toBe(false);
    mockSettingsState.dayResetTime = '00:00';
  });

  it('hides when both deferUntil (future day) and segment block visibility', () => {
    const task: Task = {
      ...baseTask,
      deferUntil: new Date(2025, 5, 11, 12, 0, 0).toISOString(),
      timeSegments: ['evening'],
    };
    expect(isTaskVisible(task)).toBe(false);
  });

  it('hides tasks whose time window has not started yet', () => {
    // NOW is 10:00 AM
    expect(isTaskVisible({ ...baseTask, windowStart: '12:00', windowEnd: '18:00' })).toBe(false);
  });

  it('shows tasks currently inside their time window', () => {
    expect(isTaskVisible({ ...baseTask, windowStart: '08:00', windowEnd: '13:00' })).toBe(true);
  });

  it('hides tasks whose time window has already closed', () => {
    expect(isTaskVisible({ ...baseTask, windowStart: '07:00', windowEnd: '09:00' })).toBe(false);
  });

});

// ─── isTaskWindowActive ────────────────────────────────────────────────────────

describe('isTaskWindowActive', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW); // 10:00 AM
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is false for a task with no windowStart', () => {
    expect(isTaskWindowActive(baseTask)).toBe(false);
  });

  it('is false before windowStart', () => {
    expect(isTaskWindowActive({ ...baseTask, windowStart: '12:00', windowEnd: '18:00' })).toBe(false);
  });

  it('is true between windowStart and windowEnd', () => {
    expect(isTaskWindowActive({ ...baseTask, windowStart: '08:00', windowEnd: '13:00' })).toBe(true);
  });

  it('is false at/after windowEnd', () => {
    expect(isTaskWindowActive({ ...baseTask, windowStart: '07:00', windowEnd: '09:00' })).toBe(false);
  });

  it('is true with windowStart in the past and no windowEnd (open-ended)', () => {
    expect(isTaskWindowActive({ ...baseTask, windowStart: '08:00', windowEnd: null })).toBe(true);
  });

  it('is false for a completed task', () => {
    expect(isTaskWindowActive({ ...baseTask, completed: true, windowStart: '08:00', windowEnd: '13:00' })).toBe(false);
  });
});

// ─── isTaskExpired ─────────────────────────────────────────────────────────────

describe('isTaskExpired', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW); // 10:00 AM
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is false for a task with no windowEnd', () => {
    expect(isTaskExpired(baseTask)).toBe(false);
  });

  it('is false before windowEnd', () => {
    expect(isTaskExpired({ ...baseTask, windowStart: '08:00', windowEnd: '13:00' })).toBe(false);
  });

  it('is true once windowEnd has passed', () => {
    expect(isTaskExpired({ ...baseTask, windowStart: '07:00', windowEnd: '09:00' })).toBe(true);
  });

  it('is true exactly at windowEnd', () => {
    expect(isTaskExpired({ ...baseTask, windowEnd: '10:00' })).toBe(true);
  });

  it('is false for a completed task', () => {
    expect(isTaskExpired({ ...baseTask, completed: true, windowEnd: '09:00' })).toBe(false);
  });

  it('is false when the task is due on a future day, even if the clock time has passed', () => {
    const dueDate = new Date(2025, 5, 11, 0, 0, 0).toISOString(); // tomorrow
    expect(isTaskExpired({ ...baseTask, dueDate, windowEnd: '09:00' })).toBe(false);
  });

  it('is true when the task was due on a past day and the window has closed', () => {
    const dueDate = new Date(2025, 5, 8, 0, 0, 0).toISOString(); // 2 days ago
    expect(isTaskExpired({ ...baseTask, dueDate, windowEnd: '09:00' })).toBe(true);
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

  it('returns false for an expired task (it belongs in the Expired bucket, not Later)', () => {
    expect(isTaskDeferred({ ...baseTask, windowStart: '07:00', windowEnd: '09:00' })).toBe(false);
  });

  it('returns true for a task whose window has not started yet today', () => {
    expect(isTaskDeferred({ ...baseTask, windowStart: '12:00', windowEnd: '18:00' })).toBe(true);
  });

});

// ─── isRecurrenceNotYetDue ────────────────────────────────────────────────────

describe('isRecurrenceNotYetDue', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns false for a non-recurring task with a future due date', () => {
    const dueDate = new Date(2025, 5, 15, 0, 0, 0).toISOString();
    expect(isRecurrenceNotYetDue({ ...baseTask, recurrenceType: 'none', dueDate })).toBe(false);
  });

  it('returns true for a recurring task due on a future day', () => {
    const dueDate = new Date(2025, 5, 15, 0, 0, 0).toISOString();
    expect(isRecurrenceNotYetDue({ ...baseTask, recurrenceType: 'daily', dueDate })).toBe(true);
  });

  it('returns true for a recurring task deferred to a future day', () => {
    const deferUntil = new Date(2025, 5, 11, 12, 0, 0).toISOString();
    expect(isRecurrenceNotYetDue({ ...baseTask, recurrenceType: 'daily', deferUntil })).toBe(true);
  });

  it('returns false for a recurring task due today', () => {
    const dueDate = new Date(2025, 5, 10, 0, 0, 0).toISOString();
    expect(isRecurrenceNotYetDue({ ...baseTask, recurrenceType: 'daily', dueDate })).toBe(false);
  });

  it('returns false for a recurring task hidden only behind a same-day time segment', () => {
    expect(isRecurrenceNotYetDue({ ...baseTask, recurrenceType: 'daily', timeSegments: ['evening'] })).toBe(false);
  });

  it('returns false for a completed recurring task', () => {
    const dueDate = new Date(2025, 5, 15, 0, 0, 0).toISOString();
    expect(isRecurrenceNotYetDue({ ...baseTask, recurrenceType: 'daily', dueDate, completed: true })).toBe(false);
  });
});

// ─── isLiveRecurring ──────────────────────────────────────────────────────────

describe('isLiveRecurring', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns false for a non-recurring task', () => {
    expect(isLiveRecurring({ ...baseTask, recurrenceType: 'none' })).toBe(false);
  });

  it('returns false for a completed recurring task', () => {
    expect(isLiveRecurring({ ...baseTask, recurrenceType: 'daily', completed: true })).toBe(false);
  });

  it('returns true for a not-yet-completed recurring task with a next occurrence', () => {
    expect(isLiveRecurring({ ...baseTask, recurrenceType: 'daily' })).toBe(true);
  });

  it('returns false once the series has ended (recurrenceEndDate already passed)', () => {
    const dueDate = new Date(2025, 5, 10, 0, 0, 0).toISOString();
    const recurrenceEndDate = new Date(2025, 5, 10, 0, 0, 0).toISOString(); // next due would exceed this
    expect(isLiveRecurring({ ...baseTask, recurrenceType: 'daily', dueDate, recurrenceEndDate })).toBe(false);
  });

  it('returns false once recurrenceCount has run out', () => {
    expect(isLiveRecurring({ ...baseTask, recurrenceType: 'daily', recurrenceCount: 1 })).toBe(false);
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

  it('returns windowStart threshold when the window has not started today', () => {
    const task: Task = { ...baseTask, windowStart: '12:00', windowEnd: '18:00' };
    const result = getVisibleAt(task);
    expect(result.getHours()).toBe(12);
    expect(result.getMinutes()).toBe(0);
    expect(result.getDate()).toBe(10);
  });

  it('returns now when already inside the time window', () => {
    const task: Task = { ...baseTask, windowStart: '08:00', windowEnd: '13:00' };
    const result = getVisibleAt(task);
    expect(result.getTime()).toBe(NOW.getTime());
  });

  it('applies windowStart to a future dueDate day', () => {
    const dueDate = new Date(2025, 5, 11, 0, 0, 0);
    const task: Task = { ...baseTask, dueDate: dueDate.toISOString(), windowStart: '08:00', windowEnd: '13:00' };
    const result = getVisibleAt(task);
    expect(result.getDate()).toBe(11);
    expect(result.getHours()).toBe(8);
  });
});

// ─── Category schedule visibility ─────────────────────────────────────────────
// NOW = Tuesday June 10, 2025 at 10:00 AM (getDay() === 2)
// workCategory = Mon–Fri, 09:00–18:00

describe('category schedule — isTaskVisible', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    mockCategorySchedule(workCategory);
  });

  afterEach(() => {
    jest.useRealTimers();
    mockCategorySchedule(null);
  });

  it('shows work task on a weekday within work hours', () => {
    // Tuesday 10:00 AM — inside Mon–Fri 09:00–18:00
    expect(isTaskVisible({ ...baseTask, category: 'Work' })).toBe(true);
  });

  it('hides work task on a weekend', () => {
    // June 14, 2025 = Saturday
    jest.setSystemTime(new Date(2025, 5, 14, 10, 0, 0));
    expect(isTaskVisible({ ...baseTask, category: 'Work' })).toBe(false);
  });

  it('hides work task before start time on a weekday', () => {
    // Tuesday 8:00 AM — before 09:00
    jest.setSystemTime(new Date(2025, 5, 10, 8, 0, 0));
    expect(isTaskVisible({ ...baseTask, category: 'Work' })).toBe(false);
  });

  it('hides work task after end time on a weekday', () => {
    // Tuesday 19:00 — after 18:00
    jest.setSystemTime(new Date(2025, 5, 10, 19, 0, 0));
    expect(isTaskVisible({ ...baseTask, category: 'Work' })).toBe(false);
  });

  it('shows task with no category regardless of work schedule', () => {
    expect(isTaskVisible(baseTask)).toBe(true);
  });

  it('shows task in a different category not in work schedule', () => {
    expect(isTaskVisible({ ...baseTask, category: 'Personal' })).toBe(true);
  });
});

describe('category schedule — getVisibleAt', () => {
  afterEach(() => {
    jest.useRealTimers();
    mockCategorySchedule(null);
  });

  it('returns start time today when before the window on a valid day', () => {
    // Tuesday 8:00 AM — before 09:00 start
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 8, 0, 0));
    mockCategorySchedule(workCategory);
    const result = getVisibleAt({ ...baseTask, category: 'Work' });
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(0);
    expect(result.getDate()).toBe(10);
  });

  it('returns Monday 09:00 when called on Saturday', () => {
    // Saturday June 14 at 10:00 AM → next window is Monday June 16 09:00
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 14, 10, 0, 0));
    mockCategorySchedule(workCategory);
    const result = getVisibleAt({ ...baseTask, category: 'Work' });
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(0);
  });

  it('returns next day start when after work hours on a weekday', () => {
    // Tuesday 19:00 — after 18:00 → next window is Wednesday 09:00
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2025, 5, 10, 19, 0, 0));
    mockCategorySchedule(workCategory);
    const result = getVisibleAt({ ...baseTask, category: 'Work' });
    expect(result.getDay()).toBe(3); // Wednesday
    expect(result.getHours()).toBe(9);
  });
});

// ─── Category hidden on vacation ──────────────────────────────────────────────

const errandsCategory: Category = {
  id: 'cat-errands',
  name: 'Errands',
  scheduleDays: null,
  scheduleStart: null,
  scheduleEnd: null,
  hideOnVacation: true,
  sortOrder: 1,
};

describe('category hide-on-vacation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    mockCategorySchedule(errandsCategory);
  });

  afterEach(() => {
    jest.useRealTimers();
    mockCategorySchedule(null);
    mockSettingsState.vacationMode = false;
  });

  it('hides tasks in a hidden category while vacation mode is on', () => {
    mockSettingsState.vacationMode = true;
    expect(isTaskVisible({ ...baseTask, category: 'Errands' })).toBe(false);
  });

  it('shows tasks in a hidden category when vacation mode is off', () => {
    mockSettingsState.vacationMode = false;
    expect(isTaskVisible({ ...baseTask, category: 'Errands' })).toBe(true);
  });

  it('does not treat the task as deferred (hidden everywhere, not surfaced on Later)', () => {
    mockSettingsState.vacationMode = true;
    expect(isTaskDeferred({ ...baseTask, category: 'Errands' })).toBe(false);
  });

  it('leaves tasks in other categories visible during vacation mode', () => {
    mockSettingsState.vacationMode = true;
    expect(isTaskVisible({ ...baseTask, category: 'Work' })).toBe(true);
    expect(isTaskVisible({ ...baseTask, category: null })).toBe(true);
  });
});

// ─── isTaskNew ─────────────────────────────────────────────────────────────────

describe('isTaskNew', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW); // June 10, 2025, 10:00 AM
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is false for a task with no scheduling constraints', () => {
    expect(isTaskNew(baseTask)).toBe(false);
  });

  it('is false for a completed task even if its due day just arrived', () => {
    const dueDate = new Date(2025, 5, 10, 0, 0, 0).toISOString();
    expect(isTaskNew({ ...baseTask, completed: true, dueDate })).toBe(false);
  });

  it('is true when a task becomes visible on its due day and has never been seen', () => {
    const dueDate = new Date(2025, 5, 10, 0, 0, 0).toISOString();
    expect(isTaskNew({ ...baseTask, dueDate })).toBe(true);
  });

  it('is false when the due day has not arrived yet (task is hidden)', () => {
    const dueDate = new Date(2025, 5, 11, 0, 0, 0).toISOString();
    expect(isTaskNew({ ...baseTask, dueDate })).toBe(false);
  });

  it('is true when a deferred task’s day has just arrived and has never been seen', () => {
    const deferUntil = new Date(2025, 5, 10, 0, 0, 0).toISOString();
    expect(isTaskNew({ ...baseTask, deferUntil })).toBe(true);
  });

  it('is true when a same-day time segment threshold has just passed and has never been seen', () => {
    // morning started at 6 AM, NOW is 10 AM
    expect(isTaskNew({ ...baseTask, timeSegments: ['morning'] })).toBe(true);
  });

  it('is false while the time segment threshold has not passed yet', () => {
    expect(isTaskNew({ ...baseTask, timeSegments: ['evening'] })).toBe(false);
  });

  it('is false once seenAt is after the task became visible', () => {
    const dueDate = new Date(2025, 5, 10, 0, 0, 0).toISOString();
    const seenAt = new Date(2025, 5, 10, 9, 0, 0).toISOString(); // after due-day start
    expect(isTaskNew({ ...baseTask, dueDate, seenAt })).toBe(false);
  });

  it('is true again if seenAt predates the day the task became visible', () => {
    const dueDate = new Date(2025, 5, 10, 0, 0, 0).toISOString();
    const seenAt = new Date(2025, 5, 9, 9, 0, 0).toISOString(); // before due-day start
    expect(isTaskNew({ ...baseTask, dueDate, seenAt })).toBe(true);
  });

  it('is false for a task only gated by windowStart (not a day-turnover cause)', () => {
    expect(isTaskNew({ ...baseTask, windowStart: '08:00', windowEnd: '13:00' })).toBe(false);
  });
});

// ─── isHiddenForVacation ──────────────────────────────────────────────────────

describe('isHiddenForVacation', () => {
  afterEach(() => {
    mockCategorySchedule(null);
    mockSettingsState.vacationMode = false;
  });

  it('is false when vacation mode is off, even for a paused task', () => {
    mockSettingsState.vacationMode = false;
    expect(isHiddenForVacation({ ...baseTask, vacationPause: true })).toBe(false);
  });

  it('is true for a vacation-paused task while vacation mode is on', () => {
    mockSettingsState.vacationMode = true;
    expect(isHiddenForVacation({ ...baseTask, vacationPause: true })).toBe(true);
  });

  it('is true for a task in a hide-on-vacation category', () => {
    mockSettingsState.vacationMode = true;
    mockCategorySchedule(errandsCategory);
    expect(isHiddenForVacation({ ...baseTask, category: 'Errands' })).toBe(true);
  });

  it('is false for an unrelated task during vacation mode', () => {
    mockSettingsState.vacationMode = true;
    expect(isHiddenForVacation(baseTask)).toBe(false);
  });

  it('is false for a completed paused task', () => {
    mockSettingsState.vacationMode = true;
    expect(isHiddenForVacation({ ...baseTask, vacationPause: true, completed: true })).toBe(false);
  });
});

// ─── isInboxTask ──────────────────────────────────────────────────────────────

describe('isInboxTask', () => {
  it('is true for a title-only task (all defaults)', () => {
    expect(isInboxTask(baseTask)).toBe(true);
  });

  it('is false once the task has a category', () => {
    expect(isInboxTask({ ...baseTask, category: 'Work' })).toBe(false);
  });

  it('is false once the task has a tag', () => {
    expect(isInboxTask({ ...baseTask, tags: ['home'] })).toBe(false);
  });

  it('is false with a due date, deadline, defer date or reminder', () => {
    const d = new Date(2025, 5, 12).toISOString();
    expect(isInboxTask({ ...baseTask, dueDate: d })).toBe(false);
    expect(isInboxTask({ ...baseTask, deadline: d })).toBe(false);
    expect(isInboxTask({ ...baseTask, deferUntil: d })).toBe(false);
    expect(isInboxTask({ ...baseTask, reminderTime: '09:00' })).toBe(false);
  });

  it('is false with a time segment or time window', () => {
    expect(isInboxTask({ ...baseTask, timeSegments: ['morning'] })).toBe(false);
    expect(isInboxTask({ ...baseTask, windowStart: '09:00' })).toBe(false);
    expect(isInboxTask({ ...baseTask, windowEnd: '17:00' })).toBe(false);
  });

  it('is false with recurrence or a non-default priority', () => {
    expect(isInboxTask({ ...baseTask, recurrenceType: 'daily' })).toBe(false);
    expect(isInboxTask({ ...baseTask, priority: 2 })).toBe(false);
  });

  it('is false for completed tasks and subtasks', () => {
    expect(isInboxTask({ ...baseTask, completed: true })).toBe(false);
    expect(isInboxTask({ ...baseTask, parentId: 'p1' })).toBe(false);
  });

  it('stays true for notes/effort/focus (they do not file a task)', () => {
    expect(isInboxTask({ ...baseTask, notes: 'a note', effort: 3, focused: true })).toBe(true);
  });
});
