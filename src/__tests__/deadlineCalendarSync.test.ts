import type { Task } from '../types';

let mockSettings: { deadlineCalendarId: string | null } = { deadlineCalendarId: null };
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', ...mockSettings }) },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ categories: [], getCategoryByName: () => null }) },
}));

const mockCreateDeadlineEvent = jest.fn();
const mockMoveDeadlineEvent = jest.fn();
const mockDeleteDeadlineEvent = jest.fn();
// Whether a local id still names an event here: yes unless a test says not.
const mockEventExists = jest.fn((_id: string) => Promise.resolve(true));
jest.mock('../utils/calendarSync', () => ({
  createAllDayEvent: (...args: unknown[]) => mockCreateDeadlineEvent(...args),
  moveAllDayEvent: (...args: unknown[]) => mockMoveDeadlineEvent(...args),
  deleteCalendarEvent: (...args: unknown[]) => mockDeleteDeadlineEvent(...args),
  calendarEventExists: (id: string) => mockEventExists(id),
}));

// #2950: each write reads its event's server id back. Empty unless a test
// says otherwise, so a link's server id is null.
const mockExternalIds = jest.fn();
const mockEventsWithExternalId = jest.fn();
jest.mock('todo-eventkit-bridge', () => ({
  externalIdentifiers: (ids: string[]) => mockExternalIds(ids),
  eventsWithExternalIdentifier: (id: string) => mockEventsWithExternalId(id),
}), { virtual: true });

let mockDemoActive = false;
jest.mock('../utils/demoState', () => ({
  isDemoModeActive: () => mockDemoActive,
}));

import { syncDeadlineEvent, taskEventsAfterSync } from '../utils/deadlineCalendarSync';
import { NO_EVENT_LINK } from '../utils/calendarEventLink';

/** What a write links when the server id can't be read. */
const linked = (eventId: string) => ({ eventId, externalId: null });
import { emptyApplyReport, type ApplyReport } from '../utils/syncMerge';

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
  healthTarget: null, healthFollowGoal: false, completionTimerMinutes: null, completionTimerNote: null, completionTimerStartedAt: null, logHealthMetric: null, logHealthAmount: null, medicationName: null, medicationAmount: null, medicationUnit: null, logMealSlot: null, estimateBeforeTiming: null,
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
  mockEventExists.mockReset().mockImplementation(() => Promise.resolve(true));
  mockExternalIds.mockReset().mockResolvedValue({});
  mockEventsWithExternalId.mockReset().mockResolvedValue([]);
});

