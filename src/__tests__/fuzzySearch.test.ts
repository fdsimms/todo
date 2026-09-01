import { fuzzySearch, mergeRanges, searchGroups, searchProjects } from '../utils/fuzzySearch';
import type { Project, Task, TaskGroup } from '../types';

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
  allowOvershoot: false,
  quotaIntervalMinutes: null,
  quotaReminders: false,
  quotaStartedAt: null, quotaAlwaysVisible: false,
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
  priorBestStreak: 0,
  showStreak: false,
  streakRequiresWindow: false,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskDraft: null,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
  category: null,
  vacationPause: false, excludeFromSuggestions: false,
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

    describe('held tasks', () => {
      it('ranks a held task as active, so ticking it off does not move it', () => {
        const tasks = [
          makeTask({ id: '1', title: 'Buy milk' }),
          makeTask({ id: '2', title: 'Buy milk and bread' }),
        ];
        const before = fuzzySearch(tasks, 'milk').map(r => r.task.id);

        const ticked = tasks.map(t =>
          t.id === '1' ? { ...t, completed: true, completedAt: '2025-01-01T00:00:00.000Z' } : t
        );
        expect(fuzzySearch(ticked, 'milk', new Map(), new Set(['1'])).map(r => r.task.id))
          .toEqual(before);
        expect(fuzzySearch(ticked, 'milk').map(r => r.task.id)).not.toEqual(before);
      });

      it('holds an uncompleted task without disturbing anything', () => {
        const tasks = [makeTask({ id: '1', title: 'Buy milk' })];
        expect(fuzzySearch(tasks, 'milk', new Map(), new Set(['1'])).map(r => r.task.id))
          .toEqual(['1']);
      });

      it('holds nothing by default', () => {
        const active    = makeTask({ id: '1', title: 'Buy milk' });
        const completed = makeTask({ id: '2', title: 'Buy milk', completed: true, completedAt: '2025-01-01T00:00:00.000Z' });
        expect(fuzzySearch([completed, active], 'milk').map(r => r.task.id)).toEqual(['1', '2']);
      });
    });
  });
});

const makeGroup = (overrides: Partial<TaskGroup> = {}): TaskGroup => ({
  id: 'g1',
  title: 'Morning routine',
  notes: '',
  tags: [],
  category: null,
  sortOrder: 1,
  collapsed: true,
  projectId: null,
  ...overrides,
});

describe('searchGroups', () => {
  it('returns nothing for an empty query', () => {
    expect(searchGroups([makeGroup()], '', new Map())).toEqual([]);
  });

  it('matches a stack by title', () => {
    const group = makeGroup({ title: 'Packing list' });
    const results = searchGroups([group], 'packing', new Map());
    expect(results).toHaveLength(1);
    expect(results[0].group.id).toBe(group.id);
    expect(results[0].titleMatches).toEqual([[0, 7]]);
  });

  it('excludes a stack whose title does not match', () => {
    const results = searchGroups([makeGroup({ title: 'Packing list' })], 'zzz', new Map());
    expect(results).toEqual([]);
  });

  it('ranks an exact-prefix title match above a fuzzy one', () => {
    const exact = makeGroup({ id: 'a', title: 'Trip packing' });
    const fuzzy = makeGroup({ id: 'b', title: 'Pick a cool king' }); // contains p-a-c-k-i-n-g out of order density
    const results = searchGroups([fuzzy, exact], 'packing', new Map());
    expect(results[0].group.id).toBe('a');
  });

  it('previews up to three roster members and reports the full count', () => {
    const group = makeGroup({ id: 'g1', title: 'Packing list' });
    const roster = [
      makeTask({ id: 't1', title: 'Passport' }),
      makeTask({ id: 't2', title: 'Charger' }),
      makeTask({ id: 't3', title: 'Toothbrush' }),
      makeTask({ id: 't4', title: 'Sunscreen' }),
    ];
    const results = searchGroups([group], 'packing', new Map([[group.id, roster]]));
    expect(results[0].memberTitles).toEqual(['Passport', 'Charger', 'Toothbrush']);
    expect(results[0].memberCount).toBe(4);
  });

  it('reports an empty preview for a stack with no roster', () => {
    const group = makeGroup({ title: 'Packing list' });
    const results = searchGroups([group], 'packing', new Map());
    expect(results[0].memberTitles).toEqual([]);
    expect(results[0].memberCount).toBe(0);
  });
});

