import { timeTrackedSummary, onTimeSummary, estimateAccuracy } from '../utils/stats';
import type { Task } from '../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Test Task',
  notes: '',
  completed: true,
  missedAt: null,
  autoScheduledAt: null,
  completedAt: '2025-01-01T00:00:00.000Z',
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
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  targetCount: null,
  targetUnit: null,
  allowOvershoot: false,
  progressCount: 0,
  tags: [],
  category: null,
  sortOrder: 1,
  pinned: false,
  pinnedOrder: 0,
  postponeCount: 0,
  postponeMuted: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  reminderTime: null,
  reminderKind: 'notification',
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  parentId: null,
  groupId: null,
  projectId: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
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
  phoneNumber: null,
  emailAddress: null,
  blockedById: null,
  pendingImport: null,
  ...overrides,
});

describe('timeTrackedSummary', () => {
  it('sums actualMinutes across completed timed tasks', () => {
    const tasks = [
      makeTask({ id: 'a', actualMinutes: 30 }),
      makeTask({ id: 'b', actualMinutes: 45 }),
      makeTask({ id: 'c', actualMinutes: null }),
    ];
    expect(timeTrackedSummary(tasks)).toEqual({ totalMinutes: 75, trackedCount: 2 });
  });

  it('excludes subtasks', () => {
    const tasks = [makeTask({ id: 'a', parentId: 'parent', actualMinutes: 30 })];
    expect(timeTrackedSummary(tasks)).toEqual({ totalMinutes: 0, trackedCount: 0 });
  });

  it('returns zeros when nothing is tracked', () => {
    expect(timeTrackedSummary([])).toEqual({ totalMinutes: 0, trackedCount: 0 });
  });
});

describe('onTimeSummary', () => {
  it('counts completed-by-deadline vs completed-after-deadline', () => {
    const tasks = [
      makeTask({ id: 'a', completed: true, completedAt: '2025-01-05T00:00:00.000Z', deadline: '2025-01-06T00:00:00.000Z' }),
      makeTask({ id: 'b', completed: true, completedAt: '2025-01-08T00:00:00.000Z', deadline: '2025-01-06T00:00:00.000Z' }),
    ];
    expect(onTimeSummary(tasks)).toEqual({ onTime: 1, total: 2, rate: 0.5 });
  });

  it('ignores an occurrence marked missed — it is history, not an achievement', () => {
    const tasks = [
      makeTask({ id: 'a', completed: true, completedAt: '2025-01-05T00:00:00.000Z', deadline: '2025-01-06T00:00:00.000Z' }),
      makeTask({
        id: 'b',
        completed: true,
        completedAt: '2025-01-05T00:00:00.000Z',
        missedAt: '2025-01-05T00:00:00.000Z',
        deadline: '2025-01-06T00:00:00.000Z',
      }),
    ];
    expect(onTimeSummary(tasks)).toEqual({ onTime: 1, total: 1, rate: 1 });
  });

  it('ignores completed tasks with no deadline', () => {
    const tasks = [makeTask({ id: 'a', completed: true, deadline: null })];
    expect(onTimeSummary(tasks)).toEqual({ onTime: 0, total: 0, rate: 0 });
  });

  it('ignores incomplete tasks even with a deadline', () => {
    const tasks = [makeTask({ id: 'a', completed: false, completedAt: null, deadline: '2025-01-06T00:00:00.000Z' })];
    expect(onTimeSummary(tasks)).toEqual({ onTime: 0, total: 0, rate: 0 });
  });

  it('rate is 0 when there are no deadlined completions', () => {
    expect(onTimeSummary([])).toEqual({ onTime: 0, total: 0, rate: 0 });
  });
});

describe('estimateAccuracy', () => {
  it('falls back to a one-off task\'s own estimate when there is no predecessor', () => {
    const tasks = [makeTask({ id: 'a', estimatedMinutes: 30, actualMinutes: 45 })];
    expect(estimateAccuracy(tasks)).toEqual({ count: 1, averageRatio: 1.5 });
  });

  it('compares this occurrence\'s actual against the previous occurrence\'s estimate', () => {
    const tasks = [
      makeTask({ id: 'a', estimatedMinutes: 20, actualMinutes: 20 }),
      makeTask({ id: 'b', previousOccurrenceId: 'a', estimatedMinutes: 20, actualMinutes: 40 }),
    ];
    // b's own estimate (20) was backfilled from its own measurement and would
    // make the comparison trivially 1 — the previous occurrence's estimate (a's, 20)
    // against b's actual (40) is the meaningful ratio.
    expect(estimateAccuracy(tasks)).toEqual({ count: 2, averageRatio: (20 / 20 + 40 / 20) / 2 });
  });

  it('skips a task whose previous occurrence has no estimate rather than falling back to its own', () => {
    const tasks = [
      makeTask({ id: 'a', estimatedMinutes: null, actualMinutes: 20 }),
      makeTask({ id: 'b', previousOccurrenceId: 'a', estimatedMinutes: 40, actualMinutes: 40 }),
    ];
    expect(estimateAccuracy(tasks)).toEqual({ count: 0, averageRatio: 1 });
  });

  it('excludes untimed and incomplete tasks', () => {
    const tasks = [
      makeTask({ id: 'a', completed: false, completedAt: null, estimatedMinutes: 30, actualMinutes: null }),
      makeTask({ id: 'b', estimatedMinutes: 30, actualMinutes: null }),
    ];
    expect(estimateAccuracy(tasks)).toEqual({ count: 0, averageRatio: 1 });
  });

  it('averageRatio is 1 with no comparisons', () => {
    expect(estimateAccuracy([])).toEqual({ count: 0, averageRatio: 1 });
  });
});
