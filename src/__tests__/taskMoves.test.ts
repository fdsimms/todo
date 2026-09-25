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
  pullForwardChoice,
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
  recurrenceMonth: null,
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
  rotationEnabled: false,
  rotationItems: [],
  rotationLog: [],
  rotationPeriodStart: null,
  rotationLastDone: {},
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
  penaltyMinutes: null,
  penaltyCutoffTime: null,
  penaltyFiredAt: null,
  penaltyCreditedAt: null,
  gatesApps: false,
  showStreak: false,
  streakRequiresWindow: false,
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null, reminderTracksVisibility: false, reminderTimeAnchor: 'wallClock', reminderUtcOffsetMinutes: null,
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
  healthTarget: null, completionTimerMinutes: null, completionTimerNote: null, completionTimerStartedAt: null, logHealthMetric: null, logHealthAmount: null, medicationName: null, medicationAmount: null, medicationUnit: null, logMealSlot: null, estimateBeforeTiming: null,
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
  waitingOnPersonSince: null,
  waitingFollowUpDeclinedAt: null,
  deliverableKind: null,
  deliverableValue: null,
  generatedKind: null,
  generatedSourceId: null,
  deadlineOnCalendar: false,
  calendarEventId: null,
  logCompletionToCalendar: false,
  completionCalendarEventId: null,
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

  // A notice has no reschedule chip in its own row, so bulk-moving it here
  // would be the two disagreeing about the same task.
  it('blocks a notice outright', () => {
    expect(deloadBlockerFor(task({ generatedKind: 'calendarReview' }))!.blocker).toBe('notice');
    expect(deloadBlockerFor(task({ generatedKind: 'mealPlanNudge' }))!.blocker).toBe('notice');
  });

  it('is not soft — a notice can\'t be opted into moving', () => {
    expect(SOFT_DELOAD_BLOCKERS.has('notice')).toBe(false);
  });

  // weather/health/screenTime/mealSlot(/legacy mealCook) are claims about
  // today specifically; moving the row doesn't move what it's about.
  it('blocks the day-bound generators', () => {
    for (const kind of ['weather', 'health', 'screenTime', 'mealSlot', 'mealCook'] as const) {
      expect(deloadBlockerFor(task({ generatedKind: kind }))!.blocker).toBe('day-bound');
    }
  });

  it('is not soft — a day-bound generated task can\'t be opted into moving', () => {
    expect(SOFT_DELOAD_BLOCKERS.has('day-bound')).toBe(false);
  });

  // moodLog, moodNudge and weekendNudge are day-keyed too, but their specs say
  // rescheduling them is an ordinary thing to want — they stay movable.
  it('leaves the other day-keyed generators movable', () => {
    for (const kind of ['moodLog', 'moodNudge', 'weekendNudge', 'pantryReview'] as const) {
      expect(deloadBlockerFor(task({ generatedKind: kind }))).toBeNull();
    }
  });

  it('yields to nothing else — a day-bound generated task blocks even when pinned would', () => {
    expect(deloadBlockerFor(task({ generatedKind: 'weather', pinned: true }))!.blocker).toBe('day-bound');
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

  it('restarts the schedule from a pulled-forward date when asked to', () => {
    // A plain reschedule: no anchor, so updateTask treats the new date as the
    // schedule and clears any earlier one.
    const updates = scheduleMoveUpdates(anchored(), at(2026, 6, 6), undefined, { restartSchedule: true });
    expect(updates).toEqual({ dueDate: at(2026, 6, 6).toISOString(), deferUntil: null });
  });

  it('ignores restartSchedule for a push and for a series member', () => {
    expect(scheduleMoveUpdates(anchored(), at(2026, 6, 14), undefined, { restartSchedule: true }))
      .toEqual({ deferUntil: at(2026, 6, 14).toISOString() });
    const member = task({ dueDate: at(2026, 6, 10).toISOString(), seriesId: 's1' });
    expect(scheduleMoveUpdates(member, at(2026, 6, 6), undefined, { restartSchedule: true }).recurrenceAnchorDate)
      .toBe(member.dueDate);
  });

  it('clears a stale defer when the destination is the stored day', () => {
    const task = anchored({ deferUntil: at(2026, 6, 20).toISOString() });
    const updates = scheduleMoveUpdates(task, at(2026, 6, 10));
    expect(updates.deferUntil).toBeNull();
    expect(updates.dueDate).toBe(at(2026, 6, 10).toISOString());
  });
});

describe('pullForwardChoice', () => {
  const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0, 0);
  const daily = (over: Partial<Task> = {}): Task =>
    task({ dueDate: at(2026, 6, 10).toISOString(), recurrenceType: 'daily', recurrenceInterval: 1, ...over });
  const dayOf = (d: Date | undefined) => d?.toDateString();

  it('offers both next dates for a daily task pulled onto the day before', () => {
    // Keeping the grid puts the next one the day after tomorrow, which is the
    // surprise this exists to ask about.
    const choice = pullForwardChoice(daily(), at(2026, 6, 9));
    expect(dayOf(choice?.keepNext)).toBe(at(2026, 6, 11).toDateString());
    expect(dayOf(choice?.restartNext)).toBe(at(2026, 6, 10).toDateString());
  });

  it('asks about a weekday rule when the answers differ', () => {
    // Mon and Fri, due Fri Jun 12, pulled to Thu Jun 11.
    const choice = pullForwardChoice(
      daily({ recurrenceType: 'weekly', recurrenceDays: [1, 5], dueDate: at(2026, 6, 12).toISOString() }),
      at(2026, 6, 11),
    );
    expect(dayOf(choice?.keepNext)).toBe(at(2026, 6, 15).toDateString());
    expect(dayOf(choice?.restartNext)).toBe(at(2026, 6, 12).toDateString());
  });

  it('asks nothing when it is not a pull', () => {
    expect(pullForwardChoice(daily(), at(2026, 6, 12))).toBeNull();
    expect(pullForwardChoice(daily(), at(2026, 6, 10))).toBeNull();
    expect(pullForwardChoice(daily(), null)).toBeNull();
  });

  it('asks nothing of a task with no grid to keep', () => {
    expect(pullForwardChoice(task({ dueDate: at(2026, 6, 10).toISOString() }), at(2026, 6, 9))).toBeNull();
    expect(pullForwardChoice(task({ dueDate: at(2026, 6, 10).toISOString(), seriesId: 's1' }), at(2026, 6, 9))).toBeNull();
    expect(pullForwardChoice(daily({ recurrenceFromCompletion: true }), at(2026, 6, 9))).toBeNull();
    expect(pullForwardChoice(daily({ recurrenceType: 'hours' }), at(2026, 6, 9))).toBeNull();
  });

  it('asks nothing when both answers land on the same day', () => {
    // Fridays, but sitting on Wed Jun 10 (off its own grid): pulled to Tue
    // Jun 9, the next one is Fri Jun 12 either way.
    const fridays = daily({ recurrenceType: 'weekly', recurrenceDays: [5] });
    expect(pullForwardChoice(fridays, at(2026, 6, 9))).toBeNull();
  });
});
