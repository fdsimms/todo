import type { FoodLogEntry, Task } from '../types';

let mockSettings: { healthWriteEnabled: boolean; dayResetTime: string } = {
  healthWriteEnabled: false,
  dayResetTime: '00:00',
};
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

let mockDayEntries: FoodLogEntry[] = [];
jest.mock('../db/database', () => ({
  dbGetFoodLogEntries: () => mockDayEntries,
}));

const mockAddEntry = jest.fn();
const mockReviseEntry = jest.fn();
const mockRemoveEntry = jest.fn();
jest.mock('../store/useFoodLogStore', () => ({
  useFoodLogStore: {
    getState: () => ({ addEntry: mockAddEntry, reviseEntry: mockReviseEntry, removeEntry: mockRemoveEntry }),
  },
}));

import { logTaskHealthValue, unlogTaskNutrientFromFoodLog } from '../utils/healthCompletionSync';

function waterEntry(waterMl: number, overrides: Partial<FoodLogEntry> = {}): FoodLogEntry {
  return {
    id: 'water-entry-1',
    dayKey: '2026-09-16',
    atISO: new Date('2026-09-16T08:00:00.000Z').toISOString(),
    slot: null,
    label: 'Water',
    recipeId: null,
    itemId: null,
    productId: null,
    mealPlanEntryId: null,
    quantity: `${waterMl} ml`,
    grams: null,
    nutrition: {
      basis: 'perServing',
      servingGrams: null,
      servingText: `${waterMl} ml`,
      amounts: { waterMl },
      source: 'manual',
      sourceId: null,
      portions: [],
      recordedAt: new Date('2026-09-16T08:00:00.000Z').toISOString(),
    },
    healthSampleIds: [],
    sortOrder: 0,
    createdAt: new Date('2026-09-16T08:00:00.000Z').toISOString(),
    ...overrides,
  };
}

const BASE: Task = {
  id: 'task-1',
  title: 'Drink water',
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
  quotaStartedAt: null, quotaAlwaysVisible: false, followWaterTarget: false,
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
  followUpTaskSourceId: null,
  vacationPause: false, excludeFromSuggestions: false,
  timerStartedAt: null,
  timedMinutes: null,
  timerElapsedSeconds: 0,
  healthMetric: null,
  healthTarget: null, healthFollowGoal: false,
  completionTimerMinutes: null, completionTimerNote: null, completionTimerStartedAt: null,
  logHealthMetric: null, logHealthAmount: null, medicationName: null, medicationAmount: null, medicationUnit: null, logMealSlot: null, estimateBeforeTiming: null,
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

function makeTask(overrides: Partial<Task>): Task {
  return { ...BASE, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings = { healthWriteEnabled: true, dayResetTime: '00:00' };
  mockDemoActive = false;
  mockDayEntries = [];
});

describe('logTaskHealthValue', () => {
  it('does nothing when the setting is off', async () => {
    mockSettings.healthWriteEnabled = false;
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'proteinG', logHealthAmount: 20 }));
    expect(result).toBe(false);
    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it('does nothing when the task never asked for it', async () => {
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: null, logHealthAmount: null }));
    expect(result).toBe(false);
    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it('does nothing when a metric is set but no amount is', async () => {
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'proteinG', logHealthAmount: null }));
    expect(result).toBe(false);
    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it('does nothing for a non-positive amount', async () => {
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'proteinG', logHealthAmount: 0 }));
    expect(result).toBe(false);
    expect(mockAddEntry).not.toHaveBeenCalled();
  });

  it('logs the task’s own nutrient to the food log as an entry stating only that', async () => {
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'sodiumMg', logHealthAmount: 500 }));
    expect(result).toBe(true);
    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    const draft = mockAddEntry.mock.calls[0][0];
    expect(draft.label).toBe('Sodium');
    expect(draft.quantity).toBe('500 mg');
    expect(draft.nutrition.amounts).toEqual({ sodiumMg: 500 });
    expect(draft.slot).toBeNull();
    expect(draft.itemId).toBeNull();
  });

  it('never writes while demo mode is active', async () => {
    mockDemoActive = true;
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'waterMl', logHealthAmount: 250 }));
    expect(result).toBe(false);
    expect(mockAddEntry).not.toHaveBeenCalled();
  });
});

describe('logTaskHealthValue — the food log is the only write, for water and every other nutrient', () => {
  it('creates today’s water entry when there is none yet', async () => {
    mockDayEntries = [];
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'waterMl', logHealthAmount: 250 }));
    expect(result).toBe(true);
    expect(mockReviseEntry).not.toHaveBeenCalled();
    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    expect(mockAddEntry.mock.calls[0][0].nutrition.amounts.waterMl).toBe(250);
  });

  it('accumulates onto today’s existing water entry rather than replacing it', async () => {
    mockDayEntries = [waterEntry(500)];
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'waterMl', logHealthAmount: 250 }));
    expect(result).toBe(true);
    expect(mockAddEntry).not.toHaveBeenCalled();
    expect(mockReviseEntry).toHaveBeenCalledTimes(1);
    const [id, patch] = mockReviseEntry.mock.calls[0];
    expect(id).toBe('water-entry-1');
    expect(patch.nutrition.amounts.waterMl).toBe(750);
  });

  it('ignores a same-day entry that states more than water', async () => {
    mockDayEntries = [
      waterEntry(400, {
        itemId: 'bottled-water',
        nutrition: {
          basis: 'perServing',
          servingGrams: null,
          servingText: '400 ml',
          amounts: { waterMl: 400, sodiumMg: 5 },
          source: 'manual',
          sourceId: null,
          portions: [],
          recordedAt: new Date().toISOString(),
        },
      }),
    ];
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'waterMl', logHealthAmount: 250 }));
    expect(result).toBe(true);
    // The bottled-water row isn't the stepper's own entry (isWaterEntry excludes
    // anything with an itemId or a second nutrient), so this creates a new row
    // rather than folding the task's amount into a logged food.
    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    expect(mockAddEntry.mock.calls[0][0].nutrition.amounts.waterMl).toBe(250);
  });
});

