import type { Person, Task } from '../types';

// waitingFollowUpTitle reaches displayTitleFor in visibilityUtils.ts, which
// reaches dateUtils.ts's settings-store read — same stub fuzzySearch.test.ts
// uses to keep expo-sqlite out of this file entirely.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', vacationMode: false }) },
}));
jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ categories: [], getCategoryByName: () => null }) },
}));

import {
  waitingFollowUpTaskId,
  waitingFollowUpTitle,
  waitingFollowUpsHandledRecently,
  wantedWaitingFollowUps,
  staleWaitingFollowUpTasks,
  MAX_WAITING_FOLLOW_UP_TASKS,
  WAITING_FOLLOW_UP_DECLINE_DAYS,
  WAITING_FOLLOW_UP_THRESHOLD_DAYS,
} from '../utils/waitingFollowUpTasks';

const TODAY = new Date(2026, 2, 20, 12);
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 86_400_000);

const person = (o: Partial<Person> = {}): Person => ({
  id: 'p1', name: 'Dustin', nickname: '', notes: '', sortOrder: 1,
  archived: false, archivedAt: null, createdAt: '2026-01-01T00:00:00.000Z',
  birthdayMonth: null, birthdayDay: null, birthYear: null, birthdayTaskOptOut: false, birthdayGiftTaskOptOut: false,
  phoneNumber: null, email: null, linkUrl: null,
  cadenceDays: 0, nudgeOptIn: false, cadenceSetAt: null, reachOutDeclinedAt: null, reachOutOfferDeclinedAt: null, askAbout: '',
  backfillDismissedFields: [], groupId: null, location: null,
  ...o,
});

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 't1', title: 'Get the quote back', notes: '', completed: false, completedAt: null,
  missedAt: null, autoScheduledAt: null, createdAt: '2025-01-01T00:00:00.000Z', seenAt: null,
  dueDate: null, deadline: null, deadlineOffsetDays: null, deadlineMonthDay: null, deferUntil: null,
  timeSegments: [], windowStart: null, windowEnd: null,
  recurrenceType: 'none', recurrenceInterval: 1, recurrenceDays: [], recurrenceMonthDay: null,
  recurrenceWeekOrdinal: null, recurrenceAnchorDay: null, recurrenceAnchorDate: null,
  recurrenceEndDate: null, recurrenceCount: null, recurrenceFromCompletion: false,
  supplyCount: null, supplyUnit: null, supplyRefillCount: null, supplyReorderAt: 1,
  supplyLeadDays: null, supplyDeclinedAtCount: null, supplyGroceryItemId: null,
  targetCount: null, targetUnit: null, allowOvershoot: false,
  quotaIntervalMinutes: null, quotaReminders: false, quotaStartedAt: null, quotaAlwaysVisible: false,
  quotaPeriod: 'day', progressCount: 0,
  rotationEnabled: false,
  rotationItems: [],
  rotationLog: [],
  rotationPeriodStart: null,
  rotationLastDone: {},
  tags: [], category: null, sortOrder: 0, pinned: false, pinnedOrder: 0,
  postponeCount: 0, postponeMuted: false, driftingSince: null,
  priority: 0, effort: 0, estimatedMinutes: null,
  reminderTime: null, reminderKind: 'notification', reminderOffsetDays: null,
  reminderTimeAnchor: 'wallClock', reminderUtcOffsetMinutes: null,
  streakCount: 0, streakDate: null, previousStreakCount: 0, previousStreakDate: null, priorBestStreak: 0,
  polarity: 'positive', slipCount: 0, slipDate: null,
  penaltyMinutes: null, penaltyCutoffTime: null, penaltyFiredAt: null, penaltyCreditedAt: null,
  gatesApps: false, showStreak: false, streakRequiresWindow: false,
  parentId: null, groupId: null, projectId: null,
  chainEnabled: false, chainIndex: 0, chainItems: [], chainStepOnSchedule: false,
  followUpTaskEveryN: null, followUpTaskTitle: null, followUpTaskDraft: null,
  followUpTaskOneAtATime: false, followUpTaskTally: 0, previousFollowUpTaskTally: 0,
  followUpTaskSourceTitle: null,
  vacationPause: false, excludeFromSuggestions: false,
  archived: false, archivedAt: null,
  timerStartedAt: null, actualMinutes: null, timedMinutes: null, timerElapsedSeconds: 0,
  healthMetric: null, healthTarget: null, completionTimerMinutes: null, completionTimerNote: null,
  completionTimerStartedAt: null, logHealthMetric: null, logHealthAmount: null,
  medicationName: null, medicationAmount: null, medicationUnit: null, logMealSlot: null,
  estimateBeforeTiming: null,
  previousOccurrenceId: null, seriesId: null, seriesMonthDays: [], seriesRepeatMonths: 1,
  seriesDefaults: null, linkUrl: null, phoneNumber: null, emailAddress: null, location: null,
  blockedById: null,
  waitingOnPersonId: null, waitingOnPersonSince: null, waitingFollowUpDeclinedAt: null,
  deliverableKind: null, deliverableValue: null, generatedKind: null, generatedSourceId: null,
  deadlineOnCalendar: false, calendarEventId: null, logCompletionToCalendar: false,
  completionCalendarEventId: null, timeBlockEventId: null, pendingImport: null,
  backfillDismissedFields: [], personIds: [],
  ...overrides,
});

