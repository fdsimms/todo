/**
 * Tests for src/utils/focusSuggest.ts — what a focus session offers to put in
 * front of you.
 *
 * The context is built by hand rather than through buildFocusContext(), which
 * is the point of that split: the weights are testable against a fixed clock
 * with no store standing behind them.
 */

import {
  buildFocusContext,
  fitsWindow,
  focusQueueFromPinned,
  focusReason,
  nextFocusSuggestion,
  scoreFocusTask,
  suggestFocusTasks,
  FOCUS_BUDGET_MINUTES,
  MAX_SUGGESTED_FOCUS,
  type FocusContext,
} from '../utils/focusSuggest';
import type { FocusPlanOptions } from '../utils/focusPlan';
import { resolverFor } from '../utils/blocking';
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
  useSettingsStore: { getState: () => mockSettingsState },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: jest.fn(() => ({ categories: [] })) },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A fixed "now": Sunday 15 March 2026, 09:00 local, which lands in morning.
const TODAY_START = new Date(2026, 2, 15);

/** A stored date the way the app writes them: local noon on the given day. */
const storedDate = (year: number, monthIndex: number, day: number): string =>
  new Date(year, monthIndex, day, 12, 0, 0).toISOString();

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
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
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
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
  emailAddress: null,
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

/** The shipped rest rules: 25 minute cap, 5 minute break every 25 worked. */
const PLAN: FocusPlanOptions = {
  workCapMinutes: 25,
  defaultWorkMinutes: 25,
  restAfterTasks: null,
  restAfterMinutes: 25,
  restMinutes: 5,
  longRestEvery: 4,
  longRestMinutes: 15,
};

/** A context over the given pool, with the clock pinned and no time limit. */
const ctxFor = (
  tasks: Task[],
  over: Partial<Pick<FocusContext, 'currentSegment' | 'windowMinutes' | 'planOptions' | 'excludedCategories'>> = {},
): FocusContext => ({
  todayStart: TODAY_START,
  currentSegment: 'morning',
  resolve: resolverFor(tasks),
  windowMinutes: null,
  planOptions: PLAN,
  excludedCategories: new Set<string>(),
  ...over,
});

// ---------------------------------------------------------------------------

describe('eligibility', () => {
  it('offers a plain open task', () => {
    const pool = [makeTask({ id: 'a' })];
    expect(suggestFocusTasks(pool, ctxFor(pool))).toEqual(['a']);
  });

  it('never offers completed, archived or subtask rows', () => {
    const pool = [
      makeTask({ id: 'done', completed: true }),
      makeTask({ id: 'filed', archived: true }),
      makeTask({ id: 'sub', parentId: 'a' }),
      makeTask({ id: 'a' }),
    ];
    expect(suggestFocusTasks(pool, ctxFor(pool))).toEqual(['a']);
  });

  it('excludes a blocked task outright rather than ranking it low', () => {
    const blocker = makeTask({ id: 'blocker' });
    const blocked = makeTask({ id: 'blocked', blockedById: 'blocker', priority: 4 });
    const pool = [blocker, blocked];
    // 'blocked' is the higher-priority row and still never appears.
    expect(suggestFocusTasks(pool, ctxFor(pool))).toEqual(['blocker']);
  });

  it('offers a task whose blocker is already done', () => {
    const blocker = makeTask({ id: 'blocker', completed: true });
    const blocked = makeTask({ id: 'blocked', blockedById: 'blocker' });
    const pool = [blocker, blocked];
    expect(suggestFocusTasks(pool, ctxFor(pool))).toEqual(['blocked']);
  });

  it('stops at the limit', () => {
    const pool = Array.from({ length: 12 }, (_, i) => makeTask({ id: `t${i}`, sortOrder: i }));
    expect(suggestFocusTasks(pool, ctxFor(pool))).toHaveLength(MAX_SUGGESTED_FOCUS);
  });

  it('takes a smaller limit when asked for one', () => {
    const pool = Array.from({ length: 12 }, (_, i) => makeTask({ id: `t${i}`, sortOrder: i }));
    expect(suggestFocusTasks(pool, ctxFor(pool), 2)).toHaveLength(2);
  });

  it('returns nothing at all when there is nothing eligible', () => {
    const pool = [makeTask({ id: 'a', completed: true })];
    expect(suggestFocusTasks(pool, ctxFor(pool))).toEqual([]);
  });

  it('never offers a task in a category opted out of suggestions', () => {
    const pool = [
      makeTask({ id: 'shower', category: 'Routine', priority: 4 }),
      makeTask({ id: 'teeth', category: 'Routine', priority: 4 }),
      makeTask({ id: 'deck', category: 'Work' }),
    ];
    const ctx = ctxFor(pool, { excludedCategories: new Set(['Routine']) });
    expect(suggestFocusTasks(pool, ctx)).toEqual(['deck']);
  });

  it('never offers a task flagged excludeFromSuggestions, even outside an opted-out category', () => {
    const pool = [
      makeTask({ id: 'quiet-read', category: 'Work', priority: 4, excludeFromSuggestions: true }),
      makeTask({ id: 'deck', category: 'Work' }),
    ];
    expect(suggestFocusTasks(pool, ctxFor(pool))).toEqual(['deck']);
  });
});

