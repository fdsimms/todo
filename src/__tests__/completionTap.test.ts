import { completionTapFor } from '../utils/completionTap';
import type { Task } from '../types';

const mockSettingsState = {
  dayResetTime: '00:00',
  morningStart: '06:00',
  afternoonStart: '12:00',
  eveningStart: '18:00',
  nightStart: '21:00',
  activeHoursStart: '08:00',
  activeHoursEnd: '22:00',
  vacationMode: false,
};

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: {
    getState: () => mockSettingsState,
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

// June 10, 2025 at 10:00 AM
const NOW = new Date(2025, 5, 10, 10, 0, 0);

const baseTask = {
  id: 'test-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
  createdAt: new Date(2025, 0, 1).toISOString(),
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
  showStreak: false,
  streakRequiresWindow: false,
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
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null,
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
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
  vacationPause: false, excludeFromSuggestions: false,
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
} as Task;

describe('completionTapFor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('ticks an ordinary task off', () => {
    expect(completionTapFor(baseTask)).toBe('complete');
  });

  it('puts a completed task back', () => {
    expect(completionTapFor({ ...baseTask, completed: true })).toBe('uncomplete');
  });

  it('asks a decision task for its answer first', () => {
    expect(completionTapFor({ ...baseTask, deliverableKind: 'text' })).toBe('ask');
  });

  it('does not ask a decision task that is already answered and done', () => {
    expect(
      completionTapFor({ ...baseTask, deliverableKind: 'text', deliverableValue: 'Blue', completed: true })
    ).toBe('uncomplete');
  });

  describe('a recurring task whose day has not arrived', () => {
    it('refuses the tap', () => {
      const nextWeek = new Date(2025, 5, 17, 9, 0, 0).toISOString();
      expect(
        completionTapFor({ ...baseTask, recurrenceType: 'weekly', dueDate: nextWeek })
      ).toBe('locked');
    });

    it('still uncompletes, since the lock is about ticking early', () => {
      const nextWeek = new Date(2025, 5, 17, 9, 0, 0).toISOString();
      expect(
        completionTapFor({ ...baseTask, recurrenceType: 'weekly', dueDate: nextWeek, completed: true })
      ).toBe('uncomplete');
    });

    it('lets today\'s occurrence through', () => {
      const today = new Date(2025, 5, 10, 9, 0, 0).toISOString();
      expect(
        completionTapFor({ ...baseTask, recurrenceType: 'weekly', dueDate: today })
      ).toBe('complete');
    });
  });

  describe('daily targets', () => {
    const quota = { ...baseTask, targetCount: 8, targetUnit: 'glasses' } as Task;

    it('logs one unit while the target is out of reach', () => {
      expect(completionTapFor({ ...quota, progressCount: 0 })).toBe('log-unit');
      expect(completionTapFor({ ...quota, progressCount: 6 })).toBe('log-unit');
    });

    it('completes on the unit that meets the target', () => {
      expect(completionTapFor({ ...quota, progressCount: 7 })).toBe('complete');
    });

    it('keeps logging past the target when overshoot is allowed', () => {
      expect(
        completionTapFor({ ...quota, allowOvershoot: true, progressCount: 7 })
      ).toBe('log-unit');
      expect(
        completionTapFor({ ...quota, allowOvershoot: true, progressCount: 20 })
      ).toBe('log-unit');
    });

    it('offers to put a finished target back rather than logging a ninth unit', () => {
      expect(
        completionTapFor({ ...quota, completed: true, progressCount: 8 })
      ).toBe('uncomplete');
    });

    it('asks for the answer only on the unit that finishes a decision target', () => {
      const asking = { ...quota, deliverableKind: 'number' } as Task;
      expect(completionTapFor({ ...asking, progressCount: 3 })).toBe('log-unit');
      expect(completionTapFor({ ...asking, progressCount: 7 })).toBe('ask');
    });

    it('treats a target of 1 as an ordinary tick, not a meter', () => {
      expect(completionTapFor({ ...baseTask, targetCount: 1 })).toBe('complete');
    });
  });

  it('lets a blocked task be ticked, the same as its row does', () => {
    expect(completionTapFor({ ...baseTask, blockedById: 'other-task' })).toBe('complete');
  });

  describe('a meal-slot task', () => {
    const chooseChain = [
      { id: 'lunch-choose', title: 'Choose lunch', estimatedMinutes: null },
      { id: 'lunch-prepare', title: 'Prepare lunch', estimatedMinutes: null },
      { id: 'lunch-eat', title: 'Eat lunch', estimatedMinutes: null },
    ];
    const chooseStep = {
      ...baseTask,
      generatedKind: 'mealSlot',
      generatedSourceId: '2025-06-10#lunch',
      chainEnabled: true,
      chainIndex: 0,
      chainItems: chooseChain,
    } as Task;

    it('opens the meal picker on the unanswered "Choose" step instead of ticking it', () => {
      expect(completionTapFor(chooseStep)).toBe('pick-meal');
    });

    it('ticks normally once the chain has moved past Choose', () => {
      expect(completionTapFor({ ...chooseStep, chainIndex: 1 })).toBe('complete');
    });

    it('ticks normally on a single-step slot (leftover/takeout answer)', () => {
      expect(
        completionTapFor({
          ...chooseStep,
          chainEnabled: false,
          chainIndex: 0,
          chainItems: [{ id: 'lunch-eat', title: 'Eat lunch', estimatedMinutes: null }],
        })
      ).toBe('complete');
    });
  });
});
