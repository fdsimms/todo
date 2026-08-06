/**
 * Tests for src/utils/pinSuggest.ts — the local scorer behind suggested pins.
 *
 * Most of these build a PinContext by hand rather than going through
 * buildPinContext(), which is the point of the split: the weights are testable
 * against a fixed clock without mocking any store.
 */

import {
  suggestPins,
  scoreTask,
  overdueDays,
  buildCoOccurrenceIndex,
  currentTimeSegment,
  buildPinContext,
  MAX_SUGGESTED_PINS,
  type PinContext,
} from '../utils/pinSuggest';
import { useCategoryStore } from '../store/useCategoryStore';
import type { Task } from '../types';

const mockSettingsState = {
  dayResetTime: '00:00',
  morningStart: '06:00',
  afternoonStart: '12:00',
  eveningStart: '18:00',
  nightStart: '21:00',
};

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
  },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: jest.fn(() => ({ categories: [] })),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A fixed "now": Sunday 15 March 2026, 09:00 local. Local components
// throughout — the scorer's date math is deliberately local-calendar, never
// ISO-string slicing.
const TODAY_START = new Date(2026, 2, 15);
const NOW = new Date(2026, 2, 15, 9, 0, 0);

/** A stored date the way the app writes them: local noon on the given day. */
const storedDate = (year: number, monthIndex: number, day: number): string =>
  new Date(year, monthIndex, day, 12, 0, 0).toISOString();

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
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
  tags: [],
  category: null,
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
  vacationPause: false,
  timerStartedAt: null,
  actualMinutes: null,
  previousOccurrenceId: null,
  seriesDefaults: null,
  archived: false,
  archivedAt: null,
  linkUrl: null,
  ...overrides,
});

