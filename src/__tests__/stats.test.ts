import { onTimeSummary } from '../utils/stats';
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
  driftingSince: null,
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
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
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
  deliverableKind: null,
  deliverableValue: null,
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  pendingImport: null,
  ...overrides,
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
