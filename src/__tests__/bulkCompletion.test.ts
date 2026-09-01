import { tasksAskingOnCompletion, unansweredCompletionCopy } from '../utils/bulkCompletion';
import type { Task } from '../types';

// Same two stubs completionTap.test.ts uses: isRecurrenceNotYetDue reaches
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
  recurrenceMonthDay: null, recurrenceWeekOrdinal: null, recurrenceAnchorDay: null, recurrenceAnchorDate: null, recurrenceEndDate: null,
  recurrenceCount: null, recurrenceFromCompletion: false,
  targetCount: null, progressCount: 0, targetUnit: null, allowOvershoot: false,
  supplyCount: null, supplyUnit: null, supplyRefillCount: null, supplyReorderAt: 1,
  supplyLeadDays: null, supplyDeclinedAtCount: null, supplyGroceryItemId: null,
  tags: [], category: null, sortOrder: 0, pinned: false, pinnedOrder: 0, priority: 0, effort: 0,
  estimatedMinutes: null, reminderTime: null, reminderKind: 'notification', reminderOffsetDays: null, linkUrl: null,
  phoneNumber: null, emailAddress: null, location: null, blockedById: null, waitingOnPersonId: null,
  deliverableKind: null, deliverableValue: null, generatedKind: null, generatedSourceId: null,
  deadlineOnCalendar: false, calendarEventId: null, timeBlockEventId: null,
  pendingImport: null, backfillDismissedFields: [],
  streakCount: 0, streakDate: null, previousStreakCount: 0, previousStreakDate: null, priorBestStreak: 0,
  showStreak: false, streakRequiresWindow: false,
  parentId: null, groupId: null, projectId: null,
  chainEnabled: false, chainIndex: 0, chainItems: [], chainStepOnSchedule: false, vacationPause: false, excludeFromSuggestions: false,
  extraTaskEveryN: null, extraTaskTitle: null, extraTaskDraft: null,
  extraTaskTally: 0, previousExtraTaskTally: 0,
  archived: false, archivedAt: null, timerStartedAt: null, actualMinutes: null,
  timedMinutes: null, timerElapsedSeconds: 0,
  previousOccurrenceId: null,
  seriesId: null, seriesMonthDays: [], seriesRepeatMonths: 1, seriesDefaults: null,
  postponeCount: 0, postponeMuted: false, driftingSince: null,
  quotaIntervalMinutes: null, quotaReminders: false, quotaStartedAt: null, quotaAlwaysVisible: false,
  quotaPeriod: 'day',
  ...overrides,
});

const idsOf = (tasks: Task[]) => tasks.map(t => t.id);

describe('tasksAskingOnCompletion', () => {
  it('names only the tasks that would stop and ask', () => {
    const tasks = [
      makeTask({ id: 'plain' }),
      makeTask({ id: 'asks', deliverableKind: 'date' }),
      makeTask({ id: 'plain-2' }),
    ];
    expect(idsOf(tasksAskingOnCompletion(tasks))).toEqual(['asks']);
  });

  it('keeps the order it was given', () => {
    const tasks = [
      makeTask({ id: 'b', deliverableKind: 'text' }),
      makeTask({ id: 'a', deliverableKind: 'number' }),
    ];
    expect(idsOf(tasksAskingOnCompletion(tasks))).toEqual(['b', 'a']);
  });

  it('is empty when nothing asks anything', () => {
    expect(tasksAskingOnCompletion([makeTask(), makeTask({ id: 't2' })])).toEqual([]);
    expect(tasksAskingOnCompletion([])).toEqual([]);
  });

  // Both of these are completeTask's own guards. Prompting for a task the bulk
  // completion then no-ops on asks a question about a row that doesn't move.
  it('skips a task that is already completed', () => {
    const tasks = [makeTask({ id: 'done', deliverableKind: 'text', completed: true })];
    expect(tasksAskingOnCompletion(tasks)).toEqual([]);
  });

  it("skips a recurring task whose day hasn't come round yet", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 3);
    const tasks = [makeTask({
      id: 'early',
      deliverableKind: 'text',
      recurrenceType: 'weekly',
      recurrenceInterval: 1,
      dueDate: tomorrow.toISOString(),
    })];
    expect(tasksAskingOnCompletion(tasks)).toEqual([]);
  });

  // A tap on this row would log a unit rather than complete it, but a bulk
  // completion completes it outright — so it reaches its question.
  it('includes a daily target that is still short of its count', () => {
    const tasks = [makeTask({
      id: 'water', deliverableKind: 'number', targetCount: 8, progressCount: 2,
    })];
    expect(idsOf(tasksAskingOnCompletion(tasks))).toEqual(['water']);
  });

  // The question can be the chain step's rather than the task's.
  it('includes a task whose active chain step carries the question', () => {
    const tasks = [makeTask({
      id: 'haircut',
      deliverableKind: null,
      chainEnabled: true,
      chainIndex: 0,
      chainItems: [
        { id: 'book', title: 'Book haircut', estimatedMinutes: null, deliverableKind: 'date', deliverableDatesNextStep: true },
        { id: 'get', title: 'Get haircut', estimatedMinutes: null },
      ],
    })];
    expect(idsOf(tasksAskingOnCompletion(tasks))).toEqual(['haircut']);
  });

  it('skips a chain sitting on a step that asks nothing', () => {
    const tasks = [makeTask({
      id: 'haircut',
      deliverableKind: null,
      chainEnabled: true,
      chainIndex: 1,
      chainItems: [
        { id: 'book', title: 'Book haircut', estimatedMinutes: null, deliverableKind: 'date', deliverableDatesNextStep: true },
        { id: 'get', title: 'Get haircut', estimatedMinutes: null },
      ],
    })];
    expect(tasksAskingOnCompletion(tasks)).toEqual([]);
  });
});

describe('unansweredCompletionCopy', () => {
  it('reads as a sentence in the singular', () => {
    const { title, message } = unansweredCompletionCopy(1);
    expect(title).toBe('1 task asks a question');
    expect(message).toContain('answer it now');
  });

  it('reads as a sentence in the plural', () => {
    const { title, message } = unansweredCompletionCopy(4);
    expect(title).toBe('4 tasks ask a question');
    expect(message).toContain('one at a time');
  });

  // The copy rules in CLAUDE.md: plain and literal, no em dashes.
  it('has no em dashes', () => {
    for (const n of [1, 2]) {
      const { title, message } = unansweredCompletionCopy(n);
      expect(title).not.toContain('—');
      expect(message).not.toContain('—');
    }
  });
});
