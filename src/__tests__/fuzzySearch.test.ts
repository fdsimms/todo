import { fuzzySearch, mergeRanges } from '../utils/fuzzySearch';
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
  mealEntryId: null,
  pendingImport: null,
  ...overrides,
});

describe('fuzzySearch', () => {
  describe('empty / trivial inputs', () => {
    it('returns [] for empty query', () => {
      expect(fuzzySearch([makeTask()], '')).toEqual([]);
    });

    it('returns [] for whitespace-only query', () => {
      expect(fuzzySearch([makeTask()], '   ')).toEqual([]);
    });

    it('returns [] when task list is empty', () => {
      expect(fuzzySearch([], 'groceries')).toEqual([]);
    });
  });

  describe('subtask filtering', () => {
    it('excludes tasks with a parentId', () => {
      const sub = makeTask({ title: 'Buy milk', parentId: 'parent-1' });
      expect(fuzzySearch([sub], 'milk')).toHaveLength(0);
    });

    it('includes root-level tasks (parentId null)', () => {
      const task = makeTask({ title: 'Buy milk', parentId: null });
      expect(fuzzySearch([task], 'milk')).toHaveLength(1);
    });
  });

  describe('title matching', () => {
    it('matches an exact substring in the title', () => {
      const task = makeTask({ title: 'Buy groceries' });
      const results = fuzzySearch([task], 'groceries');
      expect(results).toHaveLength(1);
      expect(results[0].task).toBe(task);
    });

    it('assigns a higher score to a prefix match than a non-prefix match', () => {
      const prefix    = makeTask({ id: '1', title: 'groceries list' });      // index 0
      const nonPrefix = makeTask({ id: '2', title: 'buy groceries now' });   // index 4
      const results = fuzzySearch([nonPrefix, prefix], 'groceries');
      expect(results[0].task.id).toBe('1');
      expect(results[0].score).toBeGreaterThan(results[1].score);
    });

    it('is case-insensitive', () => {
      const task = makeTask({ title: 'Buy Groceries' });
      expect(fuzzySearch([task], 'BUY')).toHaveLength(1);
      expect(fuzzySearch([task], 'groceries')).toHaveLength(1);
    });

    it('matches chars in order even when non-consecutive (fuzzy)', () => {
      // 'b' and 'm' appear in 'buy milk' in order but are not a consecutive substring
      const task = makeTask({ title: 'buy milk' });
      expect(fuzzySearch([task], 'bm')).toHaveLength(1);
    });

    it('returns no result when query chars cannot be found in order', () => {
      const task = makeTask({ title: 'buy milk', tags: [] });
      expect(fuzzySearch([task], 'zzz')).toHaveLength(0);
    });
  });

  describe('notes and tag matching', () => {
    it('includes task when match is only in notes', () => {
      const task = makeTask({ title: 'Do chores', notes: 'including groceries' });
      expect(fuzzySearch([task], 'groceries')).toHaveLength(1);
    });

    it('includes task when match is only in a tag', () => {
      const task = makeTask({ title: 'Do chores', tags: ['urgent', 'work'] });
      expect(fuzzySearch([task], 'urgent')).toHaveLength(1);
    });

    it('partial tag substring match scores', () => {
      const task = makeTask({ tags: ['groceries'] });
      expect(fuzzySearch([task], 'grocer')).toHaveLength(1);
    });

    it('title match scores higher than notes-only match', () => {
      const titleTask = makeTask({ id: '1', title: 'important task' });
      const notesTask = makeTask({ id: '2', title: 'unrelated', notes: 'important note' });
      const results = fuzzySearch([titleTask, notesTask], 'important');
      expect(results[0].task.id).toBe('1');
    });
  });

  describe('category, project and chain step matching', () => {
    it('includes task when match is only in category', () => {
      const task = makeTask({ title: 'Do chores', category: 'Groceries' });
      expect(fuzzySearch([task], 'groceries')).toHaveLength(1);
    });

    it('includes task when match is only in project name', () => {
      const task = makeTask({ title: 'Do chores', projectId: 'proj-1' });
      const projectNamesById = new Map([['proj-1', 'Groceries run']]);
      expect(fuzzySearch([task], 'groceries', projectNamesById)).toHaveLength(1);
    });

    it('does not match project name when projectNamesById is not provided', () => {
      const task = makeTask({ title: 'Do chores', projectId: 'proj-1' });
      expect(fuzzySearch([task], 'groceries')).toHaveLength(0);
    });

    it('includes task when match is only in a chain step title', () => {
      const task = makeTask({
        title: 'Landlord stuff',
        chainItems: [
          { id: 'c1', title: 'Call the landlord about groceries budget', estimatedMinutes: null },
        ],
      });
      expect(fuzzySearch([task], 'groceries')).toHaveLength(1);
    });

    it('title match scores higher than category/project/chain-only match', () => {
      const titleTask = makeTask({ id: '1', title: 'important task' });
      const categoryTask = makeTask({ id: '2', title: 'unrelated', category: 'important' });
      const results = fuzzySearch([titleTask, categoryTask], 'important');
      expect(results[0].task.id).toBe('1');
    });

    it('matches the active chain step as a title match, not a weaker chain-only match', () => {
      const task = makeTask({
        title: 'Morning routine',
        chainEnabled: true,
        chainIndex: 0,
        chainItems: [
          { id: 'c1', title: 'Stretch for five minutes', estimatedMinutes: null },
          { id: 'c2', title: 'Shower', estimatedMinutes: null },
        ],
      });
      const [result] = fuzzySearch([task], 'stretch');
      expect(result.titleMatches).toEqual([[0, 7]]);
    });

    it('title match ranges land on the active step text, not the parent title, mid-chain', () => {
      // "Stretch" only appears in the active step, not in "Morning routine" —
      // a highlight range computed against task.title here would be wrong.
      const task = makeTask({
        title: 'Morning routine',
        chainEnabled: true,
        chainIndex: 0,
        chainItems: [
          { id: 'c1', title: 'Stretch for five minutes', estimatedMinutes: null },
          { id: 'c2', title: 'Shower', estimatedMinutes: null },
        ],
      });
      const withoutChain = makeTask({ id: '2', title: 'unrelated', category: 'stretch' });
      const results = fuzzySearch([task, withoutChain], 'stretch');
      // The chain task's title-weighted match outscores the category-only match.
      expect(results[0].task.id).toBe(task.id);
    });
  });

  describe('multi-word queries', () => {
    it('combines per-word scores so multi-word query scores higher than single-word', () => {
      const task = makeTask({ title: 'Buy groceries today' });
      const multi  = fuzzySearch([task], 'buy groceries');
      const single = fuzzySearch([task], 'buy');
      expect(multi[0].score).toBeGreaterThan(single[0].score);
    });

    it('includes task when only some words match (not all required)', () => {
      const task = makeTask({ title: 'Buy milk', tags: [] });
      // 'zzz' has no match but 'milk' does — totalScore > 0
      expect(fuzzySearch([task], 'milk zzz')).toHaveLength(1);
    });
  });

  describe('titleMatches ranges', () => {
    it('returns a range covering the matched substring in the title', () => {
      const task = makeTask({ title: 'Buy groceries' });
      const [result] = fuzzySearch([task], 'groceries');
      expect(result.titleMatches).toHaveLength(1);
      const [start, end] = result.titleMatches[0];
      expect(task.title.slice(start, end).toLowerCase()).toBe('groceries');
    });

    it('returns empty titleMatches when match is only in notes', () => {
      const task = makeTask({ title: 'Something else', notes: 'groceries here' });
      const [result] = fuzzySearch([task], 'groceries');
      expect(result.titleMatches).toHaveLength(0);
    });

    it('accumulates ranges for multi-word title matches', () => {
      const task = makeTask({ title: 'Buy groceries' });
      const [result] = fuzzySearch([task], 'buy groceries');
      expect(result.titleMatches.length).toBeGreaterThanOrEqual(2);
    });

    it('merges overlapping ranges from two words matching the same span', () => {
      // Without merging, HighlightedText walks [[4,7],[4,13]] with one cursor
      // and emits "gro" twice — the row renders "Buy gro groceries".
      const task = makeTask({ title: 'Buy groceries' });
      const [result] = fuzzySearch([task], 'gro groceries');
      expect(result.titleMatches).toEqual([[4, 13]]);
    });
  });

  describe('project name on the result', () => {
    const projectNamesById = new Map([['proj-1', 'Iceland trip']]);

    it('carries the project name so a row can show where the task came from', () => {
      const task = makeTask({ title: 'Book Airbnb', projectId: 'proj-1' });
      const [result] = fuzzySearch([task], 'airbnb', projectNamesById);
      expect(result.projectName).toBe('Iceland trip');
    });

    it('is null for a task with no project', () => {
      const [result] = fuzzySearch([makeTask({ title: 'Book Airbnb' })], 'airbnb');
      expect(result.projectName).toBeNull();
    });

    it('is null when the project id resolves to nothing', () => {
      const task = makeTask({ title: 'Book Airbnb', projectId: 'gone' });
      const [result] = fuzzySearch([task], 'airbnb', projectNamesById);
      expect(result.projectName).toBeNull();
    });

    it('ranges cover what matched in the project name', () => {
      const task = makeTask({ title: 'Book Airbnb', projectId: 'proj-1' });
      const [result] = fuzzySearch([task], 'iceland', projectNamesById);
      expect(result.projectMatches).toEqual([[0, 7]]);
    });

    it('leaves ranges empty when the query matched the title instead', () => {
      const task = makeTask({ title: 'Book Airbnb', projectId: 'proj-1' });
      const [result] = fuzzySearch([task], 'airbnb', projectNamesById);
      expect(result.projectMatches).toEqual([]);
    });
  });

  describe('mergeRanges', () => {
    it('leaves a single range alone', () => {
      expect(mergeRanges([[2, 5]])).toEqual([[2, 5]]);
    });

    it('sorts disjoint ranges and keeps them separate', () => {
      expect(mergeRanges([[8, 10], [0, 3]])).toEqual([[0, 3], [8, 10]]);
    });

    it('merges overlapping and adjacent ranges', () => {
      expect(mergeRanges([[0, 5], [3, 9], [9, 11]])).toEqual([[0, 11]]);
    });

    it('absorbs a range fully contained in an earlier one', () => {
      expect(mergeRanges([[0, 10], [2, 4]])).toEqual([[0, 10]]);
    });

    it('does not mutate the ranges it was given', () => {
      const input: [number, number][] = [[0, 5], [3, 9]];
      mergeRanges(input);
      expect(input).toEqual([[0, 5], [3, 9]]);
    });
  });

  describe('result sorting', () => {
    it('sorts by score descending', () => {
      const high = makeTask({ id: '1', title: 'groceries list' });    // prefix score
      const low  = makeTask({ id: '2', title: 'buy groceries now' }); // non-prefix score
      const results = fuzzySearch([low, high], 'groceries');
      expect(results[0].task.id).toBe('1');
    });

    it('ranks completed tasks below active tasks', () => {
      const active    = makeTask({ id: '1', title: 'Buy milk', completed: false });
      const completed = makeTask({ id: '2', title: 'Buy milk', completed: true, completedAt: '2025-01-01T00:00:00.000Z' });
      const results = fuzzySearch([completed, active], 'milk');
      expect(results[0].task.id).toBe('1');
      expect(results[1].task.id).toBe('2');
    });
  });
});