const waitingTask = (o: Partial<Task> = {}) => makeTask({
  waitingOnPersonId: 'p1',
  waitingOnPersonSince: daysAgo(WAITING_FOLLOW_UP_THRESHOLD_DAYS).toISOString(),
  ...o,
});

describe('the title', () => {
  it('names the person and the task in one sentence', () => {
    expect(waitingFollowUpTitle(person(), waitingTask())).toBe(
      'Follow up with Dustin about "Get the quote back"'
    );
  });

  it('prefers what you actually call them', () => {
    expect(waitingFollowUpTitle(person({ name: 'Dustin Ridley', nickname: 'Dusty' }), waitingTask()))
      .toBe('Follow up with Dusty about "Get the quote back"');
  });
});

describe('wantedWaitingFollowUps', () => {
  it('is empty for a task not waiting on anybody', () => {
    expect(wantedWaitingFollowUps([makeTask()], [person()], TODAY)).toEqual([]);
  });

  it('is empty while the wait is younger than the threshold', () => {
    const task = waitingTask({ waitingOnPersonSince: daysAgo(WAITING_FOLLOW_UP_THRESHOLD_DAYS - 1).toISOString() });
    expect(wantedWaitingFollowUps([task], [person()], TODAY)).toEqual([]);
  });

  it('wants one once the threshold has passed', () => {
    const task = waitingTask();
    const wants = wantedWaitingFollowUps([task], [person()], TODAY);
    expect(wants).toEqual([{
      taskId: 't1', personId: 'p1',
      title: 'Follow up with Dustin about "Get the quote back"',
      phoneNumber: null,
    }]);
  });

  it('is not fooled by a task with no stamp at all — a legacy wait rather than a fresh one', () => {
    const task = waitingTask({ waitingOnPersonSince: null });
    expect(wantedWaitingFollowUps([task], [person()], TODAY)).toEqual([]);
  });

  it('skips a completed, archived or subtask row', () => {
    expect(wantedWaitingFollowUps([waitingTask({ completed: true })], [person()], TODAY)).toEqual([]);
    expect(wantedWaitingFollowUps([waitingTask({ archived: true })], [person()], TODAY)).toEqual([]);
    expect(wantedWaitingFollowUps([waitingTask({ parentId: 'parent' })], [person()], TODAY)).toEqual([]);
  });

  it('frees the wait once the person is archived or deleted, same as canWaitOn', () => {
    expect(wantedWaitingFollowUps([waitingTask()], [person({ archived: true })], TODAY)).toEqual([]);
    expect(wantedWaitingFollowUps([waitingTask()], [], TODAY)).toEqual([]);
  });

  it('holds off while the nudge was swiped away recently', () => {
    const task = waitingTask({ waitingFollowUpDeclinedAt: daysAgo(3).toISOString() });
    expect(wantedWaitingFollowUps([task], [person()], TODAY)).toEqual([]);
  });

  it('speaks again once the decline has lapsed', () => {
    const task = waitingTask({ waitingFollowUpDeclinedAt: daysAgo(WAITING_FOLLOW_UP_DECLINE_DAYS + 1).toISOString() });
    expect(wantedWaitingFollowUps([task], [person()], TODAY).length).toBe(1);
  });

  it('holds off while a follow-up for this task was handled recently', () => {
    const task = waitingTask();
    const handled = new Set(['t1']);
    expect(wantedWaitingFollowUps([task], [person()], TODAY, handled)).toEqual([]);
  });

  it('caps at the given ceiling, in the tasks\' own order — no ranking by how long each has waited', () => {
    const tasks = [
      waitingTask({ id: 't1', waitingOnPersonSince: daysAgo(30).toISOString() }),
      waitingTask({ id: 't2', waitingOnPersonSince: daysAgo(8).toISOString() }),
      waitingTask({ id: 't3', waitingOnPersonSince: daysAgo(20).toISOString() }),
    ];
    const wants = wantedWaitingFollowUps(tasks, [person()], TODAY, new Set(), 2);
    expect(wants.map(w => w.taskId)).toEqual(['t1', 't2']);
  });

  it('defaults the cap to MAX_WAITING_FOLLOW_UP_TASKS', () => {
    const tasks = Array.from({ length: 5 }, (_, i) => waitingTask({ id: `t${i}` }));
    expect(wantedWaitingFollowUps(tasks, [person()], TODAY).length).toBe(MAX_WAITING_FOLLOW_UP_TASKS);
  });
});