describe('scoring', () => {
  it('prefers a task carrying an estimate over an identical one without', () => {
    const estimated = makeTask({ id: 'est', estimatedMinutes: 30 });
    const bare = makeTask({ id: 'bare' });
    const ctx = ctxFor([estimated, bare]);
    expect(scoreFocusTask(estimated, [], ctx)).toBeGreaterThan(scoreFocusTask(bare, [], ctx));
  });

  it('penalises a task too short to be worth a focus block', () => {
    const tiny = makeTask({ id: 'tiny', estimatedMinutes: 2 });
    const bare = makeTask({ id: 'bare' });
    const ctx = ctxFor([tiny, bare]);
    expect(scoreFocusTask(tiny, [], ctx)).toBeLessThan(scoreFocusTask(bare, [], ctx));
  });

  it('picks the substantial task over the two-minute one', () => {
    const pool = [
      makeTask({ id: 'tiny', estimatedMinutes: 2, sortOrder: 1 }),
      makeTask({ id: 'real', estimatedMinutes: 45, sortOrder: 2 }),
    ];
    expect(suggestFocusTasks(pool, ctxFor(pool), 1)).toEqual(['real']);
  });

  it('leads with priority and lateness', () => {
    const pool = [
      makeTask({ id: 'idle', sortOrder: 1 }),
      makeTask({ id: 'urgent', priority: 4, sortOrder: 2 }),
      makeTask({ id: 'late', dueDate: storedDate(2026, 2, 8), sortOrder: 3 }),
    ];
    expect(suggestFocusTasks(pool, ctxFor(pool), 1)).toEqual(['urgent']);
  });

  it('credits a task set for the segment in progress and debits one set for another', () => {
    const now = makeTask({ id: 'now', timeSegments: ['morning'] });
    const later = makeTask({ id: 'later', timeSegments: ['evening'] });
    const ctx = ctxFor([now, later]);
    expect(scoreFocusTask(now, [], ctx)).toBeGreaterThan(scoreFocusTask(later, [], ctx));
  });

  it('pulls in a task that shares a category with what is already queued', () => {
    const first = makeTask({ id: 'first', category: 'Work', priority: 4, sortOrder: 1 });
    const mate = makeTask({ id: 'mate', category: 'Work', sortOrder: 2 });
    const stranger = makeTask({ id: 'stranger', category: 'Home', sortOrder: 3 });
    const pool = [first, mate, stranger];
    expect(suggestFocusTasks(pool, ctxFor(pool), 2)).toEqual(['first', 'mate']);
  });

  it('scores a shared project and a shared tag the same way', () => {
    const listed = makeTask({ id: 'listed', projectId: 'p1', tags: ['deep'] });
    const sameProject = makeTask({ id: 'proj', projectId: 'p1' });
    const sameTag = makeTask({ id: 'tag', tags: ['deep'] });
    const neither = makeTask({ id: 'none' });
    const ctx = ctxFor([listed, sameProject, sameTag, neither]);
    expect(scoreFocusTask(sameProject, [listed], ctx)).toBeGreaterThan(scoreFocusTask(neither, [listed], ctx));
    expect(scoreFocusTask(sameTag, [listed], ctx)).toBeGreaterThan(scoreFocusTask(neither, [listed], ctx));
  });

  it('costs points to run the queue past its time budget', () => {
    const candidate = makeTask({ id: 'c', estimatedMinutes: 60 });
    const big = makeTask({ id: 'big', estimatedMinutes: FOCUS_BUDGET_MINUTES });
    const ctx = ctxFor([candidate, big]);
    expect(scoreFocusTask(candidate, [big], ctx)).toBeLessThan(scoreFocusTask(candidate, [], ctx));
  });

  it('resolves a tie by the user’s own ordering, so the same board gives the same queue', () => {
    const pool = [
      makeTask({ id: 'second', sortOrder: 2 }),
      makeTask({ id: 'first', sortOrder: 1 }),
    ];
    expect(suggestFocusTasks(pool, ctxFor(pool))).toEqual(['first', 'second']);
    expect(suggestFocusTasks(pool, ctxFor(pool))).toEqual(['first', 'second']);
  });
});

