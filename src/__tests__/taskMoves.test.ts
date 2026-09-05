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
  scheduleMoveUpdates,
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
  followUpTaskEveryN: null,
  followUpTaskTitle: null,
  followUpTaskDraft: null,
  followUpTaskOneAtATime: false,
  followUpTaskTally: 0,
  previousFollowUpTaskTally: 0,
  followUpTaskSourceTitle: null,
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

describe('scheduleMoveUpdates', () => {
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0, 0);
  const anchored = (over: Partial<Task> = {}): Task =>
    task({ dueDate: at(2026, 6, 10).toISOString(), recurrenceType: 'daily', ...over });

  it('clears the schedule for a null date', () => {
    expect(scheduleMoveUpdates(task({ dueDate: at(2026, 6, 10).toISOString() }), null))
      .toEqual({ dueDate: null, deferUntil: null });
  });

  it('reschedules an unanchored task in either direction', () => {
    const plain = task({ dueDate: at(2026, 6, 10).toISOString() });
    for (const dest of [at(2026, 6, 14), at(2026, 6, 6)]) {
      const updates = scheduleMoveUpdates(plain, dest);
      expect(updates.dueDate).toBe(dest.toISOString());
      expect(updates.deferUntil).toBeNull();
      expect(updates).not.toHaveProperty('recurrenceAnchorDate');
    }
  });

  it('pushes an anchored task out by deferring, leaving its grid alone', () => {
    const updates = scheduleMoveUpdates(anchored(), at(2026, 6, 14));
    expect(updates).toEqual({ deferUntil: at(2026, 6, 14).toISOString() });
  });

  it('pulls an anchored task forward by moving the date and keeping an anchor', () => {
    // A defer cannot pull a task in front of its own date, and there is no
    // un-hide to pair with the hide.
    const task = anchored();
    const updates = scheduleMoveUpdates(task, at(2026, 6, 6));
    expect(updates.dueDate).toBe(at(2026, 6, 6).toISOString());
    expect(updates.recurrenceAnchorDate).toBe(task.dueDate);
    expect(updates.deferUntil).toBeNull();
  });

  it('only ever sets the anchor once', () => {
    // Pulling a second time must not re-anchor the grid onto the first pull's
    // day, which would rotate the schedule by the back door.
    const first = at(2026, 6, 10).toISOString();
    const task = anchored({ dueDate: at(2026, 6, 8).toISOString(), recurrenceAnchorDate: first });
    expect(scheduleMoveUpdates(task, at(2026, 6, 6)).recurrenceAnchorDate).toBe(first);
  });

  it('clears a stale defer when the destination is the stored day', () => {
    const task = anchored({ deferUntil: at(2026, 6, 20).toISOString() });
    const updates = scheduleMoveUpdates(task, at(2026, 6, 10));
    expect(updates.deferUntil).toBeNull();
    expect(updates.dueDate).toBe(at(2026, 6, 10).toISOString());
  });
});
