const mockSettingsState = {
  dayResetTime: '00:00',
  vacationMode: false,
};

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
  },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: () => ({
      categories: [],
      getCategoryByName: () => null,
    }),
  },
}));

import { isMorningCheckInCandidate, morningCheckInTasks } from '../utils/morningCheckIn';
import type { Task } from '../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Take out trash',
  notes: '',
  completed: false,
  missedAt: null,
  autoScheduledAt: null,
  completedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  seenAt: null,
  dueDate: null,
  deadline: null,
  deadlineOffsetDays: null,
  deadlineMonthDay: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'daily',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceAnchorDay: null,
  recurrenceAnchorDate: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  supplyCount: null,
  supplyUnit: null,
  supplyRefillCount: null,
  supplyReorderAt: 1,
  supplyLeadDays: null,
  supplyDeclinedAtCount: null,
  supplyGroceryItemId: null,
  targetCount: null,
  targetUnit: null,
  progressCount: 0,
  allowOvershoot: false,
  quotaIntervalMinutes: null,
  quotaReminders: false,
  quotaStartedAt: null, quotaAlwaysVisible: false,
  quotaPeriod: 'day',
  tags: [],
  category: null,
  sortOrder: 1,
  pinned: false,
  pinnedOrder: 0,
  postponeCount: 0,
  postponeMuted: false,
  driftingSince: null,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null, reminderTimeAnchor: 'wallClock', reminderUtcOffsetMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  priorBestStreak: 0,
  polarity: 'positive',
  slipCount: 0,
  slipDate: null,
  showStreak: false,
  streakRequiresWindow: false,
  parentId: null,
  groupId: null,
  projectId: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  followUpTaskEveryN: null,
  followUpTaskTitle: null,
  followUpTaskDraft: null,
  followUpTaskOneAtATime: false,
  followUpTaskTally: 0,
  previousFollowUpTaskTally: 0,
  followUpTaskSourceTitle: null,
  vacationPause: false, excludeFromSuggestions: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  healthMetric: null,
  healthTarget: null, completionTimerMinutes: null,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesId: null,
  seriesMonthDays: [],
  seriesRepeatMonths: 1,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
  phoneNumber: null,
  emailAddress: null, location: null,
  blockedById: null,
  waitingOnPersonId: null,
  deliverableKind: null,
  deliverableValue: null,
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  timeBlockEventId: null,
  pendingImport: null,
  backfillDismissedFields: [],
  personIds: [],
  ...overrides,
});

const DAY_RESET = '00:00';
// Fixed "now" for every test: 2025-06-10 is today, so a dueDate on 2025-06-09
// or earlier is yesterday-or-older, and 2025-06-10 itself is today.
beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2025-06-10T09:00:00.000Z'));
});
afterEach(() => {
  jest.useRealTimers();
});

describe('isMorningCheckInCandidate', () => {
  it('is true for an uncompleted recurring task due on a past day', () => {
    const task = makeTask({ dueDate: '2025-06-09T00:00:00.000Z' });
    expect(isMorningCheckInCandidate(task, DAY_RESET)).toBe(true);
  });

  it('is false for a task due today', () => {
    const task = makeTask({ dueDate: '2025-06-10T00:00:00.000Z' });
    expect(isMorningCheckInCandidate(task, DAY_RESET)).toBe(false);
  });

  it('is false once the task is completed or archived', () => {
    const dueDate = '2025-06-09T00:00:00.000Z';
    expect(isMorningCheckInCandidate(makeTask({ dueDate, completed: true }), DAY_RESET)).toBe(false);
    expect(isMorningCheckInCandidate(makeTask({ dueDate, archived: true }), DAY_RESET)).toBe(false);
  });

  it('is false for a one-off (non-recurring) task', () => {
    const task = makeTask({ dueDate: '2025-06-09T00:00:00.000Z', recurrenceType: 'none' });
    expect(isMorningCheckInCandidate(task, DAY_RESET)).toBe(false);
  });

  it('is false for a task with no dueDate', () => {
    expect(isMorningCheckInCandidate(makeTask({ dueDate: null }), DAY_RESET)).toBe(false);
  });

  it('is false for a paused vacation task', () => {
    const task = makeTask({ dueDate: '2025-06-09T00:00:00.000Z', vacationPause: true });
    expect(isMorningCheckInCandidate(task, DAY_RESET)).toBe(false);
  });

  it('is false for a negative habit', () => {
    const task = makeTask({ dueDate: '2025-06-09T00:00:00.000Z', polarity: 'negative' });
    expect(isMorningCheckInCandidate(task, DAY_RESET)).toBe(false);
  });

  it('is false for a subtask', () => {
    const task = makeTask({ dueDate: '2025-06-09T00:00:00.000Z', parentId: 'parent-1' });
    expect(isMorningCheckInCandidate(task, DAY_RESET)).toBe(false);
  });

  it('during the grace window before a non-midnight dayResetTime, today\'s own task is not yet "yesterday"', () => {
    // 1:30am with a 2am reset is still logically June 9 — a bare calendar-date
    // comparison would see dueDate's June 9 vs. now's June 10 and wrongly flag
    // this as missed a day early (the grace-window bug CLAUDE.md calls out).
    jest.setSystemTime(new Date('2025-06-10T01:30:00.000Z'));
    const task = makeTask({ dueDate: '2025-06-09T00:00:00.000Z' });
    expect(isMorningCheckInCandidate(task, '02:00')).toBe(false);
  });

  it('a task from the day before that still counts as missed under the same reset', () => {
    jest.setSystemTime(new Date('2025-06-10T01:30:00.000Z'));
    const task = makeTask({ dueDate: '2025-06-08T00:00:00.000Z' });
    expect(isMorningCheckInCandidate(task, '02:00')).toBe(true);
  });
});

describe('morningCheckInTasks', () => {
  it('filters a mixed list down to only the eligible ones', () => {
    const missedYesterday = makeTask({ id: 'a', dueDate: '2025-06-09T00:00:00.000Z' });
    const doneYesterday = makeTask({ id: 'b', dueDate: '2025-06-09T00:00:00.000Z', completed: true });
    const dueToday = makeTask({ id: 'c', dueDate: '2025-06-10T00:00:00.000Z' });
    expect(morningCheckInTasks([missedYesterday, doneYesterday, dueToday], DAY_RESET)).toEqual([missedYesterday]);
  });

  it('returns an empty array when nothing qualifies', () => {
    expect(morningCheckInTasks([], DAY_RESET)).toEqual([]);
  });
});