describe('the time window', () => {
  it('measures fit against the plan, breaks included, not against the estimates', () => {
    // 50 minutes of estimates, but the 25-minute rest trigger fires after the
    // first task, so the run is 55 minutes of wall clock.
    const tasks = [makeTask({ id: 'a', estimatedMinutes: 25 }), makeTask({ id: 'b', estimatedMinutes: 25 })];
    expect(fitsWindow([tasks[0]], tasks[1], ctxFor(tasks, { windowMinutes: 50 }))).toBe(false);
    expect(fitsWindow([tasks[0]], tasks[1], ctxFor(tasks, { windowMinutes: 55 }))).toBe(true);
  });

  it('always fits when no window is set', () => {
    const huge = makeTask({ id: 'huge', estimatedMinutes: 600 });
    expect(fitsWindow([], huge, ctxFor([huge]))).toBe(true);
  });

  it('keeps the queue inside the window', () => {
    const pool = Array.from({ length: 6 }, (_, i) =>
      makeTask({ id: `t${i}`, estimatedMinutes: 20, sortOrder: i })
    );
    const ctx = ctxFor(pool, { windowMinutes: 60 });
    const picked = suggestFocusTasks(pool, ctx);
    const queue = picked.map(id => pool.find(t => t.id === id)!);

    expect(picked.length).toBeGreaterThan(0);
    expect(fitsWindow(queue, null, ctx)).toBe(true);
    // Without the window the same pool fills the whole shortlist.
    expect(suggestFocusTasks(pool, ctxFor(pool))).toHaveLength(MAX_SUGGESTED_FOCUS);
  });

  it('takes the best candidate that fits rather than stopping at one that does not', () => {
    // The urgent task is far too big for the window; the queue should be the
    // small ones rather than empty.
    const pool = [
      makeTask({ id: 'big', estimatedMinutes: 120, priority: 4, sortOrder: 1 }),
      makeTask({ id: 'small1', estimatedMinutes: 10, sortOrder: 2 }),
      makeTask({ id: 'small2', estimatedMinutes: 10, sortOrder: 3 }),
    ];
    expect(suggestFocusTasks(pool, ctxFor(pool, { windowMinutes: 30 }))).toEqual(['small1', 'small2']);
  });

  it('offers nothing when even the smallest task overruns the window', () => {
    const pool = [makeTask({ id: 'a', estimatedMinutes: 60 })];
    expect(suggestFocusTasks(pool, ctxFor(pool, { windowMinutes: 30 }))).toEqual([]);
  });

  it('charges an unestimated task the default stretch, so it can overrun a window too', () => {
    // No estimate, so the plan gives it defaultWorkMinutes (25).
    const pool = [makeTask({ id: 'bare' })];
    expect(suggestFocusTasks(pool, ctxFor(pool, { windowMinutes: 15 }))).toEqual([]);
    expect(suggestFocusTasks(pool, ctxFor(pool, { windowMinutes: 30 }))).toEqual(['bare']);
  });

  it('drops the soft budget penalty once a hard window is doing the work', () => {
    const candidate = makeTask({ id: 'c', estimatedMinutes: 20 });
    const big = makeTask({ id: 'big', estimatedMinutes: FOCUS_BUDGET_MINUTES });
    const pool = [candidate, big];
    const windowed = ctxFor(pool, { windowMinutes: 480 });
    expect(scoreFocusTask(candidate, [big], windowed)).toBe(scoreFocusTask(candidate, [], windowed));
    // …and still applies it when there is no window.
    const open = ctxFor(pool);
    expect(scoreFocusTask(candidate, [big], open)).toBeLessThan(scoreFocusTask(candidate, [], open));
  });

  it('will not offer a swap that would not fit', () => {
    const kept = makeTask({ id: 'kept', estimatedMinutes: 20, sortOrder: 1 });
    const big = makeTask({ id: 'big', estimatedMinutes: 90, sortOrder: 2 });
    const pool = [kept, big];
    expect(nextFocusSuggestion(pool, [kept], ['kept'], ctxFor(pool, { windowMinutes: 30 }))).toBeNull();
  });
});