describe('waitingFollowUpsHandledRecently', () => {
  const genTask = (o: Partial<Pick<Task, 'generatedKind' | 'generatedSourceId' | 'completed' | 'completedAt' | 'archived' | 'archivedAt'>> = {}) => ({
    generatedKind: 'waitingFollowUp' as const,
    generatedSourceId: 't1',
    completed: false, completedAt: null, archived: false, archivedAt: null,
    ...o,
  });

  it('holds a completed follow-up\'s source for the decline window', () => {
    const done = waitingFollowUpsHandledRecently([genTask({ completed: true, completedAt: daysAgo(2).toISOString() })], TODAY);
    expect(done.has('t1')).toBe(true);
  });

  it('lapses past the hold window', () => {
    const done = waitingFollowUpsHandledRecently([genTask({ completed: true, completedAt: daysAgo(WAITING_FOLLOW_UP_DECLINE_DAYS + 1).toISOString() })], TODAY);
    expect(done.has('t1')).toBe(false);
  });

  it('counts an archived one too, the app\'s other explicit "dealt with"', () => {
    const done = waitingFollowUpsHandledRecently([genTask({ archived: true, archivedAt: daysAgo(1).toISOString() })], TODAY);
    expect(done.has('t1')).toBe(true);
  });

  it('ignores a task of some other generated kind', () => {
    const done = waitingFollowUpsHandledRecently([genTask({ generatedKind: 'reachOut' as any, completed: true, completedAt: daysAgo(1).toISOString() })], TODAY);
    expect(done.size).toBe(0);
  });
});

describe('waitingFollowUpTaskId', () => {
  it('reads the source id off a waitingFollowUp task', () => {
    const task = makeTask({ generatedKind: 'waitingFollowUp', generatedSourceId: 't1' });
    expect(waitingFollowUpTaskId(task)).toBe('t1');
  });

  it('is null for any other kind', () => {
    const task = makeTask({ generatedKind: 'reachOut', generatedSourceId: 't1' });
    expect(waitingFollowUpTaskId(task)).toBeNull();
  });
});

describe('staleWaitingFollowUpTasks', () => {
  const followUp = (o: Partial<Task> = {}) => makeTask({
    id: 'f1', generatedKind: 'waitingFollowUp', generatedSourceId: 't1',
    ...o,
  });

  it('is stale once the waiting task is released', () => {
    const source = waitingTask({ waitingOnPersonId: null, waitingOnPersonSince: null });
    expect(staleWaitingFollowUpTasks([followUp()], [source], [person()])).toEqual([followUp()]);
  });

  it('is stale once the waiting task is completed, archived or gone', () => {
    expect(staleWaitingFollowUpTasks([followUp()], [waitingTask({ completed: true })], [person()])).toEqual([followUp()]);
    expect(staleWaitingFollowUpTasks([followUp()], [waitingTask({ archived: true })], [person()])).toEqual([followUp()]);
    expect(staleWaitingFollowUpTasks([followUp()], [], [person()])).toEqual([followUp()]);
  });

  it('is stale once the person is archived or deleted', () => {
    expect(staleWaitingFollowUpTasks([followUp()], [waitingTask()], [person({ archived: true })])).toEqual([followUp()]);
    expect(staleWaitingFollowUpTasks([followUp()], [waitingTask()], [])).toEqual([followUp()]);
  });

  it('is not stale while the wait is still live', () => {
    expect(staleWaitingFollowUpTasks([followUp()], [waitingTask()], [person()])).toEqual([]);
  });

  it('leaves a completed or archived follow-up alone, same as every other kind', () => {
    const done = followUp({ completed: true });
    expect(staleWaitingFollowUpTasks([done], [], [person()])).toEqual([]);
  });
});
