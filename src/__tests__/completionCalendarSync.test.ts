import type { Task } from '../types';

let mockSettings: { completionCalendarId: string | null } = { completionCalendarId: null };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ categories: [], getCategoryByName: () => null }) },
}));

const mockCreateTimedEvent = jest.fn();
jest.mock('../utils/calendarSync', () => ({
  createTimedEvent: (...args: unknown[]) => mockCreateTimedEvent(...args),
}));

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

import { logTaskCompletionToCalendar } from '../utils/completionCalendarSync';

const BASE: Task = {
  id: 'task-1',
  title: 'Pay taxes',
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
  mockSettings = { completionCalendarId: 'cal-1' };
  mockDemoActive = false;
});

describe('logTaskCompletionToCalendar', () => {
  it('does nothing when no calendar is picked in settings', async () => {
    mockSettings.completionCalendarId = null;
    const result = await logTaskCompletionToCalendar(
      makeTask({ logCompletionToCalendar: true }),
      new Date('2026-08-20T12:00:00Z')
    );
    expect(result).toBeNull();
    expect(mockCreateTimedEvent).not.toHaveBeenCalled();
  });

  it('does nothing when the per-task toggle is off', async () => {
    const result = await logTaskCompletionToCalendar(
      makeTask({ logCompletionToCalendar: false }),
      new Date('2026-08-20T12:00:00Z')
    );
    expect(result).toBeNull();
    expect(mockCreateTimedEvent).not.toHaveBeenCalled();
  });

  it('writes a 30-minute event starting at the completion time and returns its id', async () => {
    mockCreateTimedEvent.mockResolvedValue('new-evt');
    const completedAt = new Date('2026-08-20T12:00:00Z');
    const task = makeTask({ logCompletionToCalendar: true, title: 'Pay taxes' });
    const result = await logTaskCompletionToCalendar(task, completedAt);
    expect(result).toBe('new-evt');
    expect(mockCreateTimedEvent).toHaveBeenCalledWith('cal-1', {
      title: 'Pay taxes',
      start: completedAt,
      end: new Date('2026-08-20T12:30:00Z'),
    });
  });

  it('falls back to "Completed task" when displayTitleFor has nothing to show', async () => {
    mockCreateTimedEvent.mockResolvedValue('evt');
    const task = makeTask({ logCompletionToCalendar: true, title: '' });
    await logTaskCompletionToCalendar(task, new Date('2026-08-20T12:00:00Z'));
    expect(mockCreateTimedEvent).toHaveBeenCalledWith('cal-1', expect.objectContaining({ title: 'Completed task' }));
  });

  it('never touches the device calendar while demo mode is active', async () => {
    mockDemoActive = true;
    const task = makeTask({ logCompletionToCalendar: true });
    expect(await logTaskCompletionToCalendar(task, new Date('2026-08-20T12:00:00Z'))).toBeNull();
    expect(mockCreateTimedEvent).not.toHaveBeenCalled();
  });
});
