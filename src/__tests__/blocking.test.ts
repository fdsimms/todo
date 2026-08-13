import { canBlock, blockerOf, isBlocked, wouldCycle, waitingOn, resolverFor, blockerAffinity, sortByBlockerAffinity } from '../utils/blocking';
import { registerTaskSource, resolveBlocker, waitingCountFor } from '../utils/blockerRegistry';
import type { Task } from '../types';

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: '1',
  title: 'Task',
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
  category: null,
  sortOrder: 0,
  pinned: false,
  pinnedOrder: 0,
  postponeCount: 0,
  postponeMuted: false,
  driftingSince: null,
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
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
  vacationPause: false,
  archived: false,
  archivedAt: null,
  timerStartedAt: null,
  actualMinutes: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  previousOccurrenceId: null,
  seriesId: null,
  seriesMonthDays: [],
  seriesRepeatMonths: 1,
  seriesDefaults: null,
  linkUrl: null,
  phoneNumber: null,
  emailAddress: null,
  blockedById: null,
  deliverableKind: null,
  deliverableValue: null,
  mealEntryId: null,
  groceryItemId: null,
  leftoverId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  pendingImport: null,
  ...overrides,
});

describe('canBlock', () => {
  it('is true for a live task', () => {
    expect(canBlock(makeTask())).toBe(true);
  });

  it('is false for a completed task — the ordinary way a waiter is freed', () => {
    expect(canBlock(makeTask({ completed: true }))).toBe(false);
  });

  it('is false for an archived task, so archiving a blocker frees its waiters', () => {
    expect(canBlock(makeTask({ archived: true }))).toBe(false);
  });

  it('is false for a missing row, so deleting a blocker cannot strand a waiter', () => {
    expect(canBlock(undefined)).toBe(false);
  });
});

describe('isBlocked / blockerOf', () => {
  const blocker = makeTask({ id: 'b', title: 'Cancel the internet plan' });
  const waiter = makeTask({ id: 'w', title: 'Return the router', blockedById: 'b' });

  it('is false for a task waiting on nothing', () => {
    expect(isBlocked(makeTask(), resolverFor([]))).toBe(false);
  });

  it('is true while the blocker is live', () => {
    expect(isBlocked(waiter, resolverFor([blocker, waiter]))).toBe(true);
    expect(blockerOf(waiter, resolverFor([blocker, waiter]))?.title).toBe('Cancel the internet plan');
  });

  it('is false once the blocker is completed', () => {
    const done = { ...blocker, completed: true };
    expect(isBlocked(waiter, resolverFor([done, waiter]))).toBe(false);
    expect(blockerOf(waiter, resolverFor([done, waiter]))).toBeUndefined();
  });

  it('is false when the blocker no longer exists', () => {
    expect(isBlocked(waiter, resolverFor([waiter]))).toBe(false);
  });
});

describe('wouldCycle', () => {
  it('catches a task pointed at itself', () => {
    const a = makeTask({ id: 'a' });
    expect(wouldCycle('a', 'a', resolverFor([a]))).toBe(true);
  });

  it('catches a direct A→B→A loop', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b', blockedById: 'a' });
    // Pointing a at b would close the loop, since b already waits on a.
    expect(wouldCycle('a', 'b', resolverFor([a, b]))).toBe(true);
  });

  it('catches a transitive A→B→C→A loop', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b', blockedById: 'a' });
    const c = makeTask({ id: 'c', blockedById: 'b' });
    expect(wouldCycle('a', 'c', resolverFor([a, b, c]))).toBe(true);
  });

  it('allows a chain that does not loop back', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const c = makeTask({ id: 'c', blockedById: 'b' });
    expect(wouldCycle('a', 'c', resolverFor([a, b, c]))).toBe(false);
  });

  it('allows pointing at a task that waits on nothing', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    expect(wouldCycle('a', 'b', resolverFor([a, b]))).toBe(false);
  });

  it('terminates on a pre-existing loop that does not involve the edited task', () => {
    // b and c already point at each other — the visited set has to stop the
    // walk rather than spin, because this runs during render.
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b', blockedById: 'c' });
    const c = makeTask({ id: 'c', blockedById: 'b' });
    expect(wouldCycle('a', 'b', resolverFor([a, b, c]))).toBe(false);
  });

  it('tolerates a dangling blockedById mid-chain', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b', blockedById: 'deleted' });
    expect(wouldCycle('a', 'b', resolverFor([a, b]))).toBe(false);
  });
});