describe('nextFocusSuggestion', () => {
  it('skips everything excluded and offers the next best', () => {
    const pool = [
      makeTask({ id: 'a', priority: 4, sortOrder: 1 }),
      makeTask({ id: 'b', priority: 3, sortOrder: 2 }),
      makeTask({ id: 'c', priority: 2, sortOrder: 3 }),
    ];
    expect(nextFocusSuggestion(pool, [], ['a'], ctxFor(pool))).toBe('b');
  });

  it('returns null once the pool is exhausted', () => {
    const pool = [makeTask({ id: 'a' })];
    expect(nextFocusSuggestion(pool, [], ['a'], ctxFor(pool))).toBeNull();
  });

  it('scores a replacement against the rows being kept, not the rejected one', () => {
    const kept = makeTask({ id: 'kept', category: 'Work', sortOrder: 1 });
    const mate = makeTask({ id: 'mate', category: 'Work', sortOrder: 3 });
    const stranger = makeTask({ id: 'stranger', category: 'Home', sortOrder: 2 });
    const pool = [kept, stranger, mate];
    expect(nextFocusSuggestion(pool, [kept], ['kept', 'rejected'], ctxFor(pool))).toBe('mate');
  });
});

describe('focusQueueFromPinned', () => {
  it('keeps the given order rather than scoring for one', () => {
    // Priority would rank these the other way around; the pinned order wins.
    const low = makeTask({ id: 'low', priority: 1, sortOrder: 2 });
    const urgent = makeTask({ id: 'urgent', priority: 4, sortOrder: 1 });
    const pinned = [low, urgent];
    expect(focusQueueFromPinned(pinned, ctxFor(pinned))).toEqual(['low', 'urgent']);
  });

  it('drops a completed, archived, or subtask entry', () => {
    const done = makeTask({ id: 'done', completed: true });
    const archived = makeTask({ id: 'archived', archived: true });
    const subtask = makeTask({ id: 'subtask', parentId: 'parent' });
    const open = makeTask({ id: 'open' });
    const pinned = [done, archived, subtask, open];
    expect(focusQueueFromPinned(pinned, ctxFor(pinned))).toEqual(['open']);
  });

  it('drops a pinned task that is blocked', () => {
    const blocker = makeTask({ id: 'blocker' });
    const blocked = makeTask({ id: 'blocked', blockedById: 'blocker' });
    const pinned = [blocked, blocker];
    expect(focusQueueFromPinned(pinned, ctxFor(pinned))).toEqual(['blocker']);
  });

  it('skips a pinned task that would not fit, without ending the queue', () => {
    const big = makeTask({ id: 'big', estimatedMinutes: 90, sortOrder: 1 });
    const small = makeTask({ id: 'small', estimatedMinutes: 10, sortOrder: 2 });
    const pinned = [big, small];
    expect(focusQueueFromPinned(pinned, ctxFor(pinned, { windowMinutes: 30 }))).toEqual(['small']);
  });

  it('returns nothing for an empty or fully-ineligible list', () => {
    expect(focusQueueFromPinned([], ctxFor([]))).toEqual([]);
    const done = makeTask({ id: 'done', completed: true });
    expect(focusQueueFromPinned([done], ctxFor([done]))).toEqual([]);
  });
});

