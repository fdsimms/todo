import { bulkDeletePrompt } from '../utils/bulkDelete';
import type { Task } from '../types';

// Same two stubs bulkCompletion.test.ts uses: isLiveRecurring reaches
// visibilityUtils, which reaches the settings and category stores and, through
// them, expo-sqlite.
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      dayResetTime: '00:00',
      morningStart: '06:00',
      afternoonStart: '12:00',
      eveningStart: '18:00',
      nightStart: '21:00',
      activeHoursStart: '08:00',
      activeHoursEnd: '22:00',
      vacationMode: false,
    }),
  },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: {
    getState: jest.fn(() => ({
      categories: [],
      getCategoryByName: jest.fn().mockReturnValue(null),
    })),
  },
}));

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 't1', title: 'Task', notes: '', completed: false, completedAt: null, missedAt: null,
  autoScheduledAt: null,
  createdAt: new Date().toISOString(), seenAt: null, dueDate: null, deadline: null,
  deadlineOffsetDays: null, deadlineMonthDay: null, deferUntil: null,
  timeSegments: [], windowStart: null, windowEnd: null, personIds: [],
  recurrenceType: 'none', recurrenceInterval: 1, recurrenceDays: [],
  recurrenceMonthDay: null, recurrenceMonth: null, recurrenceWeekOrdinal: null, recurrenceAnchorDay: null, recurrenceAnchorDate: null, recurrenceEndDate: null,
  recurrenceCount: null, recurrenceFromCompletion: false,
  targetCount: null, progressCount: 0, targetUnit: null, allowOvershoot: false,
  supplyCount: null, supplyUnit: null, supplyRefillCount: null, supplyReorderAt: 1,
  supplyLeadDays: null, supplyDeclinedAtCount: null, supplyGroceryItemId: null,
  tags: [], category: null, sortOrder: 0, pinned: false, pinnedOrder: 0, priority: 0, effort: 0,
  estimatedMinutes: null, reminderTime: null, reminderKind: 'notification', reminderOffsetDays: null, reminderTracksVisibility: false, reminderTimeAnchor: 'wallClock', reminderUtcOffsetMinutes: null, linkUrl: null,
  phoneNumber: null, emailAddress: null, location: null, blockedById: null, waitingOnPersonId: null, waitingOnPersonSince: null, waitingFollowUpDeclinedAt: null,
  deliverableKind: null, deliverableValue: null, generatedKind: null, generatedSourceId: null,
  deadlineOnCalendar: false, calendarEventId: null,
  logCompletionToCalendar: false, completionCalendarEventId: null, timeBlockEventId: null,
  pendingImport: null, backfillDismissedFields: [],
  streakCount: 0, streakDate: null, previousStreakCount: 0, previousStreakDate: null, priorBestStreak: 0,
  polarity: 'positive',
  slipCount: 0,
  slipDate: null,
  penaltyMinutes: null,
  penaltyCutoffTime: null,
  penaltyFiredAt: null,
  penaltyCreditedAt: null,
  gatesApps: false,
  showStreak: false, streakRequiresWindow: false,
  parentId: null, groupId: null, projectId: null,
  chainEnabled: false, chainIndex: 0, chainItems: [], chainStepOnSchedule: false, vacationPause: false, excludeFromSuggestions: false,
  followUpTaskEveryN: null, followUpTaskTitle: null, followUpTaskDraft: null,
  followUpTaskOneAtATime: false, followUpTaskAtEnd: false, followUpTaskTally: 0, previousFollowUpTaskTally: 0,
  followUpTaskSourceTitle: null,
  followUpTaskSourceId: null,
  archived: false, archivedAt: null, timerStartedAt: null, actualMinutes: null,
  timedMinutes: null, timerElapsedSeconds: 0,
  healthMetric: null,
  healthTarget: null, healthFollowGoal: false, completionTimerMinutes: null, completionTimerNote: null, completionTimerStartedAt: null, logHealthMetric: null, logHealthAmount: null, medicationName: null, medicationAmount: null, medicationUnit: null, logMealSlot: null, estimateBeforeTiming: null,
  previousOccurrenceId: null,
  seriesId: null, seriesMonthDays: [], seriesRepeatMonths: 1, seriesDefaults: null,
  postponeCount: 0, postponeMuted: false, driftingSince: null,
  quotaIntervalMinutes: null, quotaReminders: false, quotaStartedAt: null, quotaAlwaysVisible: false, followWaterTarget: false,
  quotaPeriod: 'day',
  rotationEnabled: false,
  rotationItems: [],
  rotationLog: [],
  rotationPeriodStart: null,
  rotationLastDone: {}, rotationPlan: null,
  ...overrides,
});