describe('waitingOn', () => {
  it('finds the live tasks queued behind a blocker', () => {
    const tasks = [
      makeTask({ id: 'b' }),
      makeTask({ id: 'w1', blockedById: 'b' }),
      makeTask({ id: 'w2', blockedById: 'b' }),
      makeTask({ id: 'other', blockedById: 'z' }),
    ];
    expect(waitingOn('b', tasks).map(t => t.id)).toEqual(['w1', 'w2']);
  });

  it('excludes completed, archived and subtask waiters', () => {
    const tasks = [
      makeTask({ id: 'b' }),
      makeTask({ id: 'done', blockedById: 'b', completed: true }),
      makeTask({ id: 'filed', blockedById: 'b', archived: true }),
      makeTask({ id: 'sub', blockedById: 'b', parentId: 'x' }),
      makeTask({ id: 'live', blockedById: 'b' }),
    ];
    expect(waitingOn('b', tasks).map(t => t.id)).toEqual(['live']);
  });

  it('is empty for a task nothing waits on', () => {
    expect(waitingOn('b', [makeTask({ id: 'b' })])).toEqual([]);
  });
});

describe('blockerRegistry', () => {
  afterEach(() => registerTaskSource(null));

  it('resolves nothing until a source is registered', () => {
    registerTaskSource(null);
    expect(resolveBlocker('anything')).toBeUndefined();
    expect(waitingCountFor('anything')).toBe(0);
  });

  it('counts only the live waiters of each blocker', () => {
    registerTaskSource(() => [
      makeTask({ id: 'b' }),
      makeTask({ id: 'w1', blockedById: 'b' }),
      makeTask({ id: 'w2', blockedById: 'b' }),
      makeTask({ id: 'done', blockedById: 'b', completed: true }),
      makeTask({ id: 'filed', blockedById: 'b', archived: true }),
      makeTask({ id: 'sub', blockedById: 'b', parentId: 'x' }),
    ]);
    expect(waitingCountFor('b')).toBe(2);
    expect(waitingCountFor('nobody')).toBe(0);
  });

  // The memo is keyed on the array's identity, which is sound only because the
  // store always replaces `tasks` rather than mutating it.
  it('picks up a new task array', () => {
    let tasks = [makeTask({ id: 'b' }), makeTask({ id: 'w1', blockedById: 'b' })];
    registerTaskSource(() => tasks);
    expect(waitingCountFor('b')).toBe(1);
    expect(resolveBlocker('b')?.id).toBe('b');

    tasks = [...tasks, makeTask({ id: 'w2', blockedById: 'b' })];
    expect(waitingCountFor('b')).toBe(2);

    tasks = tasks.filter(t => t.id !== 'b');
    expect(resolveBlocker('b')).toBeUndefined();
  });
});

describe('sortByBlockerAffinity', () => {
  const ctx = { groupId: 'g1', projectId: 'p1', category: 'Home' };
  const ids = (tasks: Task[]) => tasks.map(t => t.id);

  it('floats stack, then project, then category above the rest', () => {
    const tasks = [
      makeTask({ id: 'loose' }),
      makeTask({ id: 'category', category: 'Home' }),
      makeTask({ id: 'project', projectId: 'p1' }),
      makeTask({ id: 'stack', groupId: 'g1' }),
    ];
    expect(ids(sortByBlockerAffinity(tasks, ctx))).toEqual(['stack', 'project', 'category', 'loose']);
  });

  it('ranks by the nearest relationship a task has', () => {
    const tasks = [
      makeTask({ id: 'category-only', category: 'Home' }),
      // Shares all three, so it ranks by the stack and lands first.
      makeTask({ id: 'all-three', groupId: 'g1', projectId: 'p1', category: 'Home' }),
    ];
    expect(ids(sortByBlockerAffinity(tasks, ctx))).toEqual(['all-three', 'category-only']);
  });

  it('keeps the incoming order within a tier', () => {
    const tasks = [
      makeTask({ id: 'b', groupId: 'g1' }),
      makeTask({ id: 'a', groupId: 'g1' }),
      makeTask({ id: 'd' }),
      makeTask({ id: 'c' }),
    ];
    expect(ids(sortByBlockerAffinity(tasks, ctx))).toEqual(['b', 'a', 'd', 'c']);
  });

  // "Neither of us is in a project" is not a relationship — a null side must
  // never pull the whole ungrouped tail up to the top.
  it('does not match a null context field against a null task field', () => {
    const tasks = [makeTask({ id: 'none' }), makeTask({ id: 'stack', groupId: 'g1' })];
    const nullish = { groupId: null, projectId: null, category: null };
    expect(ids(sortByBlockerAffinity(tasks, nullish))).toEqual(['none', 'stack']);
    expect(blockerAffinity(tasks[0], nullish)).toBe(3);
  });

  it('leaves the order alone with no context at all', () => {
    const tasks = [makeTask({ id: 'x', groupId: 'g1' }), makeTask({ id: 'y', projectId: 'p1' })];
    expect(ids(sortByBlockerAffinity(tasks, {}))).toEqual(['x', 'y']);
  });
});