// ─── searchProjects ─────────────────────────────────────────────────────────

const makeProject = (overrides: Partial<Project> = {}): Project => ({
  id: 'p1',
  title: 'Kitchen refresh',
  notes: '',
  deadline: null,
  category: null,
  sortOrder: 1,
  archived: false,
  archivedAt: null,
  completed: false,
  completedAt: null,
  ongoing: false,
  createdAt: '2025-01-01T00:00:00.000Z',
  nudgeCadenceDays: 0,
  autoSchedule: false,
  nudgeOptIn: false,
  reviewDeclinedAt: null,
  backfillDismissedFields: [],
  kind: 'project' as const,
  ...overrides,
});

describe('searchProjects', () => {
  it('returns nothing for an empty query', () => {
    expect(searchProjects([makeProject()], '', new Map())).toEqual([]);
    expect(searchProjects([makeProject()], '   ', new Map())).toEqual([]);
  });

  it('matches a project by title, and says where the match landed', () => {
    const results = searchProjects([makeProject({ title: 'Kitchen refresh' })], 'kitchen', new Map());
    expect(results).toHaveLength(1);
    expect(results[0].project.title).toBe('Kitchen refresh');
    expect(results[0].titleMatches).toEqual([[0, 7]]);
  });

  // The one reader Project.notes has ever had beyond the field that writes it.
  it('matches a project by its notes', () => {
    const project = makeProject({ title: 'Kitchen refresh', notes: 'The installer quoted separately' });
    const results = searchProjects([project], 'installer', new Map());
    expect(results).toHaveLength(1);
    // Notes score, but nothing in the title is highlighted for a notes-only hit.
    expect(results[0].titleMatches).toEqual([]);
  });

  it('ranks a title match above a notes-only match', () => {
    const titled = makeProject({ id: 'a', title: 'Garage shelving' });
    const noted = makeProject({ id: 'b', title: 'Loft conversion', notes: 'clear the garage first' });
    const results = searchProjects([noted, titled], 'garage', new Map());
    expect(results.map(r => r.project.id)).toEqual(['a', 'b']);
  });

  it('skips a project nothing in it matches', () => {
    expect(searchProjects([makeProject({ title: 'Kitchen refresh' })], 'passport', new Map())).toEqual([]);
  });

  // Still worth finding, just not what you were most likely looking for.
  it('ranks archived and completed projects below active ones at equal scores', () => {
    const active = makeProject({ id: 'a', title: 'Garage shelving' });
    const done = makeProject({ id: 'b', title: 'Garage shelving', completed: true });
    const filed = makeProject({ id: 'c', title: 'Garage shelving', archived: true });
    const results = searchProjects([done, filed, active], 'garage shelving', new Map());
    expect(results[0].project.id).toBe('a');
    expect(results.map(r => r.project.id).slice(1).sort()).toEqual(['b', 'c']);
  });

  it('carries the progress it is handed, and reads 0/0 for a project with none', () => {
    const projects = [makeProject({ id: 'a' }), makeProject({ id: 'b' })];
    const results = searchProjects(projects, 'kitchen', new Map([['a', { done: 3, total: 5 }]]));
    const byId = (id: string) => results.find(r => r.project.id === id)!;
    expect(byId('a').progress).toEqual({ done: 3, total: 5 });
    expect(byId('b').progress).toEqual({ done: 0, total: 0 });
  });

  it('requires every word of a multi-word query to contribute', () => {
    const project = makeProject({ title: 'Kitchen refresh' });
    // Both words are in the title, so this scores higher than either alone.
    const both = searchProjects([project], 'kitchen refresh', new Map());
    const one = searchProjects([project], 'kitchen', new Map());
    expect(both[0].score).toBeGreaterThan(one[0].score);
  });
});
