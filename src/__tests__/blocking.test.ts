import { canBlock, blockerOf, isBlocked, wouldCycle, waitingOn, resolverFor, blockerAffinity, sortByBlockerAffinity, canBeBlockerOf, canBeBlockedBy, resolveBlocksEdit, describeBlocks, canWaitOn, personBlockerOf, isWaitingOnPerson } from '../utils/blocking';
import { registerTaskSource, resolveBlocker, waitingCountFor } from '../utils/blockerRegistry';
import type { Person, Task } from '../types';

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
  quotaPeriod: 'day',
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
  reminderOffsetDays: null,
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

describe('canBeBlockerOf', () => {
  const tasks = [
    makeTask({ id: 'a' }),
    makeTask({ id: 'b' }),
    makeTask({ id: 'done', completed: true }),
    makeTask({ id: 'filed', archived: true }),
    makeTask({ id: 'sub', parentId: 'a' }),
  ];
  const resolve = resolverFor(tasks);

  it('offers a live top-level task', () => {
    expect(canBeBlockerOf(makeTask({ id: 'b' }), 'a', resolve)).toBe(true);
  });

  it('refuses the task itself, a done, filed or subtask row', () => {
    expect(canBeBlockerOf(makeTask({ id: 'a' }), 'a', resolve)).toBe(false);
    expect(canBeBlockerOf(makeTask({ id: 'done', completed: true }), 'a', resolve)).toBe(false);
    expect(canBeBlockerOf(makeTask({ id: 'filed', archived: true }), 'a', resolve)).toBe(false);
    expect(canBeBlockerOf(makeTask({ id: 'sub', parentId: 'a' }), 'a', resolve)).toBe(false);
  });

  it('refuses a candidate that would close a loop', () => {
    const loop = resolverFor([makeTask({ id: 'a' }), makeTask({ id: 'b', blockedById: 'a' })]);
    expect(canBeBlockerOf(makeTask({ id: 'b', blockedById: 'a' }), 'a', loop)).toBe(false);
  });

  it('offers anything live to a task that does not exist yet', () => {
    expect(canBeBlockerOf(makeTask({ id: 'b' }), null, resolve)).toBe(true);
  });
});

describe('canBeBlockedBy', () => {
  it('offers a live task with no blocker of its own', () => {
    const resolve = resolverFor([makeTask({ id: 'a' }), makeTask({ id: 'b' })]);
    expect(canBeBlockedBy(makeTask({ id: 'b' }), 'a', resolve)).toBe(true);
  });

  // blockedById is one pointer, so taking a task already waiting on something
  // else would silently drop that relationship.
  it('refuses a task already waiting on a different task', () => {
    const resolve = resolverFor([makeTask({ id: 'a' }), makeTask({ id: 'b', blockedById: 'c' }), makeTask({ id: 'c' })]);
    expect(canBeBlockedBy(makeTask({ id: 'b', blockedById: 'c' }), 'a', resolve)).toBe(false);
  });

  it('still offers a task already waiting on this one', () => {
    const resolve = resolverFor([makeTask({ id: 'a' }), makeTask({ id: 'b', blockedById: 'a' })]);
    expect(canBeBlockedBy(makeTask({ id: 'b', blockedById: 'a' }), 'a', resolve)).toBe(true);
  });

  it('refuses the task this one is itself waiting on, directly or up the chain', () => {
    const resolve = resolverFor([
      makeTask({ id: 'a', blockedById: 'b' }),
      makeTask({ id: 'b', blockedById: 'c' }),
      makeTask({ id: 'c' }),
    ]);
    expect(canBeBlockedBy(makeTask({ id: 'b', blockedById: 'c' }), 'a', resolve)).toBe(false);
    expect(canBeBlockedBy(makeTask({ id: 'c' }), 'a', resolve)).toBe(false);
  });

  it('refuses done, filed and subtask rows', () => {
    const resolve = resolverFor([makeTask({ id: 'a' })]);
    expect(canBeBlockedBy(makeTask({ id: 'done', completed: true }), 'a', resolve)).toBe(false);
    expect(canBeBlockedBy(makeTask({ id: 'filed', archived: true }), 'a', resolve)).toBe(false);
    expect(canBeBlockedBy(makeTask({ id: 'sub', parentId: 'x' }), 'a', resolve)).toBe(false);
  });
});

