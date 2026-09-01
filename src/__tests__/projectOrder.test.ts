import { liveProjectSteps, slotUpdates } from '../utils/projectOrder';
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

/** Three steps of p1, deliberately out of array order. */
const steps = () => [
  makeTask({ id: 'c', projectId: 'p1', sortOrder: 30 }),
  makeTask({ id: 'a', projectId: 'p1', sortOrder: 10 }),
  makeTask({ id: 'b', projectId: 'p1', sortOrder: 20 }),
];

describe('liveProjectSteps', () => {
  it('returns the project members in sortOrder', () => {
    expect(liveProjectSteps('p1', steps()).map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('leaves out other projects, subtasks, completions and archived rows', () => {
    const tasks = [
      ...steps(),
      makeTask({ id: 'other', projectId: 'p2', sortOrder: 1 }),
      makeTask({ id: 'loose', sortOrder: 1 }),
      makeTask({ id: 'sub', projectId: 'p1', parentId: 'a', sortOrder: 1 }),
      makeTask({ id: 'done', projectId: 'p1', completed: true, sortOrder: 2 }),
      makeTask({ id: 'filed', projectId: 'p1', archived: true, sortOrder: 3 }),
    ];
    expect(liveProjectSteps('p1', tasks).map(t => t.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('slotUpdates', () => {
  it('lays the new order into the slots the members already held', () => {
    // 10/20/30 stay 10/20/30 — only who sits in each changes.
    expect(slotUpdates(liveProjectSteps('p1', steps()), ['c', 'a', 'b'])).toEqual([
      { id: 'c', sortOrder: 10 },
      { id: 'a', sortOrder: 20 },
      { id: 'b', sortOrder: 30 },
    ]);
  });

  it('writes nothing when the order is unchanged', () => {
    expect(slotUpdates(liveProjectSteps('p1', steps()), ['a', 'b', 'c'])).toEqual([]);
  });

  it('never renumbers to 1..N — a project keeps its place in the global order', () => {
    const members = [
      makeTask({ id: 'a', projectId: 'p1', sortOrder: 400 }),
      makeTask({ id: 'b', projectId: 'p1', sortOrder: 900 }),
    ];
    expect(slotUpdates(members, ['b', 'a'])).toEqual([
      { id: 'b', sortOrder: 400 },
      { id: 'a', sortOrder: 900 },
    ]);
  });

  it('spreads out duplicate slots so a drag has something to persist', () => {
    const members = [
      makeTask({ id: 'a', projectId: 'p1', sortOrder: 5 }),
      makeTask({ id: 'b', projectId: 'p1', sortOrder: 5 }),
      makeTask({ id: 'c', projectId: 'p1', sortOrder: 5 }),
    ];
    expect(slotUpdates(members, ['c', 'b', 'a'])).toEqual([
      { id: 'b', sortOrder: 6 },
      { id: 'a', sortOrder: 7 },
    ]);
  });

  it('ignores ids that are not members, and leaves out members nobody named', () => {
    expect(slotUpdates(liveProjectSteps('p1', steps()), ['c', 'ghost', 'a'])).toEqual([
      { id: 'c', sortOrder: 10 },
      { id: 'a', sortOrder: 30 },
    ]);
  });

  it('is a no-op for an empty order', () => {
    expect(slotUpdates(liveProjectSteps('p1', steps()), [])).toEqual([]);
  });
});
