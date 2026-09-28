import type { Task } from '../types';

let mockSettings: { deadlineCalendarId: string | null } = { deadlineCalendarId: null };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ categories: [], getCategoryByName: () => null }) },
}));

const mockCreateDeadlineEvent = jest.fn();
const mockMoveDeadlineEvent = jest.fn();
const mockDeleteDeadlineEvent = jest.fn();
jest.mock('../utils/calendarSync', () => ({
  createAllDayEvent: (...args: unknown[]) => mockCreateDeadlineEvent(...args),
  moveAllDayEvent: (...args: unknown[]) => mockMoveDeadlineEvent(...args),
  deleteCalendarEvent: (...args: unknown[]) => mockDeleteDeadlineEvent(...args),
}));

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

import { syncDeadlineEvent } from '../utils/deadlineCalendarSync';

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
  followUpTaskSourceId: null,
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

function makeTask(overrides: Partial<Task>): Task {
  return { ...BASE, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings = { deadlineCalendarId: 'cal-1' };
  mockDemoActive = false;
  // EventKit reports the same id back for an event rewritten in place.
  mockMoveDeadlineEvent.mockReset().mockImplementation((id: string) => Promise.resolve(id));
  mockDeleteDeadlineEvent.mockReset().mockResolvedValue(undefined);
});

