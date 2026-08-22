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
  focusReason,
  nextFocusSuggestion,
  scoreFocusTask,
  suggestFocusTasks,
  FOCUS_BUDGET_MINUTES,
  MAX_SUGGESTED_FOCUS,
  type FocusContext,
} from '../utils/focusSuggest';
import { resolverFor } from '../utils/blocking';
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
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskDraft: null,
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
  timeBlockEventId: null,
  pendingImport: null,
  ...overrides,
});

/** A context over the given pool, with the clock pinned. */
const ctxFor = (tasks: Task[], segment: FocusContext['currentSegment'] = 'morning'): FocusContext => ({
  todayStart: TODAY_START,
  currentSegment: segment,
  resolve: resolverFor(tasks),
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

describe('focusReason', () => {
  it('names the loudest term', () => {
    const ctx = ctxFor([]);
    expect(focusReason(makeTask({ priority: 4 }), [], ctx)).toBe('Urgent priority');
    expect(focusReason(makeTask({ dueDate: storedDate(2026, 2, 15) }), [], ctx)).toBe('Due today');
    expect(focusReason(makeTask({ dueDate: storedDate(2026, 2, 12) }), [], ctx)).toBe('Waiting 3 days');
  });

  it('names the estimate, which is the term specific to focusing', () => {
    expect(focusReason(makeTask({ estimatedMinutes: 45 }), [], ctxFor([]))).toBe('Estimated 45m');
  });

  it('keeps quiet about an estimate too short to justify a block', () => {
    expect(focusReason(makeTask({ estimatedMinutes: 3 }), [], ctxFor([]))).toBeNull();
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
    const ctx = buildFocusContext([blocker, blocked]);
    // Handed only the candidate, the scorer still sees it as blocked.
    expect(suggestFocusTasks([blocked], ctx)).toEqual([]);
    expect(suggestFocusTasks([blocker], ctx)).toEqual(['blocker']);
  });
});