describe('focusReason', () => {
  it('names the loudest term', () => {
    const ctx = ctxFor([]);
    expect(focusReason(makeTask({ priority: 4 }), [], ctx)).toBe('Urgent priority');
    expect(focusReason(makeTask({ dueDate: storedDate(2026, 2, 15) }), [], ctx)).toBe('Due today');
    expect(focusReason(makeTask({ dueDate: storedDate(2026, 2, 12) }), [], ctx)).toBe('Waiting 3 days');
  });

  it('leaves the estimate to the duration the row prints beside it', () => {
    expect(focusReason(makeTask({ estimatedMinutes: 45 }), [], ctxFor([]))).toBeNull();
    expect(focusReason(makeTask({ estimatedMinutes: 3 }), [], ctxFor([]))).toBeNull();
  });

  it('still names a louder term on a task that also has an estimate', () => {
    const task = makeTask({ estimatedMinutes: 45, priority: 4 });
    expect(focusReason(task, [], ctxFor([]))).toBe('Urgent priority');
  });

  it('names the task a suggestion goes with', () => {
    const listed = makeTask({ id: 'listed', title: 'Draft the memo', category: 'Work' });
    const mate = makeTask({ id: 'mate', category: 'Work' });
    expect(focusReason(mate, [listed], ctxFor([]))).toBe('Goes with Draft the memo');
  });

  it('says nothing when there is nothing to say', () => {
    expect(focusReason(makeTask(), [], ctxFor([]))).toBeNull();
  });
});

describe('buildFocusContext', () => {
  it('resolves blockers that are not themselves candidates', () => {
    const blocker = makeTask({ id: 'blocker' });
    const blocked = makeTask({ id: 'blocked', blockedById: 'blocker' });
    // The blocker is off today, so it is in allTasks but not in the pool.
    const ctx = buildFocusContext([blocker, blocked], { windowMinutes: null, planOptions: PLAN });
    // Handed only the candidate, the scorer still sees it as blocked.
    expect(suggestFocusTasks([blocked], ctx)).toEqual([]);
    expect(suggestFocusTasks([blocker], ctx)).toEqual(['blocker']);
  });

  it('collects the categories opted out of suggestions', () => {
    (useCategoryStore.getState as jest.Mock).mockReturnValue({
      categories: [
        { name: 'Routine', excludeFromSuggestions: true },
        { name: 'Work', excludeFromSuggestions: false },
      ],
    });
    const ctx = buildFocusContext([], { windowMinutes: null, planOptions: PLAN });
    expect(ctx.excludedCategories.has('Routine')).toBe(true);
    expect(ctx.excludedCategories.has('Work')).toBe(false);
  });
});