describe('syncDeadlineEvent', () => {
  it('does nothing when no calendar is picked in settings', async () => {
    mockSettings.deadlineCalendarId = null;
    const result = await syncDeadlineEvent(makeTask({ deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z' }));
    expect(result).toEqual(NO_EVENT_LINK);
    expect(mockCreateDeadlineEvent).not.toHaveBeenCalled();
    expect(mockMoveDeadlineEvent).not.toHaveBeenCalled();
    expect(mockDeleteDeadlineEvent).not.toHaveBeenCalled();
  });

  it('does nothing when the per-task toggle is off', async () => {
    const result = await syncDeadlineEvent(makeTask({ deadlineOnCalendar: false, deadline: '2026-08-20T00:00:00Z' }));
    expect(result).toEqual(NO_EVENT_LINK);
    expect(mockCreateDeadlineEvent).not.toHaveBeenCalled();
  });

  it('does nothing when there is no deadline', async () => {
    const result = await syncDeadlineEvent(makeTask({ deadlineOnCalendar: true, deadline: null }));
    expect(result).toEqual(NO_EVENT_LINK);
    expect(mockCreateDeadlineEvent).not.toHaveBeenCalled();
  });

  it('deletes the existing event and links nothing when the toggle is off but an event still exists', async () => {
    const task = makeTask({ deadlineOnCalendar: false, deadline: '2026-08-20T00:00:00Z', calendarEventId: 'evt-1' });
    const result = await syncDeadlineEvent(task);
    expect(result).toEqual(NO_EVENT_LINK);
    expect(mockDeleteDeadlineEvent).toHaveBeenCalledWith('evt-1');
  });

  it('deletes the existing event when the deadline is cleared', async () => {
    const task = makeTask({ deadlineOnCalendar: true, deadline: null, calendarEventId: 'evt-1' });
    const result = await syncDeadlineEvent(task);
    expect(result).toEqual(NO_EVENT_LINK);
    expect(mockDeleteDeadlineEvent).toHaveBeenCalledWith('evt-1');
  });

  it('deletes the existing event when the task is completed', async () => {
    const task = makeTask({
      deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z', calendarEventId: 'evt-1', completed: true,
    });
    const result = await syncDeadlineEvent(task);
    expect(result).toEqual(NO_EVENT_LINK);
    expect(mockDeleteDeadlineEvent).toHaveBeenCalledWith('evt-1');
  });

  it('deletes the existing event when the task is archived', async () => {
    const task = makeTask({
      deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z', calendarEventId: 'evt-1', archived: true,
    });
    const result = await syncDeadlineEvent(task);
    expect(result).toEqual(NO_EVENT_LINK);
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
    expect(result).toEqual(linked('new-evt'));
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
    expect(result).toEqual(linked('evt-1'));
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
    expect(await syncDeadlineEvent(task)).toEqual(linked('evt-moved'));
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
    expect(result).toEqual(linked('fresh-evt'));
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

  it('writes a timed event when the deadline has a time of day', async () => {
    mockCreateDeadlineEvent.mockResolvedValue('evt');
    const deadline = new Date(2026, 7, 20, 12, 0).toISOString();
    await syncDeadlineEvent(makeTask({ deadlineOnCalendar: true, deadline, deadlineTime: '17:00', title: 'Renew passport' }));
    expect(mockCreateDeadlineEvent).toHaveBeenCalledWith('cal-1', {
      title: 'Renew passport',
      date: new Date(deadline),
      timed: { start: new Date(2026, 7, 20, 17, 0), end: new Date(2026, 7, 20, 17, 30) },
    });
  });

  it('adopts a restored timed event by its server id', async () => {
    mockMoveDeadlineEvent.mockImplementation((id: string) => Promise.resolve(id === 'evt-old-phone' ? null : id));
    mockEventsWithExternalId.mockResolvedValue([{ id: 'evt-this-phone', allDay: false, calendarId: 'cal-1' }]);
    const link = await syncDeadlineEvent(makeTask({
      deadlineOnCalendar: true, deadline: new Date(2026, 7, 20, 12, 0).toISOString(), deadlineTime: '09:00',
      calendarEventId: 'evt-old-phone', calendarEventExternalId: 'ext-1',
    }));
    expect(link.eventId).toBe('evt-this-phone');
    expect(mockCreateDeadlineEvent).not.toHaveBeenCalled();
  });

  it('never touches the device calendar while demo mode is active', async () => {
    // #1629's sibling: latent today since demo-seeded tasks never set
    // deadlineOnCalendar, but a future seed change shouldn't get a free
    // pass to write a real device event just because this guard is missing.
    mockDemoActive = true;
    const task = makeTask({
      deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z', calendarEventId: 'evt-1',
    });
    expect(await syncDeadlineEvent(task)).toEqual(NO_EVENT_LINK);
    expect(mockCreateDeadlineEvent).not.toHaveBeenCalled();
    expect(mockMoveDeadlineEvent).not.toHaveBeenCalled();
    expect(mockDeleteDeadlineEvent).not.toHaveBeenCalled();
  });

  // #2950: the server id is what finds the event again after a restore.
  it('links the server id of the event it writes', async () => {
    mockExternalIds.mockImplementation((ids: string[]) => Promise.resolve({ [ids[0]]: `ext-${ids[0]}` }));
    mockCreateDeadlineEvent.mockResolvedValue('new-evt');
    const task = makeTask({ deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z' });
    expect(await syncDeadlineEvent(task)).toEqual({ eventId: 'new-evt', externalId: 'ext-new-evt' });
  });

  it('finds a restored backup\'s event by its server id rather than writing a second one', async () => {
    // The old phone's local id names nothing on this one.
    mockMoveDeadlineEvent.mockImplementation((id: string) => Promise.resolve(id === 'evt-old-phone' ? null : id));
    mockEventsWithExternalId.mockResolvedValue([{ id: 'evt-this-phone', allDay: true, calendarId: 'cal-1' }]);
    const task = makeTask({
      deadlineOnCalendar: true, deadline: '2026-08-21T00:00:00Z', title: 'Renew passport',
      calendarEventId: 'evt-old-phone', calendarEventExternalId: 'ext-1',
    });

    expect(await syncDeadlineEvent(task)).toEqual({ eventId: 'evt-this-phone', externalId: 'ext-1' });
    expect(mockEventsWithExternalId).toHaveBeenCalledWith('ext-1');
    expect(mockMoveDeadlineEvent).toHaveBeenLastCalledWith('evt-this-phone', 'cal-1', {
      title: 'Renew passport',
      date: new Date('2026-08-21T00:00:00Z'),
    });
    expect(mockCreateDeadlineEvent).not.toHaveBeenCalled();
  });

  it('deletes by the local id while it still names the event, and links nothing', async () => {
    const task = makeTask({
      deadlineOnCalendar: false, deadline: '2026-08-20T00:00:00Z',
      calendarEventId: 'evt-1', calendarEventExternalId: 'ext-1',
    });
    expect(await syncDeadlineEvent(task)).toEqual(NO_EVENT_LINK);
    expect(mockDeleteDeadlineEvent).toHaveBeenCalledWith('evt-1');
    expect(mockEventsWithExternalId).not.toHaveBeenCalled();
  });

  it('deletes the event found by its server id when the local id names nothing here', async () => {
    // A backup restored on a new phone: the old phone's local id is gone.
    mockEventExists.mockResolvedValueOnce(false);
    mockEventsWithExternalId.mockResolvedValue([{ id: 'evt-this-phone', allDay: true, calendarId: 'cal-1' }]);
    const task = makeTask({
      deadlineOnCalendar: false, deadline: '2026-08-20T00:00:00Z',
      calendarEventId: 'evt-old-phone', calendarEventExternalId: 'ext-1',
    });
    expect(await syncDeadlineEvent(task)).toEqual(NO_EVENT_LINK);
    expect(mockEventsWithExternalId).toHaveBeenCalledWith('ext-1');
    expect(mockDeleteDeadlineEvent).toHaveBeenCalledTimes(1);
    expect(mockDeleteDeadlineEvent).toHaveBeenCalledWith('evt-this-phone');
  });

  it('deletes nothing it would have to guess at among copies under one server id', async () => {
    mockEventExists.mockResolvedValueOnce(false);
    // Two all-day copies, neither in the deadline calendar picked now.
    mockEventsWithExternalId.mockResolvedValue([
      { id: 'evt-a', allDay: true, calendarId: 'cal-x' },
      { id: 'evt-b', allDay: true, calendarId: 'cal-y' },
    ]);
    const task = makeTask({
      deadlineOnCalendar: false, deadline: '2026-08-20T00:00:00Z',
      calendarEventId: 'evt-old-phone', calendarEventExternalId: 'ext-1',
    });
    await syncDeadlineEvent(task);
    expect(mockDeleteDeadlineEvent).not.toHaveBeenCalled();
  });

  it('never looks a row up by server id when it holds none', async () => {
    mockEventExists.mockResolvedValueOnce(false);
    const task = makeTask({
      deadlineOnCalendar: false, deadline: '2026-08-20T00:00:00Z',
      calendarEventId: 'evt-1', calendarEventExternalId: null,
    });
    await syncDeadlineEvent(task);
    expect(mockEventExists).not.toHaveBeenCalled();
    expect(mockEventsWithExternalId).not.toHaveBeenCalled();
    expect(mockDeleteDeadlineEvent).toHaveBeenCalledWith('evt-1');
  });
});

// #2950. A task's deadline event and time block belong to the device that
// wrote them, so a peer's rename, new deadline, completion or delete reaches
// them only through this.
describe('taskEventsAfterSync', () => {
  const applied = (over: Partial<ApplyReport>) => ({ ...emptyApplyReport(), ...over });
  const lookup = (...rows: Task[]) => (id: string) => rows.find(r => r.id === id) ?? null;

  it('reconciles the deadline event of a changed task that holds one of this device\'s', () => {
    const renamed = makeTask({ id: 't1', title: 'Pay rent', calendarEventId: 'evt-1' });

    const plan = taskEventsAfterSync(applied({ taskIds: ['t1'] }), lookup(renamed));

    expect(plan).toEqual({ deadlines: [renamed], timeBlocks: [], uncompleted: [], remove: [] });
  });

  it('retitles the time block of a changed task that holds one, apart from its deadline event', () => {
    const blocked = makeTask({ id: 't1', timeBlockEventId: 'block-1' });
    const both = makeTask({ id: 't2', calendarEventId: 'evt-2', timeBlockEventId: 'block-2' });

    const plan = taskEventsAfterSync(applied({ taskIds: ['t1', 't2'] }), lookup(blocked, both));

    expect(plan.deadlines).toEqual([both]);
    expect(plan.timeBlocks).toEqual([blocked, both]);
  });

  it('leaves a changed task with no event here alone, rather than writing one', () => {
    // Every task that arrives new is this shape, since the ids never sync, and
    // so is the successor a completion elsewhere spawned. The completing device
    // writes that one's deadline, maybe into the same shared calendar.
    const plan = taskEventsAfterSync(
      applied({ taskIds: ['t1'] }),
      lookup(makeTask({ id: 't1', deadlineOnCalendar: true, deadline: '2026-08-20T00:00:00Z' })),
    );

    expect(plan).toEqual({ deadlines: [], timeBlocks: [], uncompleted: [], remove: [] });
  });

  it('skips a task that no longer resolves, and reconciles one changed twice only once', () => {
    const kept = makeTask({ id: 't1', calendarEventId: 'evt-1', timeBlockEventId: 'block-1' });

    const plan = taskEventsAfterSync(applied({ taskIds: ['t1', 'gone', 't1'] }), lookup(kept));

    expect(plan.deadlines).toEqual([kept]);
    expect(plan.timeBlocks).toEqual([kept]);
  });

  // The completion event is this device's too, and a peer's uncomplete used to
  // leave it on this device's calendar recording a completion that was undone.
  it('takes the completion event of a task another device reopened, as an uncomplete here would', () => {
    const reopened = makeTask({ id: 't1', completed: false, completionCalendarEventId: 'done-1' });

    const plan = taskEventsAfterSync(applied({ taskIds: ['t1', 't1'] }), lookup(reopened));

    expect(plan.uncompleted).toEqual([reopened]);
    expect(plan.deadlines).toEqual([]);
  });

  it('leaves the completion event of a task still completed, whatever else changed', () => {
    const renamed = makeTask({
      id: 't1', title: 'Paid rent', completed: true, completedAt: '2026-08-19T09:00:00.000Z',
      completionCalendarEventId: 'done-1',
    });

    const plan = taskEventsAfterSync(applied({ taskIds: ['t1'] }), lookup(renamed));

    expect(plan.uncompleted).toEqual([]);
  });

  it('has nothing to take from a reopened task whose completion event another device wrote', () => {
    // This device completed nothing, so it holds no completion event to delete.
    const plan = taskEventsAfterSync(applied({ taskIds: ['t1'] }), lookup(makeTask({ id: 't1', completed: false })));

    expect(plan.uncompleted).toEqual([]);
  });

  it('deletes the deadline event of a task another device removed, once', () => {
    // Whatever removed it, the purge of old completions included: a completed
    // task's deadline event is one syncDeadlineEvent deletes anyway, so there
    // is no history here to keep the way the meal purge keeps its events.
    const plan = taskEventsAfterSync(applied({ removedTaskEvents: [{ eventId: 'evt-9', externalId: null }, { eventId: 'evt-9', externalId: null }] }), lookup());

    expect(plan.remove).toEqual([{ eventId: 'evt-9', externalId: null }]);
  });

  it('asks for nothing at all in demo mode', () => {
    mockDemoActive = true;

    const plan = taskEventsAfterSync(
      applied({ taskIds: ['t1'], removedTaskEvents: [{ eventId: 'evt-9', externalId: null }] }),
      lookup(makeTask({
        id: 't1', calendarEventId: 'evt-1', timeBlockEventId: 'block-1', completionCalendarEventId: 'done-1',
      })),
    );

    expect(plan).toEqual({ deadlines: [], timeBlocks: [], uncompleted: [], remove: [] });
  });
});
