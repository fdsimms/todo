import { isMissed, isRealCompletion, mostMissed } from '../utils/missed';
import type { Task } from '../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Take out trash',
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
  recurrenceType: 'daily',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  targetCount: null,
  targetUnit: null,
  progressCount: 0,
  allowOvershoot: false,
  tags: [],
  category: null,
  sortOrder: 1,
  pinned: false,
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

describe('isMissed / isRealCompletion', () => {
  it('isMissed is true only when missedAt is set', () => {
    expect(isMissed(makeTask({ missedAt: '2025-01-01T00:00:00.000Z' }))).toBe(true);
    expect(isMissed(makeTask({ missedAt: null }))).toBe(false);
  });

  it('isRealCompletion excludes missed rows', () => {
    expect(isRealCompletion(makeTask({ completed: true, missedAt: null }))).toBe(true);
    expect(isRealCompletion(makeTask({ completed: true, missedAt: '2025-01-01T00:00:00.000Z' }))).toBe(false);
    expect(isRealCompletion(makeTask({ completed: false, missedAt: null }))).toBe(false);
  });
});

describe('mostMissed', () => {
  it('counts multiple misses of the same recurring task chain together', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'Take out trash', missedAt: '2025-01-01T00:00:00.000Z', previousOccurrenceId: null }),
      makeTask({ id: 'b', title: 'Take out trash', missedAt: '2025-01-08T00:00:00.000Z', previousOccurrenceId: 'a' }),
      makeTask({ id: 'c', title: 'Take out trash', missedAt: '2025-01-15T00:00:00.000Z', previousOccurrenceId: 'b' }),
    ];
    const result = mostMissed(tasks);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: 'Take out trash', count: 3, lastMissedAt: '2025-01-15T00:00:00.000Z' });
  });

  it('sorts a task missed many times ahead of one missed once', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'Water plants', missedAt: '2025-01-01T00:00:00.000Z' }),
      makeTask({ id: 'b', title: 'Take out trash', missedAt: '2025-01-01T00:00:00.000Z' }),
      makeTask({ id: 'c', title: 'Take out trash', missedAt: '2025-01-08T00:00:00.000Z', previousOccurrenceId: 'b' }),
      makeTask({ id: 'd', title: 'Take out trash', missedAt: '2025-01-15T00:00:00.000Z', previousOccurrenceId: 'c' }),
    ];
    const result = mostMissed(tasks);
    expect(result.map(g => g.title)).toEqual(['Take out trash', 'Water plants']);
    expect(result[0].count).toBe(3);
    expect(result[1].count).toBe(1);
  });

  it('excludes a task that has never been missed', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'Take out trash', completed: true, missedAt: null }),
      makeTask({ id: 'b', title: 'Water plants', missedAt: '2025-01-01T00:00:00.000Z' }),
    ];
    const result = mostMissed(tasks);
    expect(result.map(g => g.title)).toEqual(['Water plants']);
  });

  it('ignores subtasks and groups case/space-insensitively', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'take out  TRASH', missedAt: '2025-01-01T00:00:00.000Z' }),
      makeTask({ id: 'b', title: 'Take Out Trash', missedAt: '2025-01-08T00:00:00.000Z' }),
      makeTask({ id: 'c', title: 'Take out trash', missedAt: '2025-01-15T00:00:00.000Z', parentId: 'a' }),
    ];
    const result = mostMissed(tasks);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(2);
  });
});
