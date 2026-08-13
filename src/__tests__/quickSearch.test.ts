import { quickSearch, QUICK_SEARCH_LIMIT } from '../utils/quickSearch';
import type { Task } from '../types';

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', vacationMode: false }) },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ categories: [], getCategoryByName: () => null }) },
}));

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Buy groceries',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
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
  sortOrder: 1,
  pinned: false,
  pinnedOrder: 0,
  postponeCount: 0,
  postponeMuted: false,
  driftingSince: null,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  reminderKind: 'notification',
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
  category: null,
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
  mealEntryId: null,
  groceryItemId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  pendingImport: null,
  ...overrides,
});

const titles = (results: { task: Task }[]) => results.map(r => r.task.title);

describe('quickSearch', () => {
  describe('empty / trivial inputs', () => {
    it('reports nothing for an empty query', () => {
      expect(quickSearch([makeTask()], '')).toEqual({ results: [], total: 0, overflow: 0 });
    });

    it('reports nothing for a whitespace-only query', () => {
      expect(quickSearch([makeTask()], '   ')).toEqual({ results: [], total: 0, overflow: 0 });
    });

    it('reports nothing when no task matches', () => {
      const tasks = [makeTask({ id: 'a', title: 'Renew passport' })];
      expect(quickSearch(tasks, 'zzz')).toEqual({ results: [], total: 0, overflow: 0 });
    });
  });

  describe('capping', () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      makeTask({ id: `t${i}`, title: `Renew thing ${i}` })
    );

    it('returns at most QUICK_SEARCH_LIMIT results', () => {
      expect(quickSearch(many, 'renew').results).toHaveLength(QUICK_SEARCH_LIMIT);
    });

    it('reports the full match count as total, not the capped count', () => {
      expect(quickSearch(many, 'renew').total).toBe(9);
    });

    it('reports what it left out as overflow', () => {
      expect(quickSearch(many, 'renew').overflow).toBe(9 - QUICK_SEARCH_LIMIT);
    });

    it('has no overflow when everything fits', () => {
      const { results, total, overflow } = quickSearch(many.slice(0, 3), 'renew');
      expect(results).toHaveLength(3);
      expect(total).toBe(3);
      expect(overflow).toBe(0);
    });

    it('honours an explicit limit', () => {
      const { results, overflow } = quickSearch(many, 'renew', new Map(), 2);
      expect(results).toHaveLength(2);
      expect(overflow).toBe(7);
    });
  });

  describe('completed tasks', () => {
    it('includes them — a ticked task is still findable', () => {
      const tasks = [makeTask({ id: 'a', title: 'Pay rent', completed: true })];
      expect(titles(quickSearch(tasks, 'rent').results)).toEqual(['Pay rent']);
    });

    it('sorts them behind active matches even when they score higher', () => {
      const tasks = [
        // Exact prefix match — the higher score of the two.
        makeTask({ id: 'done', title: 'Rent', completed: true }),
        // Match is mid-title, so it scores lower.
        makeTask({ id: 'live', title: 'Pay the rent' }),
      ];
      expect(titles(quickSearch(tasks, 'rent').results)).toEqual(['Pay the rent', 'Rent']);
    });

    it('keeps completed matches from crowding active ones out of the cap', () => {
      const tasks = [
        ...Array.from({ length: 6 }, (_, i) =>
          makeTask({ id: `d${i}`, title: `Rent ${i}`, completed: true })
        ),
        makeTask({ id: 'live', title: 'Chase the rent cheque' }),
      ];
      const { results } = quickSearch(tasks, 'rent');
      expect(results[0].task.id).toBe('live');
      expect(results).toHaveLength(QUICK_SEARCH_LIMIT);
    });

    it('preserves score order within the active and completed halves', () => {
      const tasks = [
        makeTask({ id: 'a2', title: 'Chase the rent cheque' }),
        makeTask({ id: 'a1', title: 'Rent a van' }),
        makeTask({ id: 'c2', title: 'Sort the rent out', completed: true }),
        makeTask({ id: 'c1', title: 'Rent paid', completed: true }),
      ];
      expect(quickSearch(tasks, 'rent').results.map(r => r.task.id))
        .toEqual(['a1', 'a2', 'c1', 'c2']);
    });
  });

  describe('shared behaviour with the Search screen', () => {
    it('excludes subtasks, like fuzzySearch does', () => {
      const tasks = [makeTask({ id: 'sub', title: 'Renew passport', parentId: 'parent' })];
      expect(quickSearch(tasks, 'renew').total).toBe(0);
    });

    it('carries the title match ranges through for highlighting', () => {
      const tasks = [makeTask({ id: 'a', title: 'Renew passport' })];
      expect(quickSearch(tasks, 'renew').results[0].titleMatches).toEqual([[0, 5]]);
    });

    it('matches on project name when one is supplied', () => {
      const tasks = [makeTask({ id: 'a', title: 'Draft the brief', projectId: 'p1' })];
      const names = new Map([['p1', 'Renovation']]);
      expect(quickSearch(tasks, 'renovation', names).total).toBe(1);
    });
  });
});
