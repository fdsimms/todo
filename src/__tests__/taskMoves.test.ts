import type { Task } from '../types';

// taskMoves reaches dateUtils, which reaches the settings store, which reaches
// expo-sqlite. The same stub the other pure tests use — nothing here reads a
// setting.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));

import {
  SOFT_DELOAD_BLOCKERS,
  deloadBlockerFor,
  isDateAnchored,
} from '../utils/taskMoves';

const BASE: Task = {
  id: 'task-1',
  title: 'Test',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
  createdAt: new Date().toISOString(),
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
  sortOrder: 0,
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
  polarity: 'positive',
  slipCount: 0,
  slipDate: null,
  showStreak: false,
  streakRequiresWindow: false,
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null, reminderTimeAnchor: 'wallClock', reminderUtcOffsetMinutes: null,
  parentId: null,
  groupId: null,
  projectId: null,
  category: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskDraft: null,
  extraTaskOneAtATime: false,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
  vacationPause: false, excludeFromSuggestions: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  healthMetric: null,
  healthTarget: null,
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
};

const task = (over: Partial<Task> = {}): Task => ({ ...BASE, ...over });

describe('isDateAnchored', () => {
  it('is true for a recurrence, whose dueDate anchors its whole future grid', () => {
    expect(isDateAnchored(task({ recurrenceType: 'weekly' }))).toBe(true);
  });

  it('is true for a series member, whose date was hand-picked out of a set', () => {
    expect(isDateAnchored(task({ seriesId: 's1' }))).toBe(true);
  });

  it('is false for an ordinary task, which can just be rescheduled', () => {
    expect(isDateAnchored(task())).toBe(false);
  });
});

describe('deloadBlockerFor', () => {
  it('reports nothing for a task with no reason to stay', () => {
    expect(deloadBlockerFor(task())).toBeNull();
  });

  // #2088. Other people are involved, so moving this has a social cost the
  // day-load math can't see.
  it('is reluctant to move a task with somebody on it', () => {
    const found = deloadBlockerFor(task({ personIds: ['p1'] }))!;
    expect(found.blocker).toBe('people');
    expect(found.label).toBe('Someone else is involved');
  });

  // Soft, not hard: the day might genuinely need to get lighter, and refusing
  // outright would be the app deciding you can't reschedule seeing a friend.
  it('leaves it movable rather than refusing outright', () => {
    expect(SOFT_DELOAD_BLOCKERS.has('people')).toBe(true);
  });

  it('says nothing about a task naming nobody', () => {
    expect(deloadBlockerFor(task({ personIds: [] }))).toBeNull();
  });

  // It sits last, so a task that is pinned or urgent still reports the harder
  // reason it cannot move at all.
  it('yields to a hard blocker', () => {
    expect(deloadBlockerFor(task({ personIds: ['p1'], pinned: true }))!.blocker).toBe('pinned');
    expect(deloadBlockerFor(task({ personIds: ['p1'], priority: 4 }))!.blocker).toBe('urgent');
  });

  it('yields to the soft blockers that were already there', () => {
    expect(deloadBlockerFor(task({ personIds: ['p1'], streakCount: 4 }))!.blocker).toBe('streak');
    expect(deloadBlockerFor(task({ personIds: ['p1'], priority: 3 }))!.blocker).toBe('high-priority');
  });

  it('reports the hard blockers it always did', () => {
    expect(deloadBlockerFor(task({ timerStartedAt: new Date().toISOString() }))!.blocker).toBe('running');
    expect(deloadBlockerFor(task({ targetCount: 8 }))!.blocker).toBe('quota');
  });
});