describe('resolveBlocksEdit', () => {
  it('links what was added and releases what was dropped', () => {
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'keep', blockedById: 'a' }),
      makeTask({ id: 'drop', blockedById: 'a' }),
      makeTask({ id: 'add' }),
    ];
    expect(resolveBlocksEdit('a', ['keep', 'add'], tasks)).toEqual({ link: ['add'], unlink: ['drop'] });
  });

  it('is a no-op when the set is unchanged', () => {
    const tasks = [makeTask({ id: 'a' }), makeTask({ id: 'w', blockedById: 'a' })];
    expect(resolveBlocksEdit('a', ['w'], tasks)).toEqual({ link: [], unlink: [] });
  });

  // The waiter that already happened keeps its record of what held it up.
  it('never releases a completed or archived waiter', () => {
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'done', blockedById: 'a', completed: true }),
      makeTask({ id: 'filed', blockedById: 'a', archived: true }),
    ];
    expect(resolveBlocksEdit('a', [], tasks)).toEqual({ link: [], unlink: [] });
  });

  it('drops an id that is gone, or that the rules refuse', () => {
    const tasks = [
      makeTask({ id: 'a' }),
      makeTask({ id: 'taken', blockedById: 'other' }),
      makeTask({ id: 'other' }),
    ];
    expect(resolveBlocksEdit('a', ['deleted', 'taken'], tasks)).toEqual({ link: [], unlink: [] });
  });

  it('refuses a link that would close a loop', () => {
    const tasks = [makeTask({ id: 'a', blockedById: 'b' }), makeTask({ id: 'b' })];
    expect(resolveBlocksEdit('a', ['b'], tasks)).toEqual({ link: [], unlink: [] });
  });
});

describe('describeBlocks', () => {
  it('names one task and counts the rest', () => {
    expect(describeBlocks([])).toBeUndefined();
    expect(describeBlocks(['Return the router'])).toBe('Return the router');
    expect(describeBlocks(['Return the router', 'Cancel the plan'])).toBe('2 tasks');
  });

  it('names a row that has gone rather than showing a blank', () => {
    expect(describeBlocks([''])).toBe('Task no longer exists');
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


// ─── waiting on a person (#2087) ─────────────────────────────────────────────

const makePerson = (over: Partial<Person> & Pick<Person, 'id' | 'name'>): Person => ({
  nickname: '', notes: '', sortOrder: 1, archived: false, archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  birthdayMonth: null, birthdayDay: null, birthYear: null, birthdayTaskOptOut: false, birthdayGiftTaskOptOut: false,
  phoneNumber: null, email: null, linkUrl: null,
  cadenceDays: 0, nudgeOptIn: false, cadenceSetAt: null, reachOutDeclinedAt: null, reachOutOfferDeclinedAt: null, askAbout: '',
  backfillDismissedFields: [],
  groupId: null,
  ...over,
});

const dustin = makePerson({ id: 'p1', name: 'Dustin' });
const peopleBy = (...people: Person[]) => (id: string) => people.find(p => p.id === id);

describe('canWaitOn', () => {
  it('is true for somebody on file', () => {
    expect(canWaitOn(dustin)).toBe(true);
  });

  // canBlock's shape exactly: a blocker that is gone frees its waiters rather
  // than stranding them invisible with no user action able to recover them.
  it('is false for somebody deleted, so their waiters are freed', () => {
    expect(canWaitOn(undefined)).toBe(false);
  });

  it('is false for somebody archived, which is an explicit "out of my way"', () => {
    expect(canWaitOn(makePerson({ id: 'p2', name: 'Filed', archived: true }))).toBe(false);
  });
});

describe('personBlockerOf / isWaitingOnPerson', () => {
  const resolve = peopleBy(dustin);

  it('resolves the person a task is waiting on', () => {
    const task = makeTask({ waitingOnPersonId: 'p1' });
    expect(personBlockerOf(task, resolve)?.id).toBe('p1');
    expect(isWaitingOnPerson(task, resolve)).toBe(true);
  });

  it('is nothing for a task waiting on nobody', () => {
    expect(personBlockerOf(makeTask(), resolve)).toBeUndefined();
    expect(isWaitingOnPerson(makeTask(), resolve)).toBe(false);
  });

  it('frees a task whose person has been deleted', () => {
    const task = makeTask({ waitingOnPersonId: 'gone' });
    expect(isWaitingOnPerson(task, resolve)).toBe(false);
  });

  it('frees a task whose person has been archived', () => {
    const filed = makePerson({ id: 'p9', name: 'Filed', archived: true });
    expect(isWaitingOnPerson(makeTask({ waitingOnPersonId: 'p9' }), peopleBy(filed))).toBe(false);
  });

  // The two are independent: waiting on Dustin for the photos is not time spent
  // with Dustin, and it must never land in his history.
  it('is unrelated to personIds', () => {
    expect(isWaitingOnPerson(makeTask({ personIds: ['p1'] }), resolve)).toBe(false);
  });
});