describe('unlogTaskNutrientFromFoodLog — the mirror, for unlogQuotaUnit\'s undo', () => {
  it('does nothing when today has no water entry to correct', () => {
    mockDayEntries = [];
    unlogTaskNutrientFromFoodLog('waterMl', 250, new Date());
    expect(mockReviseEntry).not.toHaveBeenCalled();
    expect(mockRemoveEntry).not.toHaveBeenCalled();
  });

  it('subtracts one unit off today’s existing total', () => {
    mockDayEntries = [waterEntry(750)];
    unlogTaskNutrientFromFoodLog('waterMl', 250, new Date());
    expect(mockRemoveEntry).not.toHaveBeenCalled();
    expect(mockReviseEntry).toHaveBeenCalledTimes(1);
    const [id, patch] = mockReviseEntry.mock.calls[0];
    expect(id).toBe('water-entry-1');
    expect(patch.nutrition.amounts.waterMl).toBe(500);
  });

  it('deletes the row rather than storing a zero once the total falls to nothing', () => {
    mockDayEntries = [waterEntry(250)];
    unlogTaskNutrientFromFoodLog('waterMl', 250, new Date());
    expect(mockReviseEntry).not.toHaveBeenCalled();
    expect(mockRemoveEntry).toHaveBeenCalledWith('water-entry-1');
  });

  it('deletes the row rather than going negative when the amount overshoots what is logged', () => {
    mockDayEntries = [waterEntry(150)];
    unlogTaskNutrientFromFoodLog('waterMl', 250, new Date());
    expect(mockReviseEntry).not.toHaveBeenCalled();
    expect(mockRemoveEntry).toHaveBeenCalledWith('water-entry-1');
  });
});

describe('a nutrient other than water', () => {
  function sodiumEntry(sodiumMg: number, overrides: Partial<FoodLogEntry> = {}): FoodLogEntry {
    const base = waterEntry(0);
    return {
      ...base,
      id: 'sodium-entry-1',
      label: 'Sodium',
      quantity: `${sodiumMg} mg`,
      nutrition: { ...base.nutrition, servingText: `${sodiumMg} mg`, amounts: { sodiumMg } },
      ...overrides,
    };
  }

  it('accumulates onto the day’s existing entry for that nutrient', async () => {
    mockDayEntries = [sodiumEntry(500)];
    await logTaskHealthValue(makeTask({ logHealthMetric: 'sodiumMg', logHealthAmount: 300 }));
    expect(mockAddEntry).not.toHaveBeenCalled();
    const [id, patch] = mockReviseEntry.mock.calls[0];
    expect(id).toBe('sodium-entry-1');
    expect(patch.nutrition.amounts).toEqual({ sodiumMg: 800 });
    expect(patch.quantity).toBe('800 mg');
  });

  it('does not rewrite a single-nutrient entry the person named themselves', async () => {
    mockDayEntries = [sodiumEntry(500, { label: 'Pickle brine' })];
    await logTaskHealthValue(makeTask({ logHealthMetric: 'sodiumMg', logHealthAmount: 300 }));
    expect(mockReviseEntry).not.toHaveBeenCalled();
    expect(mockAddEntry).toHaveBeenCalledTimes(1);
  });

  it('keeps each nutrient on its own entry', async () => {
    mockDayEntries = [sodiumEntry(500)];
    await logTaskHealthValue(makeTask({ logHealthMetric: 'caffeineMg', logHealthAmount: 95 }));
    expect(mockReviseEntry).not.toHaveBeenCalled();
    expect(mockAddEntry.mock.calls[0][0].nutrition.amounts).toEqual({ caffeineMg: 95 });
  });

  it('takes one unit back off on undo, and deletes the entry at zero', () => {
    mockDayEntries = [sodiumEntry(800)];
    unlogTaskNutrientFromFoodLog('sodiumMg', 300, new Date());
    expect(mockReviseEntry.mock.calls[0][1].nutrition.amounts).toEqual({ sodiumMg: 500 });

    mockDayEntries = [sodiumEntry(300)];
    unlogTaskNutrientFromFoodLog('sodiumMg', 300, new Date());
    expect(mockRemoveEntry).toHaveBeenCalledWith('sodium-entry-1');
  });

  it('does not undo anything while the Health write switch is off', () => {
    mockSettings.healthWriteEnabled = false;
    mockDayEntries = [sodiumEntry(800)];
    unlogTaskNutrientFromFoodLog('sodiumMg', 300, new Date());
    expect(mockReviseEntry).not.toHaveBeenCalled();
    expect(mockRemoveEntry).not.toHaveBeenCalled();
  });
});
