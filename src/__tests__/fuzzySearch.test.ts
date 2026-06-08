import { fuzzySearch } from '../utils/fuzzySearch';
import type { Task } from '../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Buy groceries',
  notes: '',
  completed: false,
  completedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  dueDate: null,
  deferUntil: null,
  timeOfDay: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceEndDate: null,
  recurrenceFromCompletion: false,
  tags: [],
  sortOrder: 1,
  focused: false,
  priority: 0,
  effort: 0,
  streakCount: 0,
  streakDate: null,
  parentId: null,
  reminderTime: null,
  cycleEnabled: false,
  cycleIndex: 0,
  cycleItems: [],
  projectId: null,
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
      const task = makeTask({ title: 'buy milk', notes: '', tags: [] });
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
      const titleTask = makeTask({ id: '1', title: 'important task', notes: '' });
      const notesTask = makeTask({ id: '2', title: 'unrelated', notes: 'important note' });
      const results = fuzzySearch([titleTask, notesTask], 'important');
      expect(results[0].task.id).toBe('1');
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
      const task = makeTask({ title: 'Buy milk', notes: '', tags: [] });
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