// Local constructions, never a `Z` literal: whether a meal's day has come is
// judged in local time.
const recurring = (id: string) =>
  makeTask({ id, recurrenceType: 'daily', dueDate: new Date(2026, 7, 10, 9).toISOString() });
const meal = (id: string) =>
  makeTask({ id, generatedKind: 'mealSlot', dueDate: new Date(2020, 0, 1, 9).toISOString() });
const plain = (id: string) => makeTask({ id });

describe('bulkDeletePrompt', () => {
  it('is a plain confirm when nothing selected is missable', () => {
    const tasks = [
      plain('p'),
      // A completed occurrence is a log entry with one sensible delete.
      makeTask({ id: 'done', recurrenceType: 'daily', completed: true }),
      // A meal whose day has not come has no record a mark-missed would keep.
      makeTask({ id: 'later', generatedKind: 'mealSlot', dueDate: new Date(2099, 0, 1, 9).toISOString() }),
    ];
    expect(bulkDeletePrompt(['p', 'done', 'later', 'missing'], tasks)).toEqual({ kind: 'delete' });
  });

  it('asks about a lone repeating task in its own words', () => {
    expect(bulkDeletePrompt(['r'], [recurring('r')])).toEqual({
      kind: 'missable',
      missableIds: ['r'],
      restIds: [],
      message: 'This task repeats. Mark just this one missed, or delete it and stop it repeating?',
      deleteLabel: 'Delete and stop repeating',
    });
  });

  it('pluralises for several repeating tasks and still offers to end the series', () => {
    expect(bulkDeletePrompt(['r1', 'r2'], [recurring('r1'), recurring('r2')])).toMatchObject({
      message: 'These tasks repeat. Mark them missed instead, or delete them and stop them repeating?',
      deleteLabel: 'Delete and stop repeating',
    });
  });

  it('splits a repeating task from the ordinary ones beside it, and only then says "anyway"', () => {
    expect(bulkDeletePrompt(['p', 'r'], [plain('p'), recurring('r')])).toEqual({
      kind: 'missable',
      missableIds: ['r'],
      restIds: ['p'],
      message: 'This task repeats. Mark just this one missed, or delete it and stop it repeating?',
      deleteLabel: 'Delete anyway',
    });
  });

  it('asks about a meal-plan task as a record to keep, not a series to end', () => {
    expect(bulkDeletePrompt(['m'], [meal('m')])).toEqual({
      kind: 'missable',
      missableIds: ['m'],
      restIds: [],
      message: 'This came from your meal plan. Mark it missed to keep a record, or delete it outright?',
      deleteLabel: 'Delete',
    });
    expect(bulkDeletePrompt(['m1', 'm2', 'p'], [meal('m1'), meal('m2'), plain('p')])).toMatchObject({
      missableIds: ['m1', 'm2'],
      restIds: ['p'],
      message: 'These came from your meal plan. Mark them missed to keep a record, or delete them outright?',
      deleteLabel: 'Delete anyway',
    });
  });

  it('hedges only when both reasons are genuinely in the selection', () => {
    expect(bulkDeletePrompt(['r', 'm'], [recurring('r'), meal('m')])).toEqual({
      kind: 'missable',
      missableIds: ['r', 'm'],
      restIds: [],
      message: 'Some selected tasks repeat or came from your meal plan. Mark those missed, or delete your whole selection anyway?',
      deleteLabel: 'Delete anyway',
    });
  });

  it('keeps the selection order, and files an id with no task with the rest', () => {
    expect(bulkDeletePrompt(['m', 'ghost', 'r'], [recurring('r'), meal('m')])).toMatchObject({
      missableIds: ['m', 'r'],
      restIds: ['ghost'],
    });
  });
});