const makeCtx = (overrides: Partial<PinContext> = {}): PinContext => ({
  todayStart: TODAY_START,
  currentSegment: 'morning',
  excludedCategories: new Set<string>(),
  coOccurrence: new Map<string, number>(),
  ...overrides,
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// overdueDays
// ---------------------------------------------------------------------------

describe('overdueDays', () => {
  it('is null for a task with no due date', () => {
    expect(overdueDays(makeTask(), TODAY_START)).toBeNull();
  });

  it('is 0 for a task due today', () => {
    expect(overdueDays(makeTask({ dueDate: storedDate(2026, 2, 15) }), TODAY_START)).toBe(0);
  });

  it('counts calendar days late', () => {
    expect(overdueDays(makeTask({ dueDate: storedDate(2026, 2, 12) }), TODAY_START)).toBe(3);
  });

  it('is negative for a task not due yet', () => {
    expect(overdueDays(makeTask({ dueDate: storedDate(2026, 2, 20) }), TODAY_START)).toBe(-5);
  });

  it('reads the local calendar day, not the UTC one', () => {
    // A due date late on the local day still belongs to that local day. The
    // implementation this replaced compared `toISOString().split('T')[0]`
    // strings, which rolls to the next/previous date under any non-zero UTC
    // offset and put "today" a day out for users east of UTC+12.
    const lateToday = new Date(2026, 2, 15, 23, 30, 0).toISOString();
    const earlyToday = new Date(2026, 2, 15, 0, 30, 0).toISOString();
    expect(overdueDays(makeTask({ dueDate: lateToday }), TODAY_START)).toBe(0);
    expect(overdueDays(makeTask({ dueDate: earlyToday }), TODAY_START)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildCoOccurrenceIndex
// ---------------------------------------------------------------------------

describe('buildCoOccurrenceIndex', () => {
  const completedAt = (hoursFromBase: number): string =>
    new Date(new Date(2026, 2, 1, 9, 0, 0).getTime() + hoursFromBase * 3600_000).toISOString();

  it('counts pairs completed inside the same 2-hour window', () => {
    const index = buildCoOccurrenceIndex([
      makeTask({ id: 'a', title: 'Dishes', completed: true, completedAt: completedAt(0) }),
      makeTask({ id: 'b', title: 'Laundry', completed: true, completedAt: completedAt(1) }),
    ]);
    expect(index.get('dishes ↔ laundry')).toBe(1);
  });

  it('does not pair completions further apart than the window', () => {
    const index = buildCoOccurrenceIndex([
      makeTask({ id: 'a', title: 'Dishes', completed: true, completedAt: completedAt(0) }),
      makeTask({ id: 'b', title: 'Laundry', completed: true, completedAt: completedAt(5) }),
    ]);
    expect(index.size).toBe(0);
  });

  it('accumulates a pair seen across several sessions', () => {
    const index = buildCoOccurrenceIndex([
      makeTask({ id: 'a1', title: 'Dishes', completed: true, completedAt: completedAt(0) }),
      makeTask({ id: 'b1', title: 'Laundry', completed: true, completedAt: completedAt(1) }),
      makeTask({ id: 'a2', title: 'Dishes', completed: true, completedAt: completedAt(24) }),
      makeTask({ id: 'b2', title: 'Laundry', completed: true, completedAt: completedAt(25) }),
    ]);
    expect(index.get('dishes ↔ laundry')).toBe(2);
  });

  it('ignores two occurrences of the same recurring task', () => {
    // Same title twice in one window is a streak, not evidence that two
    // different things get done together.
    const index = buildCoOccurrenceIndex([
      makeTask({ id: 'a1', title: 'Dishes', completed: true, completedAt: completedAt(0) }),
      makeTask({ id: 'a2', title: 'Dishes', completed: true, completedAt: completedAt(1) }),
    ]);
    expect(index.size).toBe(0);
  });

  it('skips rows with no completedAt', () => {
    const index = buildCoOccurrenceIndex([
      makeTask({ id: 'a', title: 'Dishes', completed: true, completedAt: null }),
      makeTask({ id: 'b', title: 'Laundry', completed: true, completedAt: completedAt(0) }),
    ]);
    expect(index.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// scoreTask
// ---------------------------------------------------------------------------

describe('scoreTask', () => {
  const ctx = makeCtx();

  it('scores a bare task at zero', () => {
    expect(scoreTask(makeTask(), [], ctx)).toBe(0);
  });

  it('rises with priority', () => {
    const low = scoreTask(makeTask({ priority: 1 }), [], ctx);
    const urgent = scoreTask(makeTask({ priority: 4 }), [], ctx);
    expect(urgent).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(0);
  });

  it('ranks an overdue task above one due today, and today above undated', () => {
    const undated = scoreTask(makeTask(), [], ctx);
    const today = scoreTask(makeTask({ dueDate: storedDate(2026, 2, 15) }), [], ctx);
    const late = scoreTask(makeTask({ dueDate: storedDate(2026, 2, 10) }), [], ctx);
    expect(late).toBeGreaterThan(today);
    expect(today).toBeGreaterThan(undated);
  });

  it('gives a future due date no credit', () => {
    expect(scoreTask(makeTask({ dueDate: storedDate(2026, 2, 25) }), [], ctx)).toBe(0);
  });

  it('saturates the overdue bonus so ancient tasks cannot crowd the list', () => {
    const twoWeeks = scoreTask(makeTask({ dueDate: storedDate(2026, 2, 1) }), [], ctx);
    const twoYears = scoreTask(makeTask({ dueDate: storedDate(2024, 2, 1) }), [], ctx);
    expect(twoYears).toBe(twoWeeks);
  });

  it('ranks a passed deadline above an approaching one, and that above a distant one', () => {
    const passed = scoreTask(makeTask({ deadline: storedDate(2026, 2, 10) }), [], ctx);
    const soon = scoreTask(makeTask({ deadline: storedDate(2026, 2, 17) }), [], ctx);
    const distant = scoreTask(makeTask({ deadline: storedDate(2026, 5, 1) }), [], ctx);
    expect(passed).toBeGreaterThan(soon);
    expect(soon).toBeGreaterThan(distant);
    expect(distant).toBe(0);
  });

  it('rewards a task matching the current segment and penalises one that does not', () => {
    const morning = makeCtx({ currentSegment: 'morning' });
    const match = scoreTask(makeTask({ timeSegments: ['morning'] }), [], morning);
    const none = scoreTask(makeTask({ timeSegments: [] }), [], morning);
    const mismatch = scoreTask(makeTask({ timeSegments: ['evening'] }), [], morning);
    expect(match).toBeGreaterThan(none);
    expect(none).toBeGreaterThan(mismatch);
  });

  it('adds a batch bonus for a task sharing context with one already listed', () => {
    const listed = [makeTask({ id: 'listed', category: 'Work' })];
    const related = makeTask({ id: 'a', category: 'Work' });
    const unrelated = makeTask({ id: 'b', category: 'Home' });
    expect(scoreTask(related, listed, ctx)).toBeGreaterThan(scoreTask(unrelated, listed, ctx));
  });

  it('counts a shared tag and a shared project as batch context too', () => {
    const listed = [makeTask({ id: 'listed', tags: ['errand'], projectId: 'p1' })];
    const sharedTag = scoreTask(makeTask({ tags: ['errand'] }), listed, ctx);
    const sharedProject = scoreTask(makeTask({ projectId: 'p1' }), listed, ctx);
    expect(sharedTag).toBeGreaterThan(0);
    expect(sharedProject).toBeGreaterThan(0);
  });

  it('takes the best batch match rather than summing over the whole list', () => {
    const one = [makeTask({ id: 'x', category: 'Work' })];
    const two = [makeTask({ id: 'x', category: 'Work' }), makeTask({ id: 'y', category: 'Work' })];
    const task = makeTask({ category: 'Work' });
    expect(scoreTask(task, two, ctx)).toBe(scoreTask(task, one, ctx));
  });

  it('ignores a single co-completion but rewards a repeated one', () => {
    const listed = [makeTask({ id: 'listed', title: 'Dishes' })];
    const task = makeTask({ title: 'Laundry' });
    const once = makeCtx({ coOccurrence: new Map([['dishes ↔ laundry', 1]]) });
    const twice = makeCtx({ coOccurrence: new Map([['dishes ↔ laundry', 2]]) });
    expect(scoreTask(task, listed, once)).toBe(0);
    expect(scoreTask(task, listed, twice)).toBeGreaterThan(0);
  });

  it('penalises a task that would push the list past its time budget', () => {
    const listed = [makeTask({ id: 'big', estimatedMinutes: 110 })];
    const short = makeTask({ estimatedMinutes: 5 });
    const long = makeTask({ estimatedMinutes: 240 });
    expect(scoreTask(long, listed, ctx)).toBeLessThan(scoreTask(short, listed, ctx));
    expect(scoreTask(long, listed, ctx)).toBeLessThan(0);
  });

  it('floors the overflow penalty so a long task is discouraged, not disqualified', () => {
    const listed: Task[] = [];
    const huge = scoreTask(makeTask({ priority: 4, estimatedMinutes: 100_000 }), listed, ctx);
    // Urgent priority (48) still outweighs the capped -30 overflow penalty.
    expect(huge).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// suggestPins
// ---------------------------------------------------------------------------

describe('suggestPins', () => {
  const ctx = makeCtx();

  it('returns nothing when the pinned list is already full', () => {
    const pinned = Array.from({ length: MAX_SUGGESTED_PINS }, (_, i) =>
      makeTask({ id: `p${i}`, pinned: true }));
    expect(suggestPins([makeTask({ id: 'a' })], pinned, ctx)).toEqual([]);
  });

  it('fills the list up to the maximum', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => makeTask({ id: `t${i}`, sortOrder: i }));
    expect(suggestPins(tasks, [], ctx)).toHaveLength(MAX_SUGGESTED_PINS);
  });

  it('tops up a partly-filled list', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => makeTask({ id: `t${i}`, sortOrder: i }));
    expect(suggestPins(tasks, [makeTask({ id: 'p', pinned: true })], ctx))
      .toHaveLength(MAX_SUGGESTED_PINS - 1);
  });

  it('returns every candidate when there are fewer than needed', () => {
    const tasks = [makeTask({ id: 'a', sortOrder: 1 }), makeTask({ id: 'b', sortOrder: 2 })];
    expect(suggestPins(tasks, [], ctx).sort()).toEqual(['a', 'b']);
  });

  it('never suggests an already-pinned task', () => {
    const tasks = [
      makeTask({ id: 'pinned', pinned: true, priority: 4 }),
      makeTask({ id: 'free' }),
    ];
    expect(suggestPins(tasks, [], ctx)).toEqual(['free']);
  });

  it('never suggests a task in an opted-out category', () => {
    const excluded = makeCtx({ excludedCategories: new Set(['Routine']) });
    const tasks = [
      makeTask({ id: 'shower', category: 'Routine', priority: 4 }),
      makeTask({ id: 'teeth', category: 'Routine', priority: 4 }),
      makeTask({ id: 'deck', category: 'Work' }),
    ];
    expect(suggestPins(tasks, [], excluded)).toEqual(['deck']);
  });

  it('leads with the highest-scoring task', () => {
    const tasks = [
      makeTask({ id: 'quiet', sortOrder: 1 }),
      makeTask({ id: 'urgent', sortOrder: 2, priority: 4 }),
      makeTask({ id: 'mild', sortOrder: 3, priority: 1 }),
    ];
    expect(suggestPins(tasks, [], ctx)[0]).toBe('urgent');
  });

  it('re-scores after each pick, so a companion task can outrank a lone one', () => {
    // Without re-scoring this is a flat ranking and 'solo' (priority 3) would
    // beat 'mate' (priority 2). The batch bonus from 'lead' flips it.
    const tasks = [
      makeTask({ id: 'lead', sortOrder: 1, priority: 4, category: 'Work' }),
      makeTask({ id: 'mate', sortOrder: 2, priority: 3, category: 'Work' }),
      makeTask({ id: 'solo', sortOrder: 3, priority: 3, category: 'Home' }),
    ];
    expect(suggestPins(tasks, [], ctx)).toEqual(['lead', 'mate', 'solo']);
  });

  it('batches against what is already pinned, not only against its own picks', () => {
    const pinned = [makeTask({ id: 'p', pinned: true, category: 'Errands' })];
    const tasks = [
      makeTask({ id: 'related', sortOrder: 1, priority: 1, category: 'Errands' }),
      makeTask({ id: 'other', sortOrder: 2, priority: 1, category: 'Desk' }),
    ];
    expect(suggestPins(tasks, pinned, ctx)[0]).toBe('related');
  });

  it('is deterministic — the same board yields the same picks every time', () => {
    const tasks = Array.from({ length: 8 }, (_, i) =>
      makeTask({ id: `t${i}`, sortOrder: i, priority: (i % 4) as Task['priority'] }));
    const first = suggestPins(tasks, [], ctx);
    for (let i = 0; i < 5; i++) {
      expect(suggestPins(tasks, [], ctx)).toEqual(first);
    }
  });

  it('breaks ties by the user’s own ordering', () => {
    const tasks = [
      makeTask({ id: 'third', sortOrder: 30 }),
      makeTask({ id: 'first', sortOrder: 10 }),
      makeTask({ id: 'second', sortOrder: 20 }),
    ];
    expect(suggestPins(tasks, [], ctx)).toEqual(['first', 'second', 'third']);
  });

  it('handles an empty board', () => {
    expect(suggestPins([], [], ctx)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// currentTimeSegment / buildPinContext
// ---------------------------------------------------------------------------

describe('currentTimeSegment', () => {
  it('reads the segment whose threshold has most recently passed', () => {
    expect(currentTimeSegment(new Date(2026, 2, 15, 7, 0))).toBe('morning');
    expect(currentTimeSegment(new Date(2026, 2, 15, 13, 0))).toBe('afternoon');
    expect(currentTimeSegment(new Date(2026, 2, 15, 19, 0))).toBe('evening');
    expect(currentTimeSegment(new Date(2026, 2, 15, 22, 0))).toBe('night');
  });

  it('reads the small hours before the first segment as night', () => {
    expect(currentTimeSegment(new Date(2026, 2, 15, 3, 0))).toBe('night');
  });
});

describe('buildPinContext', () => {
  it('collects the categories opted out of suggested pins', () => {
    (useCategoryStore.getState as jest.Mock).mockReturnValue({
      categories: [
        { name: 'Routine', excludeFromPinSuggestions: true },
        { name: 'Work', excludeFromPinSuggestions: false },
      ],
    });
    const ctx = buildPinContext();
    expect(ctx.excludedCategories.has('Routine')).toBe(true);
    expect(ctx.excludedCategories.has('Work')).toBe(false);
  });

  it('indexes the completed history it is given', () => {
    const base = new Date(2026, 2, 1, 9, 0, 0).getTime();
    const ctx = buildPinContext([
      makeTask({ id: 'a', title: 'Dishes', completed: true, completedAt: new Date(base).toISOString() }),
      makeTask({ id: 'b', title: 'Laundry', completed: true, completedAt: new Date(base + 3600_000).toISOString() }),
    ]);
    expect(ctx.coOccurrence.get('dishes ↔ laundry')).toBe(1);
  });
});