describe('syncDeadlineEvent', () => {
  it('does nothing when no calendar is picked in settings', async () => {
    mockSettings.deadlineCalendarId = null;
    const result = await syncDeadlineEvent(makeTask({ deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z' }));
    expect(result).toBeNull();
    expect(mockCreateDeadlineEvent).not.toHaveBeenCalled();
    expect(mockMoveDeadlineEvent).not.toHaveBeenCalled();
    expect(mockDeleteDeadlineEvent).not.toHaveBeenCalled();
  });

  it('does nothing when the per-task toggle is off', async () => {
    const result = await syncDeadlineEvent(makeTask({ deadlineOnCalendar: false, deadline: '2026-08-20T00:00:00Z' }));
    expect(result).toBeNull();
    expect(mockCreateDeadlineEvent).not.toHaveBeenCalled();
  });

  it('does nothing when there is no deadline', async () => {
    const result = await syncDeadlineEvent(makeTask({ deadlineOnCalendar: true, deadline: null }));
    expect(result).toBeNull();
    expect(mockCreateDeadlineEvent).not.toHaveBeenCalled();
  });

  it('deletes the existing event and returns null when the toggle is off but an event still exists', async () => {
    const task = makeTask({ deadlineOnCalendar: false, deadline: '2026-08-20T00:00:00Z', calendarEventId: 'evt-1' });
    const result = await syncDeadlineEvent(task);
    expect(result).toBeNull();
    expect(mockDeleteDeadlineEvent).toHaveBeenCalledWith('evt-1');
  });

  it('deletes the existing event when the deadline is cleared', async () => {
    const task = makeTask({ deadlineOnCalendar: true, deadline: null, calendarEventId: 'evt-1' });
    const result = await syncDeadlineEvent(task);
    expect(result).toBeNull();
    expect(mockDeleteDeadlineEvent).toHaveBeenCalledWith('evt-1');
  });

  it('deletes the existing event when the task is completed', async () => {
    const task = makeTask({
      deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z', calendarEventId: 'evt-1', completed: true,
    });
    const result = await syncDeadlineEvent(task);
    expect(result).toBeNull();
    expect(mockDeleteDeadlineEvent).toHaveBeenCalledWith('evt-1');
  });

  it('deletes the existing event when the task is archived', async () => {
    const task = makeTask({
      deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z', calendarEventId: 'evt-1', archived: true,
    });
    const result = await syncDeadlineEvent(task);
    expect(result).toBeNull();
    expect(mockDeleteDeadlineEvent).toHaveBeenCalledWith('evt-1');
  });

  it('does not call deleteCalendarEvent when there was never an event to remove', async () => {
    const task = makeTask({ deadlineOnCalendar: false, deadline: null, calendarEventId: null });
    await syncDeadlineEvent(task);
    expect(mockDeleteDeadlineEvent).not.toHaveBeenCalled();
  });

  it('creates a fresh event when the task has none yet', async () => {
    mockCreateDeadlineEvent.mockResolvedValue('new-evt');
    const task = makeTask({ deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z', title: 'Renew passport' });
    const result = await syncDeadlineEvent(task);
    expect(result).toBe('new-evt');
    expect(mockCreateDeadlineEvent).toHaveBeenCalledWith('cal-1', {
      title: 'Renew passport',
      date: new Date('2026-08-20T00:00:00Z'),
    });
    expect(mockMoveDeadlineEvent).not.toHaveBeenCalled();
  });

  it('updates the existing event in place and keeps its id', async () => {
    const task = makeTask({
      deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z', calendarEventId: 'evt-1', title: 'Renew passport',
    });
    const result = await syncDeadlineEvent(task);
    expect(result).toBe('evt-1');
    expect(mockMoveDeadlineEvent).toHaveBeenCalledWith('evt-1', 'cal-1', {
      title: 'Renew passport',
      date: new Date('2026-08-20T00:00:00Z'),
    });
    expect(mockCreateDeadlineEvent).not.toHaveBeenCalled();
    expect(mockDeleteDeadlineEvent).not.toHaveBeenCalled();
  });

  // #2949's sibling: switching "Write deadlines to" from a shared calendar to
  // a private one kept rewriting every existing deadline in the shared one,
  // because the rewrite never said which calendar.
  it('moves an existing event into the calendar picked now, and links the id it comes back with', async () => {
    mockSettings = { deadlineCalendarId: 'cal-home' };
    mockMoveDeadlineEvent.mockResolvedValue('evt-moved');
    const task = makeTask({
      deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z', calendarEventId: 'evt-work', title: 'Renew passport',
    });
    expect(await syncDeadlineEvent(task)).toBe('evt-moved');
    expect(mockMoveDeadlineEvent).toHaveBeenCalledWith('evt-work', 'cal-home', expect.objectContaining({
      title: 'Renew passport',
    }));
    expect(mockCreateDeadlineEvent).not.toHaveBeenCalled();
  });

  it('falls back to creating a fresh event when the move fails (a stale id)', async () => {
    mockMoveDeadlineEvent.mockResolvedValue(null);
    mockCreateDeadlineEvent.mockResolvedValue('fresh-evt');
    const task = makeTask({
      deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z', calendarEventId: 'stale-evt',
    });
    const result = await syncDeadlineEvent(task);
    expect(result).toBe('fresh-evt');
    expect(mockMoveDeadlineEvent).toHaveBeenCalledWith('stale-evt', 'cal-1', expect.anything());
    expect(mockCreateDeadlineEvent).toHaveBeenCalledWith('cal-1', expect.anything());
  });

  it('clears the old event before writing a fresh one, so a refused move leaves no copy behind', async () => {
    mockMoveDeadlineEvent.mockResolvedValue(null);
    mockCreateDeadlineEvent.mockResolvedValue('fresh-evt');
    await syncDeadlineEvent(makeTask({
      deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z', calendarEventId: 'evt-work',
    }));
    expect(mockDeleteDeadlineEvent).toHaveBeenCalledWith('evt-work');
    expect(mockDeleteDeadlineEvent.mock.invocationCallOrder[0])
      .toBeLessThan(mockCreateDeadlineEvent.mock.invocationCallOrder[0]);
  });

  it('falls back to the task title "Deadline" when displayTitleFor has nothing to show', async () => {
    mockCreateDeadlineEvent.mockResolvedValue('evt');
    const task = makeTask({ deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z', title: '' });
    await syncDeadlineEvent(task);
    expect(mockCreateDeadlineEvent).toHaveBeenCalledWith('cal-1', expect.objectContaining({ title: 'Deadline' }));
  });

  it('never touches the device calendar while demo mode is active', async () => {
    // #1629's sibling: latent today since demo-seeded tasks never set
    // deadlineOnCalendar, but a future seed change shouldn't get a free
    // pass to write a real device event just because this guard is missing.
    mockDemoActive = true;
    const task = makeTask({
      deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z', calendarEventId: 'evt-1',
    });
    expect(await syncDeadlineEvent(task)).toBeNull();
    expect(mockCreateDeadlineEvent).not.toHaveBeenCalled();
    expect(mockMoveDeadlineEvent).not.toHaveBeenCalled();
    expect(mockDeleteDeadlineEvent).not.toHaveBeenCalled();
  });
});
