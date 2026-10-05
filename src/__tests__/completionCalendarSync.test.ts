import type { Task } from '../types';

let mockSettings: { completionCalendarId: string | null } = { completionCalendarId: null };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ categories: [], getCategoryByName: () => null }) },
}));

const mockCreateTimedEvent = jest.fn();
const mockDeleteEvent = jest.fn();
const mockEventExists = jest.fn();
jest.mock('../utils/calendarSync', () => ({
  createTimedEvent: (...args: unknown[]) => mockCreateTimedEvent(...args),
  deleteCalendarEvent: (...args: unknown[]) => mockDeleteEvent(...args),
  calendarEventExists: (id: string) => mockEventExists(id),
}));

const mockEventsWithExternalId = jest.fn();
jest.mock('todo-eventkit-bridge', () => ({
  externalIdentifiers: () => Promise.resolve({}),
  eventsWithExternalIdentifier: (id: string) => mockEventsWithExternalId(id),
}), { virtual: true });

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

import { completionEventLink, deleteCompletionEvent, logTaskCompletionToCalendar } from '../utils/completionCalendarSync';

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
  rotationPlan: null,
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
  followUpTaskOneAtATime: false, followUpTaskAtEnd: false,
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
  completionTimerMinutes: null, completionTimerNote: null, completionTimerStartedAt: null, logHealthMetric: null, logHealthAmount: null, medicationName: null, medicationAmount: null, medicationUnit: null, logMealSlot: null, estimateBeforeTiming: null,
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

describe('deleteCompletionEvent (#2950)', () => {
  beforeEach(() => {
    mockSettings = { completionCalendarId: 'cal-log' };
    mockDemoActive = false;
    mockDeleteEvent.mockReset().mockResolvedValue(undefined);
    mockEventExists.mockReset().mockResolvedValue(true);
    mockEventsWithExternalId.mockReset().mockResolvedValue([]);
  });

  it('reads a task\'s link off its two completion columns', () => {
    const task = { ...BASE, completionCalendarEventId: 'evt-1', completionCalendarEventExternalId: 'ext-1' };
    expect(completionEventLink(task)).toEqual({ eventId: 'evt-1', externalId: 'ext-1' });
    expect(completionEventLink(BASE)).toEqual({ eventId: null, externalId: null });
  });

  it('deletes the event found by its server id when a restored phone\'s local id names nothing', async () => {
    mockEventExists.mockResolvedValue(false);
    mockEventsWithExternalId.mockResolvedValue([
      { id: 'evt-here', allDay: false, calendarId: 'cal-log' },
      { id: 'evt-copy', allDay: false, calendarId: 'cal-shared' },
    ]);
    await deleteCompletionEvent({ eventId: 'evt-old-phone', externalId: 'ext-1' });
    // Two copies, settled by the completion calendar picked now.
    expect(mockDeleteEvent).toHaveBeenCalledTimes(1);
    expect(mockDeleteEvent).toHaveBeenCalledWith('evt-here');
  });

  it('never deletes an all-day event found under the server id, since a completion is a point in time', async () => {
    mockEventExists.mockResolvedValue(false);
    mockEventsWithExternalId.mockResolvedValue([{ id: 'evt-all-day', allDay: true, calendarId: 'cal-log' }]);
    await deleteCompletionEvent({ eventId: 'evt-old-phone', externalId: 'ext-1' });
    expect(mockDeleteEvent).not.toHaveBeenCalled();
  });
});
