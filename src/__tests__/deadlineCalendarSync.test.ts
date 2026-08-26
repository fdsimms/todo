import type { Task } from '../types';

let mockSettings: { deadlineCalendarId: string | null } = { deadlineCalendarId: null };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ categories: [], getCategoryByName: () => null }) },
}));

const mockCreateDeadlineEvent = jest.fn();
const mockUpdateDeadlineEvent = jest.fn();
const mockDeleteDeadlineEvent = jest.fn();
jest.mock('../utils/calendarSync', () => ({
  createAllDayEvent: (...args: unknown[]) => mockCreateDeadlineEvent(...args),
  updateAllDayEvent: (...args: unknown[]) => mockUpdateDeadlineEvent(...args),
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
  showStreak: false,
  streakRequiresWindow: false,
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
};

function makeTask(overrides: Partial<Task>): Task {
  return { ...BASE, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings = { deadlineCalendarId: 'cal-1' };
  mockDemoActive = false;
});

describe('syncDeadlineEvent', () => {
  it('does nothing when no calendar is picked in settings', async () => {
    mockSettings.deadlineCalendarId = null;
    const result = await syncDeadlineEvent(makeTask({ deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z' }));
    expect(result).toBeNull();
    expect(mockCreateDeadlineEvent).not.toHaveBeenCalled();
    expect(mockUpdateDeadlineEvent).not.toHaveBeenCalled();
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
    expect(mockUpdateDeadlineEvent).not.toHaveBeenCalled();
  });

  it('updates the existing event in place and keeps its id', async () => {
    mockUpdateDeadlineEvent.mockResolvedValue(true);
    const task = makeTask({
      deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z', calendarEventId: 'evt-1', title: 'Renew passport',
    });
    const result = await syncDeadlineEvent(task);
    expect(result).toBe('evt-1');
    expect(mockUpdateDeadlineEvent).toHaveBeenCalledWith('evt-1', {
      title: 'Renew passport',
      date: new Date('2026-08-20T00:00:00Z'),
    });
    expect(mockCreateDeadlineEvent).not.toHaveBeenCalled();
  });

  it('falls back to creating a fresh event when the update fails (a stale id)', async () => {
    mockUpdateDeadlineEvent.mockResolvedValue(false);
    mockCreateDeadlineEvent.mockResolvedValue('fresh-evt');
    const task = makeTask({
      deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z', calendarEventId: 'stale-evt',
    });
    const result = await syncDeadlineEvent(task);
    expect(result).toBe('fresh-evt');
    expect(mockUpdateDeadlineEvent).toHaveBeenCalledWith('stale-evt', expect.anything());
    expect(mockCreateDeadlineEvent).toHaveBeenCalledWith('cal-1', expect.anything());
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
    expect(mockUpdateDeadlineEvent).not.toHaveBeenCalled();
    expect(mockDeleteDeadlineEvent).not.toHaveBeenCalled();
  });
});
