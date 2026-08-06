import { getRepeatedInstances, normalizeTitle } from '../utils/taskInstances';
import type { Task } from '../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'use BOGO ticket',
  notes: '',
  completed: true,
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
  progressCount: 0,
  tags: [],
  category: null,
  sortOrder: 1,
  pinned: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  reminderTime: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  parentId: null,
  groupId: null,
  projectId: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  vacationPause: false,
  timerStartedAt: null,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesId: null,
  seriesMonthDays: [],
  seriesRepeatMonths: 1,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
  ...overrides,
});

describe('normalizeTitle', () => {
  it('trims, collapses internal whitespace, and lowercases', () => {
    expect(normalizeTitle('  Use   BOGO  Ticket ')).toBe('use bogo ticket');
  });

  it('returns empty for a blank title', () => {
    expect(normalizeTitle('   ')).toBe('');
  });
});

describe('getRepeatedInstances', () => {
  it('groups completed one-offs that share a title (case/space-insensitive)', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'use BOGO ticket', completedAt: '2025-01-01T00:00:00.000Z' }),
      makeTask({ id: 'b', title: 'Use BOGO Ticket', completedAt: '2025-02-01T00:00:00.000Z' }),
      makeTask({ id: 'c', title: 'use  bogo  ticket', completedAt: '2025-03-01T00:00:00.000Z' }),
    ];
    const result = getRepeatedInstances(tasks);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(3);
    expect(result[0].key).toBe('use bogo ticket');
  });

  it('excludes tasks completed only once (not "repeated")', () => {
    const tasks = [makeTask({ id: 'a', title: 'one and done' })];
    expect(getRepeatedInstances(tasks)).toEqual([]);
  });

  it('excludes recurring tasks (they are tracked as habits)', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'water plants', recurrenceType: 'daily', completedAt: '2025-01-01T00:00:00.000Z' }),
      makeTask({ id: 'b', title: 'water plants', recurrenceType: 'daily', completedAt: '2025-01-02T00:00:00.000Z' }),
    ];
    expect(getRepeatedInstances(tasks)).toEqual([]);
  });

  it('excludes subtasks', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'buy milk', parentId: 'p1', completedAt: '2025-01-01T00:00:00.000Z' }),
      makeTask({ id: 'b', title: 'buy milk', parentId: 'p1', completedAt: '2025-01-02T00:00:00.000Z' }),
    ];
    expect(getRepeatedInstances(tasks)).toEqual([]);
  });

  it('ignores incomplete tasks and tasks with no completedAt', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'call dentist', completed: false, completedAt: null }),
      makeTask({ id: 'b', title: 'call dentist', completed: true, completedAt: null }),
      makeTask({ id: 'c', title: 'call dentist', completedAt: '2025-01-01T00:00:00.000Z' }),
    ];
    // Only one real completion → below the repeat threshold.
    expect(getRepeatedInstances(tasks)).toEqual([]);
  });

  it('reports count, last completion, and newest-first completion history', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'renew library book', completedAt: '2025-01-01T00:00:00.000Z' }),
      makeTask({ id: 'b', title: 'renew library book', completedAt: '2025-03-01T00:00:00.000Z' }),
      makeTask({ id: 'c', title: 'renew library book', completedAt: '2025-02-01T00:00:00.000Z' }),
    ];
    const [group] = getRepeatedInstances(tasks);
    expect(group.count).toBe(3);
    expect(group.lastCompletedAt).toBe('2025-03-01T00:00:00.000Z');
    expect(group.completions).toEqual([
      '2025-03-01T00:00:00.000Z',
      '2025-02-01T00:00:00.000Z',
      '2025-01-01T00:00:00.000Z',
    ]);
  });

  it('uses the most recent completion for display casing', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'use bogo ticket', completedAt: '2025-01-01T00:00:00.000Z' }),
      makeTask({ id: 'b', title: 'Use BOGO Ticket', completedAt: '2025-06-01T00:00:00.000Z' }),
    ];
    expect(getRepeatedInstances(tasks)[0].title).toBe('Use BOGO Ticket');
  });

  it('sorts by count desc, then most recent completion', () => {
    const tasks = [
      // "gym" — 2 completions, most recent in March
      makeTask({ id: 'g1', title: 'gym', completedAt: '2025-01-01T00:00:00.000Z' }),
      makeTask({ id: 'g2', title: 'gym', completedAt: '2025-03-01T00:00:00.000Z' }),
      // "read" — 3 completions
      makeTask({ id: 'r1', title: 'read', completedAt: '2025-01-01T00:00:00.000Z' }),
      makeTask({ id: 'r2', title: 'read', completedAt: '2025-01-02T00:00:00.000Z' }),
      makeTask({ id: 'r3', title: 'read', completedAt: '2025-01-03T00:00:00.000Z' }),
      // "walk" — 2 completions, most recent in Feb (older than gym's)
      makeTask({ id: 'w1', title: 'walk', completedAt: '2025-01-01T00:00:00.000Z' }),
      makeTask({ id: 'w2', title: 'walk', completedAt: '2025-02-01T00:00:00.000Z' }),
    ];
    expect(getRepeatedInstances(tasks).map(g => g.title)).toEqual(['read', 'gym', 'walk']);
  });

  it('respects a custom minCount', () => {
    const tasks = [
      makeTask({ id: 'a', title: 'meditate', completedAt: '2025-01-01T00:00:00.000Z' }),
      makeTask({ id: 'b', title: 'meditate', completedAt: '2025-01-02T00:00:00.000Z' }),
      makeTask({ id: 'c', title: 'meditate', completedAt: '2025-01-03T00:00:00.000Z' }),
    ];
    expect(getRepeatedInstances(tasks, 3)).toHaveLength(1);
    expect(getRepeatedInstances(tasks, 4)).toEqual([]);
  });

  it('ignores blank titles', () => {
    const tasks = [
      makeTask({ id: 'a', title: '   ', completedAt: '2025-01-01T00:00:00.000Z' }),
      makeTask({ id: 'b', title: '   ', completedAt: '2025-01-02T00:00:00.000Z' }),
    ];
    expect(getRepeatedInstances(tasks)).toEqual([]);
  });
});
