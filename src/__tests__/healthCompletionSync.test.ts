import type { Task } from '../types';

let mockSettings: { healthWriteEnabled: boolean } = { healthWriteEnabled: false };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

const mockWriteNutrientSample = jest.fn();
let mockBridge: { writeNutrientSample: (key: string, amount: number) => Promise<boolean> } | null = null;
jest.mock('../utils/healthBridge', () => ({
  healthBridge: () => mockBridge,
}));

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

import { logTaskHealthValue } from '../utils/healthCompletionSync';

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
  penaltyMinutes: null,
  penaltyCutoffTime: null,
  penaltyFiredAt: null,
  gatesApps: false,
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
  completionTimerMinutes: null,
  logHealthMetric: null, logHealthAmount: null, medicationName: null, medicationAmount: null, medicationUnit: null,
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
  mockSettings = { healthWriteEnabled: true };
  mockDemoActive = false;
  mockBridge = { writeNutrientSample: mockWriteNutrientSample };
  mockWriteNutrientSample.mockResolvedValue(true);
});

describe('logTaskHealthValue', () => {
  it('does nothing when the setting is off', async () => {
    mockSettings.healthWriteEnabled = false;
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'waterMl', logHealthAmount: 250 }));
    expect(result).toBe(false);
    expect(mockWriteNutrientSample).not.toHaveBeenCalled();
  });

  it('does nothing when the task never asked for it', async () => {
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: null, logHealthAmount: null }));
    expect(result).toBe(false);
    expect(mockWriteNutrientSample).not.toHaveBeenCalled();
  });

  it('does nothing when a metric is set but no amount is', async () => {
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'waterMl', logHealthAmount: null }));
    expect(result).toBe(false);
    expect(mockWriteNutrientSample).not.toHaveBeenCalled();
  });

  it('does nothing for a non-positive amount', async () => {
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'waterMl', logHealthAmount: 0 }));
    expect(result).toBe(false);
    expect(mockWriteNutrientSample).not.toHaveBeenCalled();
  });

  it('writes the task’s own metric and amount and returns the bridge’s answer', async () => {
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'waterMl', logHealthAmount: 300 }));
    expect(result).toBe(true);
    expect(mockWriteNutrientSample).toHaveBeenCalledWith('waterMl', 300);
  });

  it('writes whichever nutrient the task named, not just water', async () => {
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'proteinG', logHealthAmount: 20 }));
    expect(result).toBe(true);
    expect(mockWriteNutrientSample).toHaveBeenCalledWith('proteinG', 20);
  });

  it('reports false when the bridge is unavailable', async () => {
    mockBridge = null;
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'waterMl', logHealthAmount: 250 }));
    expect(result).toBe(false);
  });

  it('reports whatever the bridge itself reports, including a refused write', async () => {
    mockWriteNutrientSample.mockResolvedValue(false);
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'waterMl', logHealthAmount: 250 }));
    expect(result).toBe(false);
  });

  it('never touches the device Health store while demo mode is active', async () => {
    mockDemoActive = true;
    const result = await logTaskHealthValue(makeTask({ logHealthMetric: 'waterMl', logHealthAmount: 250 }));
    expect(result).toBe(false);
    expect(mockWriteNutrientSample).not.toHaveBeenCalled();
  });
});
