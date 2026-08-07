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
  isUnscheduledTask,
  isLiveRecurring,
  isUpcomingToday,
  isQuotaTask,
  quotaExpectedByNow,
  isQuotaOnPace,
  quotaLeavesTodayAfterLog,
  quotaNextDueAt,
  isQuotaPartial,
  isOnPaceQuota,
  isDismissedToday,
  isTaskBlocked,
  isWaitingTask,
  activeChainStepTitle,
  displayTitleFor,
  sameTimeSegments,
} from '../utils/visibilityUtils';
import { registerTaskSource } from '../utils/blockerRegistry';
import { useCategoryStore } from '../store/useCategoryStore';
import type { Task, Category } from '../types';

const mockSettingsState = {
  dayResetTime: '00:00',
  morningStart: '06:00',
  afternoonStart: '12:00',
  eveningStart: '18:00',
  nightStart: '21:00',
  activeHoursStart: '08:00',
  activeHoursEnd: '22:00',
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
  excludeFromPinSuggestions: false,
  defaultTimeSegments: [],
  sortOrder: 1,
  emoji: null,
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
  deadlineMonthDay: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  tags: [],
  sortOrder: 0,
  pinned: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  recurrenceFromCompletion: false,
  targetCount: null,
  progressCount: 0,
  reminderTime: null,
  reminderKind: 'notification',
  parentId: null,
  groupId: null,
  projectId: null,
  category: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  vacationPause: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesId: null,
  seriesMonthDays: [],
  seriesRepeatMonths: 1,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
  blockedById: null,
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

  it('hides an uncompleted task with no date signal (it belongs in Inbox/Unscheduled, not Today)', () => {
    expect(isTaskVisible(baseTask)).toBe(false);
  });

  it('shows an uncompleted task once it has a due date', () => {
    const dueDate = new Date(2025, 5, 10, 0, 0, 0).toISOString();
    expect(isTaskVisible({ ...baseTask, dueDate })).toBe(true);
  });

  it('hides archived tasks unconditionally, regardless of vacation mode', () => {
    expect(isTaskVisible({ ...baseTask, archived: true })).toBe(false);
    mockSettingsState.vacationMode = true;
    expect(isTaskVisible({ ...baseTask, archived: true })).toBe(false);
    mockSettingsState.vacationMode = false;
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

  it('keeps a windowed task due yesterday visible past midnight until dayResetTime', () => {
    // A task due Jun 10 with an open-ended windowStart, checked at 12:30 AM
    // Jun 11 with a 4 AM reset — still Jun 10's logical day, so the window
    // should still be considered open, not compared against Jun 11's
    // (not-yet-arrived) windowStart.
    mockSettingsState.dayResetTime = '04:00';
    jest.setSystemTime(new Date(2025, 5, 11, 0, 30, 0));
    const dueDate = new Date(2025, 5, 10, 12, 0, 0).toISOString();
    expect(isTaskVisible({ ...baseTask, dueDate, windowStart: '08:00' })).toBe(true);
    mockSettingsState.dayResetTime = '00:00';
  });

  it('hides a project task with no due date, unlike an equivalent non-project task', () => {
    expect(isTaskVisible({ ...baseTask, projectId: 'proj1' })).toBe(false);
  });

  it('shows a project task due today', () => {
    const dueDate = new Date(2025, 5, 10, 0, 0, 0).toISOString();
    expect(isTaskVisible({ ...baseTask, projectId: 'proj1', dueDate })).toBe(true);
  });

  it('hides a project task with a future due date', () => {
    const dueDate = new Date(2025, 5, 11, 0, 0, 0).toISOString();
    expect(isTaskVisible({ ...baseTask, projectId: 'proj1', dueDate })).toBe(false);
  });

});

// ─── isUpcomingToday ───────────────────────────────────────────────────────────

describe('isUpcomingToday', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
    mockSettingsState.dayResetTime = '00:00';
    mockSettingsState.morningStart = '06:00';
  });

  it('is true when the segment threshold has not started today', () => {
    // NOW is 10:00 AM, evening starts at 18:00
    expect(isUpcomingToday({ ...baseTask, timeSegments: ['evening'] })).toBe(true);
  });

  it('is false once the segment threshold has passed', () => {
    expect(isUpcomingToday({ ...baseTask, timeSegments: ['morning'] })).toBe(false);
  });

  it('does not treat an already-started segment as upcoming during the early-morning grace window', () => {
    // dayResetTime and morningStart both 04:00 (setDayResetTime keeps them in
    // sync). At 1:49 AM the wall clock hasn't reached 4 AM yet, so we're
    // still inside *yesterday's* logical day (which began at 4 AM yesterday
    // and is still ongoing) — the morning segment for that logical day
    // started 21+ hours ago, not "later today".
    mockSettingsState.dayResetTime = '04:00';
    mockSettingsState.morningStart = '04:00';
    jest.setSystemTime(new Date(2026, 6, 31, 1, 49, 0)); // Fri Jul 31, 1:49 AM
    const task: Task = { ...baseTask, timeSegments: ['morning'] };
    expect(isUpcomingToday(task)).toBe(false);
    expect(isTaskVisible(task)).toBe(true);
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
    expect(isTaskExpired({ ...baseTask, windowStart: '07:00', windowEnd: '10:00' })).toBe(true);
  });

  // A window that runs into the small hours ("22:00–02:00"). Both gates anchor
  // to one logical day, so taken literally the task is past 02:00 from 02:00
  // onward — expired before it ever opened, and never visible once.
  it('is false all day for a window whose end is not after its start', () => {
    const nightly = { ...baseTask, windowStart: '22:00', windowEnd: '02:00' };
    expect(isTaskExpired(nightly)).toBe(false);
    jest.setSystemTime(new Date(2025, 5, 10, 23, 30, 0));
    expect(isTaskExpired(nightly)).toBe(false);
    expect(isTaskVisible(nightly)).toBe(true);
    expect(isTaskWindowActive(nightly)).toBe(true);
  });

  it('is false for a window with identical start and end', () => {
    expect(isTaskExpired({ ...baseTask, windowStart: '09:00', windowEnd: '09:00' })).toBe(false);
  });

  // windowEnd alone never puts a task on Today (see hasNoDateSignal) — it sits
  // in Unscheduled — so there's no day for it to be late for. It used to read
  // as expired from that clock time onward on every day forever, which handed
  // it to autoRemoveExpiredTasks.
  it('is false for a task carrying only a windowEnd, today and years later', () => {
    const someday = { ...baseTask, priority: 3 as const, windowEnd: '09:00' };
    expect(isTaskExpired(someday)).toBe(false);
    expect(isUnscheduledTask(someday)).toBe(true);
    jest.setSystemTime(new Date(2030, 5, 10, 18, 0, 0));
    expect(isTaskExpired(someday)).toBe(false);
  });

  it('is false for an undated project task with a windowEnd', () => {
    expect(isTaskExpired({ ...baseTask, projectId: 'p1', windowEnd: '09:00' })).toBe(false);
  });

  it('still expires an undated task once it has a windowStart to place it', () => {
    expect(isTaskExpired({ ...baseTask, windowStart: '07:00', windowEnd: '09:00' })).toBe(true);
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

  it('returns false for archived tasks', () => {
    const deferUntil = new Date(2025, 5, 11, 12, 0, 0).toISOString();
    expect(isTaskDeferred({ ...baseTask, archived: true, deferUntil })).toBe(false);
  });

  it('returns false for a task with no constraints (no date to defer to, belongs in Inbox/Unscheduled)', () => {
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

  it('returns false for an undated project task (it belongs in its project, not Later)', () => {
    expect(isTaskDeferred({ ...baseTask, projectId: 'proj1' })).toBe(false);
  });

  it('returns true for a project task with a future due date', () => {
    const dueDate = new Date(2025, 5, 15, 0, 0, 0).toISOString();
    expect(isTaskDeferred({ ...baseTask, projectId: 'proj1', dueDate })).toBe(true);
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

  // These cases test category-schedule gating specifically, so every task
  // carries a due date of today — otherwise the lack of a date signal alone
  // (see isTaskVisible's Inbox/Unscheduled gate) would hide it regardless of
  // category, muddying what's actually under test here.
  const dueToday = new Date(2025, 5, 10, 0, 0, 0).toISOString();

  it('shows work task on a weekday within work hours', () => {
    // Tuesday 10:00 AM — inside Mon–Fri 09:00–18:00
    expect(isTaskVisible({ ...baseTask, category: 'Work', dueDate: dueToday })).toBe(true);
  });

  it('hides work task on a weekend', () => {
    // June 14, 2025 = Saturday
    jest.setSystemTime(new Date(2025, 5, 14, 10, 0, 0));
    expect(isTaskVisible({ ...baseTask, category: 'Work', dueDate: dueToday })).toBe(false);
  });

  it('hides work task before start time on a weekday', () => {
    // Tuesday 8:00 AM — before 09:00
    jest.setSystemTime(new Date(2025, 5, 10, 8, 0, 0));
    expect(isTaskVisible({ ...baseTask, category: 'Work', dueDate: dueToday })).toBe(false);
  });

  it('hides work task after end time on a weekday', () => {
    // Tuesday 19:00 — after 18:00
    jest.setSystemTime(new Date(2025, 5, 10, 19, 0, 0));
    expect(isTaskVisible({ ...baseTask, category: 'Work', dueDate: dueToday })).toBe(false);
  });

  it('shows task with no category regardless of work schedule', () => {
    expect(isTaskVisible({ ...baseTask, dueDate: dueToday })).toBe(true);
  });

  it('shows task in a different category not in work schedule', () => {
    expect(isTaskVisible({ ...baseTask, category: 'Personal', dueDate: dueToday })).toBe(true);
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

// ─── Category schedule across midnight ────────────────────────────────────────
// Both halves of the same anchoring bug: the window used to be compared against
// raw wall-clock minutes and the wall-clock day-of-week, so it closed at
// midnight no matter where dayResetTime sat, and a window running into the
// small hours was unsatisfiable (end minutes below start minutes) and so never
// opened at all.

const eveningCategory: Category = {
  id: 'cat-evening',
  name: 'Evening Tasks',
  scheduleDays: [0, 1, 2, 3, 4, 5, 6],
  scheduleStart: '17:00',
  scheduleEnd: '02:00',
  hideOnVacation: false,
  excludeFromPinSuggestions: false,
  defaultTimeSegments: [],
  sortOrder: 1,
  emoji: null,
};

describe('category schedule — across midnight', () => {
  // Tuesday June 10's logical day, under a 4 AM reset: still running at
  // 00:30 on Wednesday the 11th.
  const dueTuesday = new Date(2025, 5, 10, 0, 0, 0).toISOString();

  beforeEach(() => {
    jest.useFakeTimers();
    mockSettingsState.dayResetTime = '04:00';
  });

  afterEach(() => {
    jest.useRealTimers();
    mockCategorySchedule(null);
    mockSettingsState.dayResetTime = '00:00';
  });

  it('keeps an evening category showing past midnight, until its own end time', () => {
    mockCategorySchedule(eveningCategory);
    jest.setSystemTime(new Date(2025, 5, 11, 0, 30, 0)); // 00:30, still Tuesday's day
    expect(isTaskVisible({ ...baseTask, category: 'Evening Tasks', dueDate: dueTuesday })).toBe(true);
  });

  it('closes the window at its end time in the small hours, not at midnight', () => {
    mockCategorySchedule(eveningCategory);
    jest.setSystemTime(new Date(2025, 5, 11, 2, 30, 0)); // 02:30 — past the 02:00 end
    expect(isTaskVisible({ ...baseTask, category: 'Evening Tasks', dueDate: dueTuesday })).toBe(false);
  });

  it('reads the day-of-week off the logical day, not the wall clock', () => {
    // Mon–Thu evenings. At 00:30 on Friday the logical day is still Thursday,
    // so the schedule is on — the wall clock's Friday must not end it early.
    mockCategorySchedule({ ...eveningCategory, scheduleDays: [1, 2, 3, 4] });
    jest.setSystemTime(new Date(2025, 5, 13, 0, 30, 0)); // Fri Jun 13, 00:30
    const dueThursday = new Date(2025, 5, 12, 0, 0, 0).toISOString();
    expect(isTaskVisible({ ...baseTask, category: 'Evening Tasks', dueDate: dueThursday })).toBe(true);
  });

  it('does not open the window before its start time on the logical day', () => {
    mockCategorySchedule(eveningCategory);
    jest.setSystemTime(new Date(2025, 5, 10, 16, 0, 0)); // 16:00 — before the 17:00 start
    expect(isTaskVisible({ ...baseTask, category: 'Evening Tasks', dueDate: dueTuesday })).toBe(false);
  });

  it('treats a window straddling the reset itself as running to the end of the day', () => {
    // 02:00–06:00 under a 4 AM reset: the end lands before the start on the
    // logical day's timeline, so there is no closing time to honour.
    mockCategorySchedule({ ...eveningCategory, scheduleStart: '02:00', scheduleEnd: '06:00' });
    jest.setSystemTime(new Date(2025, 5, 11, 3, 0, 0));
    expect(isTaskVisible({ ...baseTask, category: 'Evening Tasks', dueDate: dueTuesday })).toBe(true);
  });

  it('sends a closed window to a next start the task will actually show at', () => {
    mockCategorySchedule(eveningCategory);
    jest.setSystemTime(new Date(2025, 5, 11, 3, 0, 0)); // past 02:00, still Tuesday's day
    const result = getVisibleAt({ ...baseTask, category: 'Evening Tasks', dueDate: dueTuesday });
    expect(result.getDate()).toBe(11);
    expect(result.getHours()).toBe(17);
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
  excludeFromPinSuggestions: false,
  defaultTimeSegments: [],
  sortOrder: 1,
  emoji: null,
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

  // Same reasoning as the category-schedule block above: give every task a
  // due date of today so vacation-category gating is isolated from the
  // separate Inbox/Unscheduled date-signal gate.
  const dueToday = new Date(2025, 5, 10, 0, 0, 0).toISOString();

  it('hides tasks in a hidden category while vacation mode is on', () => {
    mockSettingsState.vacationMode = true;
    expect(isTaskVisible({ ...baseTask, category: 'Errands', dueDate: dueToday })).toBe(false);
  });

  it('shows tasks in a hidden category when vacation mode is off', () => {
    mockSettingsState.vacationMode = false;
    expect(isTaskVisible({ ...baseTask, category: 'Errands', dueDate: dueToday })).toBe(true);
  });

  it('does not treat the task as deferred (hidden everywhere, not surfaced on Later)', () => {
    mockSettingsState.vacationMode = true;
    expect(isTaskDeferred({ ...baseTask, category: 'Errands', dueDate: dueToday })).toBe(false);
  });

  it('leaves tasks in other categories visible during vacation mode', () => {
    mockSettingsState.vacationMode = true;
    expect(isTaskVisible({ ...baseTask, category: 'Work', dueDate: dueToday })).toBe(true);
    expect(isTaskVisible({ ...baseTask, category: null, dueDate: dueToday })).toBe(true);
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

  it('is false for a task assigned to a project, even with no other metadata', () => {
    expect(isInboxTask({ ...baseTask, projectId: 'proj1' })).toBe(false);
  });

  it('stays true for notes/effort/pin (they do not file a task)', () => {
    expect(isInboxTask({ ...baseTask, notes: 'a note', effort: 3, pinned: true })).toBe(true);
  });
});

// ─── isUnscheduledTask ───────────────────────────────────────────────────────

describe('isUnscheduledTask', () => {
  it('is false for a bare title-only task (that is an Inbox task instead)', () => {
    expect(isUnscheduledTask(baseTask)).toBe(false);
  });

  it('is true once an otherwise-undated task has organizing metadata', () => {
    expect(isUnscheduledTask({ ...baseTask, category: 'Work' })).toBe(true);
    expect(isUnscheduledTask({ ...baseTask, tags: ['home'] })).toBe(true);
    expect(isUnscheduledTask({ ...baseTask, priority: 2 })).toBe(true);
  });

  it('is false once the task has a due date, defer date, time segment or window', () => {
    const d = new Date(2025, 5, 12).toISOString();
    expect(isUnscheduledTask({ ...baseTask, category: 'Work', dueDate: d })).toBe(false);
    expect(isUnscheduledTask({ ...baseTask, category: 'Work', deferUntil: d })).toBe(false);
    expect(isUnscheduledTask({ ...baseTask, category: 'Work', timeSegments: ['morning'] })).toBe(false);
    expect(isUnscheduledTask({ ...baseTask, category: 'Work', windowStart: '09:00' })).toBe(false);
  });

  it('is false for a task assigned to a project (it lives in the project instead)', () => {
    expect(isUnscheduledTask({ ...baseTask, category: 'Work', projectId: 'proj1' })).toBe(false);
  });

  it('is false for completed tasks and subtasks', () => {
    expect(isUnscheduledTask({ ...baseTask, category: 'Work', completed: true })).toBe(false);
    expect(isUnscheduledTask({ ...baseTask, category: 'Work', parentId: 'p1' })).toBe(false);
  });
});

// ─── Quota tasks ──────────────────────────────────────────────────────────────

// Active hours run 08:00–22:00 (840 minutes) and NOW is 10:00 AM, so 120 of
// those minutes have passed — 1/7 of the day, which owes 2 of 8 units.
const quotaTask: Task = {
  ...baseTask,
  targetCount: 8,
  progressCount: 0,
  recurrenceType: 'daily',
  dueDate: new Date(2025, 5, 10, 12, 0, 0).toISOString(),
};

describe('quota tasks', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('isQuotaTask', () => {
    it('is false without a target, and for a target of one', () => {
      expect(isQuotaTask(baseTask)).toBe(false);
      expect(isQuotaTask({ ...quotaTask, targetCount: 1 })).toBe(false);
    });

    it('is true for a target of two or more', () => {
      expect(isQuotaTask(quotaTask)).toBe(true);
    });
  });

  describe('quotaExpectedByNow', () => {
    it('owes nothing before active hours open', () => {
      jest.setSystemTime(new Date(2025, 5, 10, 7, 0, 0));
      expect(quotaExpectedByNow(quotaTask)).toBe(0);
    });

    it('owes the first unit the moment they open', () => {
      jest.setSystemTime(new Date(2025, 5, 10, 8, 1, 0));
      expect(quotaExpectedByNow(quotaTask)).toBe(1);
    });

    it('ramps across the span', () => {
      expect(quotaExpectedByNow(quotaTask)).toBe(2);            // 10:00
      jest.setSystemTime(new Date(2025, 5, 10, 15, 0, 0));
      expect(quotaExpectedByNow(quotaTask)).toBe(4);            // half way
    });

    it('owes the lot once they close, and never more than the target', () => {
      jest.setSystemTime(new Date(2025, 5, 10, 23, 0, 0));
      expect(quotaExpectedByNow(quotaTask)).toBe(8);
    });

    it('uses the task\'s own time window over the global active hours', () => {
      // 09:00–11:00, so at 10:00 exactly half the window has gone.
      const windowed = { ...quotaTask, windowStart: '09:00', windowEnd: '11:00' };
      expect(quotaExpectedByNow(windowed)).toBe(4);
    });

    it('owes nothing for a task that is not a quota', () => {
      expect(quotaExpectedByNow(baseTask)).toBe(0);
    });
  });

  describe('visibility', () => {
    it('hides from Today while you are keeping up', () => {
      const onPace = { ...quotaTask, progressCount: 2 };
      expect(isQuotaOnPace(onPace)).toBe(true);
      expect(isTaskVisible(onPace)).toBe(false);
    });

    it('surfaces on Today once you fall behind', () => {
      const behind = { ...quotaTask, progressCount: 1 };
      expect(isQuotaOnPace(behind)).toBe(false);
      expect(isTaskVisible(behind)).toBe(true);
    });

    it('re-hides as soon as the next unit is logged', () => {
      const behind = { ...quotaTask, progressCount: 1 };
      expect(isTaskVisible(behind)).toBe(true);
      expect(isTaskVisible({ ...behind, progressCount: 2 })).toBe(false);
    });

    it('waits in Later while on pace', () => {
      expect(isTaskDeferred({ ...quotaTask, progressCount: 2 })).toBe(true);
    });

    it('still loses to its own date gate when due on a later day', () => {
      const tomorrow = {
        ...quotaTask,
        progressCount: 0, // behind pace, but not its day yet
        dueDate: new Date(2025, 5, 11, 12, 0, 0).toISOString(),
      };
      expect(isTaskVisible(tomorrow)).toBe(false);
    });
  });

  describe('quotaLeavesTodayAfterLog', () => {
    it('is true for the unit that puts a behind-pace task back on pace', () => {
      // 2 owed at 10:00: logging the 2nd catches up, so the row goes.
      expect(quotaLeavesTodayAfterLog({ ...quotaTask, progressCount: 1 })).toBe(true);
    });

    it('is false when the unit still leaves the task behind', () => {
      // Nothing logged at 15:00, where 4 are owed — one unit doesn't catch up.
      jest.setSystemTime(new Date(2025, 5, 10, 15, 0, 0));
      expect(quotaLeavesTodayAfterLog({ ...quotaTask, progressCount: 0 })).toBe(false);
    });

    it('is false for a task that is already hidden', () => {
      expect(quotaLeavesTodayAfterLog({ ...quotaTask, progressCount: 2 })).toBe(false);
    });

    it('is false for the unit that meets the target — that one completes it', () => {
      jest.setSystemTime(new Date(2025, 5, 10, 23, 0, 0));
      expect(quotaLeavesTodayAfterLog({ ...quotaTask, progressCount: 7 })).toBe(false);
    });

    it('is false for an ordinary task', () => {
      expect(quotaLeavesTodayAfterLog(baseTask)).toBe(false);
    });
  });

  describe('quotaNextDueAt', () => {
    it('is when the next unit falls due', () => {
      // 2 of 8 logged → a quarter of the way through an 08:00–22:00 span.
      expect(quotaNextDueAt({ ...quotaTask, progressCount: 2 })).toEqual(
        new Date(2025, 5, 10, 11, 30, 0)
      );
    });

    it('orders an on-pace quota in Later by that time', () => {
      expect(getVisibleAt({ ...quotaTask, progressCount: 2 })).toEqual(
        new Date(2025, 5, 10, 11, 30, 0)
      );
    });
  });

  describe('isQuotaPartial', () => {
    it('is true for a day closed out short of its target', () => {
      expect(isQuotaPartial({ ...quotaTask, completed: true, progressCount: 5 })).toBe(true);
    });

    it('is false for a day that hit its target, and while still open', () => {
      expect(isQuotaPartial({ ...quotaTask, completed: true, progressCount: 8 })).toBe(false);
      expect(isQuotaPartial({ ...quotaTask, progressCount: 5 })).toBe(false);
    });

    it('is false for an ordinary completed task', () => {
      expect(isQuotaPartial({ ...baseTask, completed: true })).toBe(false);
    });
  });

  describe('isOnPaceQuota', () => {
    it('is true for a target held back only by your keeping up with it', () => {
      expect(isOnPaceQuota({ ...quotaTask, progressCount: 2 })).toBe(true);
    });

    it('is false while it is behind pace — that one is on Today already', () => {
      expect(isOnPaceQuota({ ...quotaTask, progressCount: 1 })).toBe(false);
    });

    it('is false when something other than pace is holding it back', () => {
      const tomorrow = { ...quotaTask, progressCount: 2, dueDate: new Date(2025, 5, 11, 12, 0, 0).toISOString() };
      expect(isOnPaceQuota(tomorrow)).toBe(false);

      const laterToday = { ...quotaTask, progressCount: 2, windowStart: '18:00' };
      expect(isOnPaceQuota(laterToday)).toBe(false);

      const deferred = { ...quotaTask, progressCount: 2, deferUntil: new Date(2025, 5, 12).toISOString() };
      expect(isOnPaceQuota(deferred)).toBe(false);
    });

    it('is false once the day is done with, and for an ordinary task', () => {
      expect(isOnPaceQuota({ ...quotaTask, progressCount: 8, completed: true })).toBe(false);
      expect(isOnPaceQuota({ ...quotaTask, progressCount: 2, archived: true })).toBe(false);
      expect(isOnPaceQuota(baseTask)).toBe(false);
    });
  });

  describe('activeChainStepTitle / displayTitleFor', () => {
    const chainItems = [
      { id: 'c1', title: 'Stretch for five minutes', estimatedMinutes: null },
      { id: 'c2', title: 'Shower', estimatedMinutes: null },
      { id: 'c3', title: 'Brush teeth', estimatedMinutes: null },
    ];

    it('returns null when the task has no chain', () => {
      expect(activeChainStepTitle(baseTask)).toBeNull();
      expect(displayTitleFor(baseTask)).toBe(baseTask.title);
    });

    it('returns null for a single-item chain (indistinguishable from a plain task)', () => {
      const task = { ...baseTask, chainEnabled: true, chainItems: [chainItems[0]], chainIndex: 0 };
      expect(activeChainStepTitle(task)).toBeNull();
      expect(displayTitleFor(task)).toBe(task.title);
    });

    it('returns the active step title for a multi-step chain', () => {
      const task = { ...baseTask, chainEnabled: true, chainItems, chainIndex: 1 };
      expect(activeChainStepTitle(task)).toBe('Shower');
      expect(displayTitleFor(task)).toBe('Shower');
    });

    it('wraps the index via modulo, matching TaskItem\'s own indexing', () => {
      const task = { ...baseTask, chainEnabled: true, chainItems, chainIndex: 4 };
      expect(activeChainStepTitle(task)).toBe('Shower');
    });

    it('falls back to the task title once chainEnabled is off, even with items present', () => {
      const task = { ...baseTask, chainEnabled: false, chainItems, chainIndex: 1 };
      expect(activeChainStepTitle(task)).toBeNull();
      expect(displayTitleFor(task)).toBe(task.title);
    });
  });
});

describe('isDismissedToday', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is false with no stamp at all', () => {
    expect(isDismissedToday(null)).toBe(false);
  });

  it('is true for a stamp from earlier on the current logical day', () => {
    expect(isDismissedToday(new Date(2025, 5, 10, 8, 0, 0).toISOString())).toBe(true);
  });

  // The self-expiry the whole idiom rests on: nothing clears the stamp, it
  // simply stops matching once the day rolls over.
  it('is false for yesterday’s stamp', () => {
    expect(isDismissedToday(new Date(2025, 5, 9, 23, 59, 0).toISOString())).toBe(false);
  });

  it('respects a non-midnight day reset', () => {
    mockSettingsState.dayResetTime = '02:00';
    // 01:00 today is still "yesterday" under a 2am reset, so a stamp from then
    // belongs to the previous logical day and no longer suppresses anything.
    expect(isDismissedToday(new Date(2025, 5, 10, 1, 0, 0).toISOString())).toBe(false);
    expect(isDismissedToday(new Date(2025, 5, 10, 3, 0, 0).toISOString())).toBe(true);
    mockSettingsState.dayResetTime = '00:00';
  });
});

// ─── Waiting on (blockedById) ─────────────────────────────────────────────────

describe('blocking', () => {
  const blocker = { ...baseTask, id: 'blocker', title: 'Cancel the internet plan' };
  // Dated today, so "unblocked" and "visible" mean the same thing here — an
  // undated task stays off Today for its own reasons and would mask the gate.
  const waiter = {
    ...baseTask,
    id: 'waiter',
    title: 'Return the router',
    blockedById: 'blocker',
    dueDate: new Date(2025, 5, 10, 0, 0, 0).toISOString(),
  };
  const bareWaiter = { ...waiter, dueDate: null };

  // isTaskVisible resolves blockedById through the registry rather than an
  // argument, so each test points it at the table it wants.
  const withTasks = (tasks: Task[]) => registerTaskSource(() => tasks);

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    registerTaskSource(null);
    jest.useRealTimers();
  });

  it('hides a blocked task from Today', () => {
    withTasks([blocker, waiter]);
    expect(isTaskBlocked(waiter)).toBe(true);
    expect(isTaskVisible(waiter)).toBe(false);
  });

  it('keeps a blocked task out of Later — it has no moment to sort by', () => {
    withTasks([blocker, waiter]);
    expect(isTaskDeferred(waiter)).toBe(false);
  });

  it('keeps a blocked task out of Inbox and Unscheduled', () => {
    // Bare enough to be an Inbox task, and organized enough to be Unscheduled,
    // if blocking weren't disqualifying in both.
    withTasks([blocker, bareWaiter]);
    expect(isInboxTask(bareWaiter)).toBe(false);
    expect(isUnscheduledTask({ ...bareWaiter, category: 'Work' })).toBe(false);
  });

  it('still lists an undated blocked task on the Waiting screen', () => {
    withTasks([blocker, bareWaiter]);
    expect(isWaitingTask(bareWaiter)).toBe(true);
  });

  it('puts it on the Waiting screen instead', () => {
    withTasks([blocker, waiter]);
    expect(isWaitingTask(waiter)).toBe(true);
  });

  it('surfaces the task the moment its blocker is completed — with nothing written', () => {
    withTasks([{ ...blocker, completed: true }, waiter]);
    expect(isTaskBlocked(waiter)).toBe(false);
    expect(isTaskVisible(waiter)).toBe(true);
    expect(isWaitingTask(waiter)).toBe(false);
  });

  it('re-blocks when the blocker is uncompleted from the Logbook', () => {
    withTasks([{ ...blocker, completed: true }, waiter]);
    expect(isTaskVisible(waiter)).toBe(true);
    withTasks([blocker, waiter]);
    expect(isTaskVisible(waiter)).toBe(false);
  });

  it('frees the waiter when the blocker is deleted rather than stranding it', () => {
    withTasks([waiter]);
    expect(isTaskBlocked(waiter)).toBe(false);
    expect(isTaskVisible(waiter)).toBe(true);
  });

  it('frees the waiter when the blocker is archived', () => {
    withTasks([{ ...blocker, archived: true }, waiter]);
    expect(isTaskBlocked(waiter)).toBe(false);
    expect(isTaskVisible(waiter)).toBe(true);
  });

  it('beats a due date — a blocked task due today still does not show', () => {
    withTasks([blocker, waiter]);
    expect(isTaskVisible(waiter)).toBe(false);
    expect(isWaitingTask(waiter)).toBe(true);
  });

  it('does not treat a completed or archived waiter as blocked', () => {
    withTasks([blocker, waiter]);
    expect(isTaskBlocked({ ...waiter, completed: true })).toBe(false);
    expect(isTaskBlocked({ ...waiter, archived: true })).toBe(false);
  });

  it('leaves ordinary tasks alone', () => {
    withTasks([blocker, waiter]);
    expect(isTaskBlocked(blocker)).toBe(false);
    expect(isTaskVisible({ ...blocker, dueDate: NOW.toISOString() })).toBe(true);
  });

  it('blocks nothing when no task source is registered', () => {
    registerTaskSource(null);
    expect(isTaskBlocked(waiter)).toBe(false);
  });
});

// ─── sameTimeSegments ────────────────────────────────────────────────────────

describe('sameTimeSegments', () => {
  it('matches equal sets', () => {
    expect(sameTimeSegments(['night'], ['night'])).toBe(true);
    expect(sameTimeSegments([], [])).toBe(true);
  });

  it('does not match different sets', () => {
    expect(sameTimeSegments(['evening'], ['night'])).toBe(false);
    expect(sameTimeSegments([], ['night'])).toBe(false);
    expect(sameTimeSegments(['morning', 'night'], ['night'])).toBe(false);
  });

  // parseTaskInput and the templates can produce several segments at once, and
  // nothing guarantees the order two equal sets were written in.
  it('ignores order', () => {
    expect(sameTimeSegments(['morning', 'night'], ['night', 'morning'])).toBe(true);
  });
});
