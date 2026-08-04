import { suggestTitles } from '../utils/titleSuggestions';
import type { Task } from '../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Buy groceries',
  notes: '',
  completed: false,
  completedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
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
  recurrenceMonthDay: null,
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  tags: [],
  sortOrder: 1,
  pinned: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  category: null,
  vacationPause: false,
  timerStartedAt: null,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  ...overrides,
});

describe('suggestTitles', () => {
  describe('query length guard', () => {
    it('returns [] for a query shorter than 2 chars', () => {
      const tasks = [makeTask({ title: 'use BOGO ticket' })];
      expect(suggestTitles(tasks, 'u')).toEqual([]);
    });

    it('returns [] for a whitespace-only query', () => {
      const tasks = [makeTask({ title: 'use BOGO ticket' })];
      expect(suggestTitles(tasks, '   ')).toEqual([]);
    });

    it('matches once the query reaches 2 chars', () => {
      const tasks = [makeTask({ title: 'use BOGO ticket' })];
      expect(suggestTitles(tasks, 'us').map(s => s.title)).toEqual(['use BOGO ticket']);
    });
  });

  describe('matching', () => {
    it('matches a prefix and highlights the matched range', () => {
      const tasks = [makeTask({ id: 'a', title: 'use BOGO ticket before it expires' })];
      const result = suggestTitles(tasks, 'use BOGO');
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('use BOGO ticket before it expires');
      expect(result[0].ranges).toEqual([[0, 8]]);
    });

    it('is case-insensitive', () => {
      const tasks = [makeTask({ title: 'Use BOGO ticket' })];
      expect(suggestTitles(tasks, 'use bogo').map(s => s.title)).toEqual(['Use BOGO ticket']);
    });

    it('matches a substring, not only a prefix', () => {
      const tasks = [makeTask({ title: 'remember to call the dentist' })];
      expect(suggestTitles(tasks, 'dentist').map(s => s.title)).toEqual(['remember to call the dentist']);
    });

    it('returns [] when nothing matches', () => {
      const tasks = [makeTask({ title: 'walk the dog' })];
      expect(suggestTitles(tasks, 'zzz')).toEqual([]);
    });
  });

  describe('dedupe and exclusions', () => {
    it('dedupes case-insensitively into a single suggestion', () => {
      const tasks = [
        makeTask({ id: 'a', title: 'use BOGO ticket' }),
        makeTask({ id: 'b', title: 'Use BOGO Ticket' }),
        makeTask({ id: 'c', title: 'use bogo ticket' }),
      ];
      const result = suggestTitles(tasks, 'use bogo');
      expect(result).toHaveLength(1);
    });

    it('keeps the most recently used casing when deduping', () => {
      const tasks = [
        makeTask({ id: 'old', title: 'use bogo ticket', createdAt: '2025-01-01T00:00:00.000Z' }),
        makeTask({ id: 'new', title: 'Use BOGO Ticket', createdAt: '2025-06-01T00:00:00.000Z' }),
      ];
      expect(suggestTitles(tasks, 'use bogo')[0].title).toBe('Use BOGO Ticket');
    });

    it('excludes a title that exactly equals the query', () => {
      const tasks = [makeTask({ title: 'use BOGO ticket' })];
      expect(suggestTitles(tasks, 'use BOGO ticket')).toEqual([]);
    });

    it('excludes subtasks', () => {
      const tasks = [makeTask({ title: 'use BOGO ticket', parentId: 'parent-1' })];
      expect(suggestTitles(tasks, 'use bogo')).toEqual([]);
    });

    it('ignores blank titles', () => {
      const tasks = [makeTask({ title: '   ' })];
      expect(suggestTitles(tasks, 'us')).toEqual([]);
    });
  });

  describe('completed tasks', () => {
    it('includes completed tasks (the whole point of surfacing one-offs)', () => {
      const tasks = [
        makeTask({ title: 'use BOGO ticket', completed: true, completedAt: '2025-05-01T00:00:00.000Z' }),
      ];
      expect(suggestTitles(tasks, 'use bogo').map(s => s.title)).toEqual(['use BOGO ticket']);
    });
  });

  describe('ranking and limit', () => {
    it('ranks a prefix match above a mid-string match', () => {
      const tasks = [
        makeTask({ id: 'mid', title: 'go to the gym session' }),
        makeTask({ id: 'pre', title: 'gym session tonight' }),
      ];
      expect(suggestTitles(tasks, 'gym')[0].title).toBe('gym session tonight');
    });

    it('breaks score ties by recency (most recent first)', () => {
      const tasks = [
        makeTask({ id: 'older', title: 'gym at noon', createdAt: '2025-01-01T00:00:00.000Z' }),
        makeTask({ id: 'newer', title: 'gym at dawn', createdAt: '2025-06-01T00:00:00.000Z' }),
      ];
      expect(suggestTitles(tasks, 'gym at').map(s => s.title)).toEqual(['gym at dawn', 'gym at noon']);
    });

    it('respects the limit', () => {
      const tasks = Array.from({ length: 10 }, (_, i) =>
        makeTask({ id: String(i), title: `task number ${i}` })
      );
      expect(suggestTitles(tasks, 'task', 3)).toHaveLength(3);
    });
  });
});
