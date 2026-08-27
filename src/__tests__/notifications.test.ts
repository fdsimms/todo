import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Task } from '../types';
import { nextAgendaTime } from '../utils/dailyAgenda';
import { ALARM_MAX_RINGS, ALARM_RING_INTERVAL_MINUTES, stepTimerAlarmUuid, taskAlarmUuid } from '../utils/alarmChain';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationCategoryAsync: jest.fn().mockResolvedValue(undefined),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  cancelAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(undefined),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('test-id'),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

// Off by default — most tests exercise the plain-notification path. Tests
// covering AlarmKit branching flip `mockAlarmKitAvailable` before importing
// behavior that reads it, and reset it in afterEach.
let mockAlarmKitAvailable = false;
jest.mock('todo-alarmkit-bridge', () => ({
  isAlarmKitAvailable: jest.fn(() => mockAlarmKitAvailable),
  requestAlarmAuthorization: jest.fn().mockResolvedValue('authorized'),
  scheduleNativeAlarm: jest.fn().mockResolvedValue(true),
  cancelNativeAlarm: jest.fn().mockResolvedValue(true),
}));

// Mutable so the daily-agenda tests can drive the settings it reads. Safe to
// close over even though the import below is hoisted above this declaration:
// getState is only ever called from inside a scheduling function, never while
// the module is being imported.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSettings: Record<string, any> = {};
const DEFAULT_MOCK_SETTINGS = {
  dayResetTime: '00:00',
  vacationMode: false,
  dailyAgendaEnabled: false,
  dailyAgendaTime: '08:00',
  tripReminderEnabled: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  calendarReadEnabled: false,
  reminderMeetingNudgeEnabled: true,
  activeHoursStart: '08:00',
  activeHoursEnd: '22:00',
};

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCalendar: Record<string, any> = { events: [], loaded: false };
jest.mock('../store/useCalendarStore', () => ({
  useCalendarStore: { getState: () => mockCalendar },
}));

jest.mock('../store/useCategoryStore', () => ({
  useCategoryStore: { getState: () => ({ categories: [], getCategoryByName: () => null }) },
}));

import {
  requestNotificationPermissions,
  scheduleTaskReminder,
  cancelTaskReminder,
  rescheduleAllReminders,
  scheduleTimerAlarm,
  cancelTimerAlarm,
  rescheduleAllTimerAlarms,
  scheduleStepAlarm,
  cancelStepAlarm,
  getNotificationPermission,
  upcomingReminders,
  pendingReminderStats,
  MAX_PENDING_REMINDERS,
  scheduleDailyAgenda,
  cancelDailyAgenda,
  isWithinQuietHours,
  deferPastQuietHours,
  scheduleTripReminder,
  cancelTripReminder,
  rescheduleTripReminder,
  scheduleEventReminder,
  cancelEventReminder,
  rescheduleAllEventReminders,
  TASK_REMINDER_CATEGORY,
  scheduleQuotaNudges,
  cancelQuotaNudges,
  quotaNudgeTasks,
  MAX_QUOTA_NUDGES_AHEAD,
} from '../utils/notifications';
import { scheduleNativeAlarm, cancelNativeAlarm } from 'todo-alarmkit-bridge';
import { setDemoModeActive } from '../utils/demoState';
import type { EventReminder } from '../utils/eventReminders';
import type { Shop, StepTimer } from '../types';

const FUTURE = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const PAST   = new Date(Date.now() - 10 * 60 * 1000).toISOString();

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  missedAt: null,
  autoScheduledAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
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
  quotaStartedAt: null,
  progressCount: 0,
  tags: [],
  sortOrder: 1,
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
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  reminderKind: 'notification',
  reminderOffsetDays: null,
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  extraTaskEveryN: null,
  extraTaskTitle: null,
  extraTaskDraft: null,
  extraTaskTally: 0,
  previousExtraTaskTally: 0,
  category: null,
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
  emailAddress: null, location: null,
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
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (Platform as any).OS = 'ios';
  for (const key of Object.keys(mockSettings)) delete mockSettings[key];
  Object.assign(mockSettings, DEFAULT_MOCK_SETTINGS);
  mockCalendar.events = [];
  mockCalendar.loaded = false;
  mockAlarmKitAvailable = false;
});

// ─── requestNotificationPermissions ──────────────────────────────────────────

describe('requestNotificationPermissions', () => {
  it('returns false on web without calling any Notifications API', async () => {
    (Platform as any).OS = 'web';
    const result = await requestNotificationPermissions();
    expect(result).toBe(false);
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });

  it('returns true immediately when permission is already granted', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    const result = await requestNotificationPermissions();
    expect(result).toBe(true);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('requests permission when not yet granted and returns true if approved', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    const result = await requestNotificationPermissions();
    expect(result).toBe(true);
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('returns false when permission request is denied', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    expect(await requestNotificationPermissions()).toBe(false);
  });
});

// ─── scheduleTaskReminder ─────────────────────────────────────────────────────

describe('scheduleTaskReminder', () => {
  it('does nothing when task has no reminderTime', async () => {
    await scheduleTaskReminder(makeTask({ reminderTime: null }));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalled();
  });

  it('does nothing when task is completed', async () => {
    await scheduleTaskReminder(makeTask({ reminderTime: FUTURE, completed: true }));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does nothing when reminderTime is in the past', async () => {
    await scheduleTaskReminder(makeTask({ reminderTime: PAST }));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels existing then schedules new notification for a future reminderTime', async () => {
    const task = makeTask({ id: 'task-abc', title: 'Meeting prep', reminderTime: FUTURE });
    await scheduleTaskReminder(task);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('task-abc');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.identifier).toBe('task-abc');
    expect(arg.content.title).toBe('Meeting prep');
    expect(arg.content.data).toEqual({ taskId: 'task-abc' });
  });

  it('carries the task-reminder category, so Complete/Snooze actions show', async () => {
    await scheduleTaskReminder(makeTask({ id: 'task-cat', reminderTime: FUTURE }));
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.content.categoryIdentifier).toBe(TASK_REMINDER_CATEGORY);
  });

  it('falls back to "Task reminder" when title is empty', async () => {
    await scheduleTaskReminder(makeTask({ title: '', reminderTime: FUTURE }));
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.content.title).toBe('Task reminder');
  });

  it('uses notes as notification body', async () => {
    await scheduleTaskReminder(makeTask({ notes: 'Bring passport', reminderTime: FUTURE }));
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.content.body).toBe('Bring passport');
  });

  it('falls back to generic body when notes is empty', async () => {
    await scheduleTaskReminder(makeTask({ notes: '', reminderTime: FUTURE }));
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.content.body).toBe('You have a task coming up');
  });

  it('schedules a plain notification for reminderKind "alarm" when AlarmKit is unavailable', async () => {
    mockAlarmKitAvailable = false;
    await scheduleTaskReminder(makeTask({ reminderTime: FUTURE, reminderKind: 'alarm' }));
    expect(scheduleNativeAlarm).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('schedules a native alarm instead of a notification when reminderKind is "alarm" and AlarmKit is available', async () => {
    mockAlarmKitAvailable = true;
    const task = makeTask({ id: 'task-alarm', title: 'Wake up', reminderTime: FUTURE, reminderKind: 'alarm' });
    await scheduleTaskReminder(task);
    // The derived UUID, not the bare task id: AlarmKit rejects a non-UUID id,
    // which is why passing 'task-alarm' straight through scheduled nothing.
    expect(scheduleNativeAlarm).toHaveBeenCalledWith(taskAlarmUuid('task-alarm', 0), new Date(FUTURE), 'Wake up');
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    // Still clears any stale plain notification left behind by a prior 'notification'-kind schedule.
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('task-alarm');
  });

  it('schedules an alarm id AlarmKit can actually parse as a UUID', async () => {
    mockAlarmKitAvailable = true;
    await scheduleTaskReminder(makeTask({ id: 'm1a2b3c4d5e6f', reminderTime: FUTURE, reminderKind: 'alarm' }));
    const id = (scheduleNativeAlarm as jest.Mock).mock.calls[0][0];
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('rings a "persistent" reminder repeatedly, starting at the reminder time', async () => {
    mockAlarmKitAvailable = true;
    const task = makeTask({ id: 'nag', title: 'Take pills', reminderTime: FUTURE, reminderKind: 'persistent' });
    await scheduleTaskReminder(task);
    expect(scheduleNativeAlarm).toHaveBeenCalledTimes(ALARM_MAX_RINGS);

    const calls = (scheduleNativeAlarm as jest.Mock).mock.calls;
    expect(calls[0]).toEqual([taskAlarmUuid('nag', 0), new Date(FUTURE), 'Take pills']);
    // Each ring one interval after the last, under its own id.
    expect(calls[1][0]).toBe(taskAlarmUuid('nag', 1));
    expect(calls[1][1].getTime() - calls[0][1].getTime()).toBe(ALARM_RING_INTERVAL_MINUTES * 60 * 1000);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('rings a "persistent" reminder once as a plain notification when AlarmKit is unavailable', async () => {
    mockAlarmKitAvailable = false;
    await scheduleTaskReminder(makeTask({ reminderTime: FUTURE, reminderKind: 'persistent' }));
    expect(scheduleNativeAlarm).not.toHaveBeenCalled();
    // Not twelve pushes five minutes apart — see ringCountFor.
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('clears the previous chain before laying down a new one', async () => {
    mockAlarmKitAvailable = true;
    await scheduleTaskReminder(makeTask({ id: 'nag', reminderTime: FUTURE, reminderKind: 'alarm' }));
    // Shrinking a chain to one ring must not strand rings 1..N-1.
    expect(cancelNativeAlarm).toHaveBeenCalledWith(taskAlarmUuid('nag', ALARM_MAX_RINGS - 1));
  });

  it('stops a persistent chain at the quiet-hours boundary rather than deferring the rest', async () => {
    mockAlarmKitAvailable = true;
    // Reminder lands 10 minutes before quiet hours open, so only rings at
    // +0 and +5 are outside the window.
    //
    // Tomorrow at 21:50, not today's: this needs a specific *clock* time, and
    // pinning one onto today's date puts it in the past for anyone running the
    // suite after 21:50 — `scheduleTaskReminder` drops a past reminder before
    // it lays down any rings, so the whole chain silently became zero and this
    // failed every evening.
    const base = new Date(Date.now() + 24 * 60 * 60 * 1000);
    base.setHours(21, 50, 0, 0);
    mockSettings.quietHoursStart = '22:00';
    mockSettings.quietHoursEnd = '07:00';
    await scheduleTaskReminder(
      makeTask({ id: 'nag', reminderTime: base.toISOString(), reminderKind: 'persistent' })
    );
    expect(scheduleNativeAlarm).toHaveBeenCalledTimes(2);
  });

  it('clears any stale native alarm when scheduling a plain notification', async () => {
    mockAlarmKitAvailable = true;
    await scheduleTaskReminder(makeTask({ id: 'task-1', reminderTime: FUTURE, reminderKind: 'notification' }));
    expect(cancelNativeAlarm).toHaveBeenCalledWith(taskAlarmUuid('task-1', 0));
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });
});

// ─── cancelTaskReminder ───────────────────────────────────────────────────────

describe('cancelTaskReminder', () => {
  it('calls cancelScheduledNotificationAsync with the task id', async () => {
    await cancelTaskReminder('my-task-id');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('my-task-id');
  });

  it('does not throw when the native call rejects', async () => {
    (Notifications.cancelScheduledNotificationAsync as jest.Mock).mockRejectedValueOnce(
      new Error('native error'),
    );
    await expect(cancelTaskReminder('task-1')).resolves.toBeUndefined();
  });

  it('cancels from both the notification and AlarmKit backends unconditionally', async () => {
    await cancelTaskReminder('my-task-id');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('my-task-id');
    expect(cancelNativeAlarm).toHaveBeenCalledWith(taskAlarmUuid('my-task-id', 0));
  });

  // This is what makes "rings until you complete it" terminate: completeTask
  // calls cancelTaskReminder with an id and nothing else, so the cancel has to
  // name every ring without knowing the reminder's kind.
  it('cancels every ring of a persistent chain, not just the first', async () => {
    await cancelTaskReminder('nag');
    for (let i = 0; i < ALARM_MAX_RINGS; i++) {
      expect(cancelNativeAlarm).toHaveBeenCalledWith(taskAlarmUuid('nag', i));
    }
  });

  it('does not throw when a native alarm cancel rejects mid-chain', async () => {
    (cancelNativeAlarm as jest.Mock).mockRejectedValueOnce(new Error('native error'));
    await expect(cancelTaskReminder('nag')).resolves.toBeUndefined();
  });
});

// ─── rescheduleAllReminders ───────────────────────────────────────────────────

describe('rescheduleAllReminders', () => {
  it('never blanket-cancels — every kind cancels on its own terms instead', async () => {
    const task = makeTask({ id: 'task-1', completed: true, reminderTime: FUTURE });
    await rescheduleAllReminders([task]);
    expect(Notifications.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule a completed task', async () => {
    const task = makeTask({ id: 'task-1', completed: true, reminderTime: FUTURE });
    await rescheduleAllReminders([task]);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule a task with no reminderTime', async () => {
    const task = makeTask({ id: 'task-2', reminderTime: null });
    await rescheduleAllReminders([task]);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule a task whose reminderTime is in the past', async () => {
    const task = makeTask({ id: 'task-3', reminderTime: PAST });
    await rescheduleAllReminders([task]);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules reminder for a task with a future reminderTime', async () => {
    const task = makeTask({ id: 'task-4', reminderTime: FUTURE });
    await rescheduleAllReminders([task]);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('handles mixed tasks correctly', async () => {
    const tasks = [
      makeTask({ id: 'a', completed: true, reminderTime: FUTURE }),
      makeTask({ id: 'b', reminderTime: FUTURE }),
    ];
    await rescheduleAllReminders(tasks);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.identifier).toBe('b');
  });

  it('reschedules alarm-kind reminders through AlarmKit, uncapped and independent of the notification cap', async () => {
    mockAlarmKitAvailable = true;
    const alarmTasks = Array.from({ length: 70 }, (_, i) =>
      makeTask({
        id: `alarm-${i}`,
        reminderKind: 'alarm',
        reminderTime: new Date(Date.now() + (70 - i) * 60 * 1000).toISOString(),
      })
    );
    await rescheduleAllReminders(alarmTasks);
    expect(scheduleNativeAlarm).toHaveBeenCalledTimes(70);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('caps only notification-kind reminders, leaving alarm-kind reminders unaffected by the same rebuild', async () => {
    mockAlarmKitAvailable = true;
    const tasks = [
      ...Array.from({ length: 70 }, (_, i) =>
        makeTask({ id: `notif-${i}`, reminderTime: new Date(Date.now() + (70 - i) * 60 * 1000).toISOString() })
      ),
      makeTask({ id: 'alarm-1', reminderKind: 'alarm', reminderTime: FUTURE }),
    ];
    await rescheduleAllReminders(tasks);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(64);
    expect(scheduleNativeAlarm).toHaveBeenCalledTimes(1);
    expect(scheduleNativeAlarm).toHaveBeenCalledWith(taskAlarmUuid('alarm-1', 0), new Date(FUTURE), expect.any(String));
  });

  it('schedules only the nearest MAX_PENDING_REMINDERS upcoming reminders, soonest first', async () => {
    const tasks = Array.from({ length: 70 }, (_, i) =>
      makeTask({
        id: `task-${i}`,
        reminderTime: new Date(Date.now() + (70 - i) * 60 * 1000).toISOString(),
      })
    );
    await rescheduleAllReminders(tasks);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(64);
    const scheduledIds = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.map(
      call => call[0].identifier
    );
    expect(scheduledIds).toContain('task-69');
    expect(scheduledIds).not.toContain('task-0');
  });

  it('handles an empty list without error', async () => {
    await expect(rescheduleAllReminders([])).resolves.toBeUndefined();
  });
});

// ─── timer alarms ───

describe('scheduleTimerAlarm', () => {
  beforeEach(() => jest.clearAllMocks());

  it('namespaces the identifier so it cannot collide with the task reminder', async () => {
    await scheduleTimerAlarm(
      makeTask({ id: 'task-1', timedMinutes: 15, timerStartedAt: new Date().toISOString() })
    );
    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.identifier).toBe('timer:task-1');
    expect(call.identifier).not.toBe('task-1');
  });

  it('fires at the remaining time, not the full duration', async () => {
    // 15-minute target, 10 minutes already banked → 5 minutes left.
    await scheduleTimerAlarm(
      makeTask({
        id: 'task-1',
        timedMinutes: 15,
        timerElapsedSeconds: 10 * 60,
        timerStartedAt: new Date().toISOString(),
      })
    );
    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    const msOut = new Date(call.trigger.date).getTime() - Date.now();
    expect(msOut).toBeGreaterThan(4.5 * 60 * 1000);
    expect(msOut).toBeLessThan(5.5 * 60 * 1000);
  });

  it('does not schedule for a task with no duration', async () => {
    await scheduleTimerAlarm(makeTask({ timerStartedAt: new Date().toISOString() }));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule while the timer is paused', async () => {
    await scheduleTimerAlarm(makeTask({ timedMinutes: 15, timerElapsedSeconds: 60 }));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule when the countdown has already run out', async () => {
    await scheduleTimerAlarm(
      makeTask({
        timedMinutes: 15,
        timerElapsedSeconds: 20 * 60,
        timerStartedAt: new Date().toISOString(),
      })
    );
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule for a completed or archived task', async () => {
    const running = { timedMinutes: 15, timerStartedAt: new Date().toISOString() };
    await scheduleTimerAlarm(makeTask({ ...running, completed: true }));
    await scheduleTimerAlarm(makeTask({ ...running, archived: true }));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

const makeShop = (overrides: Partial<Shop> = {}): Shop => ({
  id: 'shop-1',
  name: 'Costco',
  nameKey: 'costco',
  sortOrder: 0,
  createdAt: '2025-01-01T00:00:00.000Z',
  excludeFromSuggestions: false,
    receiptStyle: 'itemized' as const,
  ...overrides,
});

describe('scheduleTripReminder', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not schedule when the setting is off', async () => {
    mockSettings.tripReminderEnabled = false;
    await scheduleTripReminder('Costco', new Date().toISOString());
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules two hours out, naming the store, when the setting is on', async () => {
    mockSettings.tripReminderEnabled = true;
    const startedAt = new Date().toISOString();
    await scheduleTripReminder('Costco', startedAt);
    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.identifier).toBe('active-trip-reminder');
    expect(call.content.body).toContain('Costco');
    const msOut = new Date(call.trigger.date).getTime() - Date.parse(startedAt);
    expect(msOut).toBe(2 * 60 * 60 * 1000);
  });

  it('cancels rather than schedules once the two-hour mark has already passed', async () => {
    mockSettings.tripReminderEnabled = true;
    const startedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    await scheduleTripReminder('Costco', startedAt);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('suppresses rather than defers a trigger landing in quiet hours', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 1, 20, 30)); // 8:30pm
    mockSettings.tripReminderEnabled = true;
    mockSettings.quietHoursStart = '22:00';
    mockSettings.quietHoursEnd = '07:00';
    // Two hours out lands at 10:30pm — inside the window.
    await scheduleTripReminder('Costco', new Date().toISOString());
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('always cancels the previous one first, whatever the setting', async () => {
    mockSettings.tripReminderEnabled = false;
    await scheduleTripReminder('Costco', new Date().toISOString());
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('active-trip-reminder');
  });
});

const makeEventReminder = (overrides: Partial<EventReminder> = {}): EventReminder => ({
  key: 'evt-1|2026-01-01T09:00:00.000Z',
  eventId: 'evt-1',
  // 30 minutes out with a 15-minute offset leaves the trigger itself 15
  // minutes in the future — comfortable headroom against real-clock drift
  // between building this fixture and the assertion running.
  eventStart: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  eventTitle: 'Standup',
  offsetMinutes: 15,
  ...overrides,
});

describe('scheduleEventReminder', () => {
  beforeEach(() => jest.clearAllMocks());

  it('schedules offsetMinutes before the event start, namespaced by key', async () => {
    const reminder = makeEventReminder({ eventStart: new Date(Date.now() + 20 * 60 * 1000).toISOString(), offsetMinutes: 5 });
    await scheduleEventReminder(reminder);
    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.identifier).toBe(`event-reminder:${reminder.key}`);
    expect(call.content.title).toBe('Standup');
    const msBefore = Date.parse(reminder.eventStart) - new Date(call.trigger.date).getTime();
    expect(msBefore).toBe(5 * 60 * 1000);
  });

  it('always cancels the previous one first, by the same namespaced id', async () => {
    const reminder = makeEventReminder();
    await scheduleEventReminder(reminder);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(`event-reminder:${reminder.key}`);
  });

  it('does not schedule once the trigger moment has already passed', async () => {
    const reminder = makeEventReminder({ eventStart: new Date().toISOString(), offsetMinutes: 30 });
    await scheduleEventReminder(reminder);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('suppresses rather than defers a trigger landing in quiet hours', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 0, 1, 21, 50)); // 9:50pm
    mockSettings.quietHoursStart = '22:00';
    mockSettings.quietHoursEnd = '07:00';
    // 15 minutes before a 10:20pm meeting lands the trigger at 10:05pm —
    // inside the window, and still ahead of the 9:50pm "now" above.
    const eventStart = new Date(2026, 0, 1, 22, 20);
    const reminder = makeEventReminder({ eventStart: eventStart.toISOString(), offsetMinutes: 15 });
    await scheduleEventReminder(reminder);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

describe('cancelEventReminder', () => {
  it('cancels by the namespaced id', async () => {
    jest.clearAllMocks();
    await cancelEventReminder('evt-1|2026-01-01T09:00:00.000Z');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('event-reminder:evt-1|2026-01-01T09:00:00.000Z');
  });
});

describe('rescheduleAllEventReminders', () => {
  it('schedules every reminder passed in', async () => {
    jest.clearAllMocks();
    const reminders = [makeEventReminder({ key: 'a' }), makeEventReminder({ key: 'b', eventId: 'evt-2' })];
    await rescheduleAllEventReminders(reminders);
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('does nothing for an empty list', async () => {
    jest.clearAllMocks();
    await rescheduleAllEventReminders([]);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('cancelTripReminder', () => {
  it('cancels the fixed identifier', async () => {
    jest.clearAllMocks();
    await cancelTripReminder();
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('active-trip-reminder');
  });
});

describe('rescheduleTripReminder', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reschedules against a live trip', async () => {
    mockSettings.tripReminderEnabled = true;
    const costco = makeShop();
    const startedAt = new Date().toISOString();
    await rescheduleTripReminder(costco.id, startedAt, [costco]);
    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.body).toContain('Costco');
  });

  it('cancels rather than schedules when there is no active trip', async () => {
    await rescheduleTripReminder(null, null, []);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('active-trip-reminder');
  });

  it('cancels rather than schedules when the trip has aged out', async () => {
    const costco = makeShop();
    const startedAt = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
    await rescheduleTripReminder(costco.id, startedAt, [costco]);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels rather than schedules when the shop no longer exists', async () => {
    const startedAt = new Date().toISOString();
    await rescheduleTripReminder('gone', startedAt, []);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

// ─── quiet hours ────────────────────────────────────────────────────────────

describe('isWithinQuietHours', () => {
  const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m, 0, 0);

  it('is false when either bound is null (off)', () => {
    expect(isWithinQuietHours(at(23), null, '07:00')).toBe(false);
    expect(isWithinQuietHours(at(23), '22:00', null)).toBe(false);
    expect(isWithinQuietHours(at(23), null, null)).toBe(false);
  });

  it('is false for an equal start/end (zero-length window)', () => {
    expect(isWithinQuietHours(at(22), '22:00', '22:00')).toBe(false);
  });

  it('handles a same-day window normally', () => {
    expect(isWithinQuietHours(at(13, 30), '13:00', '15:00')).toBe(true);
    expect(isWithinQuietHours(at(12, 59), '13:00', '15:00')).toBe(false);
    expect(isWithinQuietHours(at(15, 0), '13:00', '15:00')).toBe(false); // end exclusive
  });

  it('treats an overnight window as inside on either side of midnight', () => {
    expect(isWithinQuietHours(at(23), '22:00', '07:00')).toBe(true);  // before midnight
    expect(isWithinQuietHours(at(3), '22:00', '07:00')).toBe(true);   // after midnight
    expect(isWithinQuietHours(at(12), '22:00', '07:00')).toBe(false); // broad daylight
    expect(isWithinQuietHours(at(7), '22:00', '07:00')).toBe(false);  // end exclusive
  });
});

describe('deferPastQuietHours', () => {
  it('passes a date outside the window through unchanged', () => {
    const date = new Date(2026, 0, 1, 12, 0);
    expect(deferPastQuietHours(date, '22:00', '07:00')).toBe(date);
  });

  it('passes a date through unchanged when quiet hours are off', () => {
    const date = new Date(2026, 0, 1, 3, 0);
    expect(deferPastQuietHours(date, null, null)).toBe(date);
  });

  it('defers to the same-day close for a same-day window', () => {
    const date = new Date(2026, 0, 1, 13, 30);
    const result = deferPastQuietHours(date, '13:00', '15:00');
    expect(result.toISOString()).toBe(new Date(2026, 0, 1, 15, 0).toISOString());
  });

  it('defers an overnight-window early-morning trigger to that same day\'s close', () => {
    const date = new Date(2026, 0, 2, 3, 0); // 3am, inside 22:00–07:00
    const result = deferPastQuietHours(date, '22:00', '07:00');
    expect(result.toISOString()).toBe(new Date(2026, 0, 2, 7, 0).toISOString());
  });

  it('defers an overnight-window before-midnight trigger to the next day\'s close', () => {
    const date = new Date(2026, 0, 1, 23, 0); // 11pm, inside 22:00–07:00
    const result = deferPastQuietHours(date, '22:00', '07:00');
    expect(result.toISOString()).toBe(new Date(2026, 0, 2, 7, 0).toISOString());
  });
});

describe('scheduleTaskReminder honors quiet hours by deferring', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('pushes a reminder landing in quiet hours out to the window close', async () => {
    jest.setSystemTime(new Date(2026, 0, 1, 22, 30)); // 10:30pm, inside 22:00–07:00
    mockSettings.quietHoursStart = '22:00';
    mockSettings.quietHoursEnd = '07:00';
    const reminderTime = new Date(2026, 0, 1, 23, 0).toISOString(); // 11pm — still inside
    await scheduleTaskReminder(makeTask({ id: 'quiet-1', reminderTime }));
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.trigger.date.toISOString()).toBe(new Date(2026, 0, 2, 7, 0).toISOString());
  });

  it('leaves a reminder outside quiet hours untouched', async () => {
    jest.setSystemTime(new Date(2026, 0, 1, 8, 0));
    mockSettings.quietHoursStart = '22:00';
    mockSettings.quietHoursEnd = '07:00';
    const reminderTime = new Date(2026, 0, 1, 9, 0).toISOString();
    await scheduleTaskReminder(makeTask({ id: 'quiet-2', reminderTime }));
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.trigger.date.toISOString()).toBe(new Date(reminderTime).toISOString());
  });

  it('does nothing to the trigger when quiet hours are off', async () => {
    jest.setSystemTime(new Date(2026, 0, 1, 22, 30));
    const reminderTime = new Date(2026, 0, 1, 23, 0).toISOString();
    await scheduleTaskReminder(makeTask({ id: 'quiet-3', reminderTime }));
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.trigger.date.toISOString()).toBe(new Date(reminderTime).toISOString());
  });

  it('also defers an AlarmKit alarm landing in quiet hours', async () => {
    mockAlarmKitAvailable = true;
    jest.setSystemTime(new Date(2026, 0, 1, 22, 30));
    mockSettings.quietHoursStart = '22:00';
    mockSettings.quietHoursEnd = '07:00';
    const reminderTime = new Date(2026, 0, 1, 23, 0).toISOString();
    await scheduleTaskReminder(makeTask({ id: 'quiet-alarm', reminderTime, reminderKind: 'alarm' }));
    expect(scheduleNativeAlarm).toHaveBeenCalledWith(
      taskAlarmUuid('quiet-alarm', 0), new Date(2026, 0, 2, 7, 0), expect.any(String)
    );
  });
});

describe('scheduleTaskReminder nudges a reminder out of a meeting', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const meetingEvent = (start: Date, end: Date) => ({
    id: 'evt-1', title: 'Team sync', start: start.toISOString(), end: end.toISOString(),
    allDay: false, calendarId: 'cal', location: null, status: 'confirmed', availability: 'busy',
  });

  it('moves the trigger to the meeting\'s end when calendar read is on', async () => {
    jest.setSystemTime(new Date(2026, 0, 1, 8, 0));
    mockSettings.calendarReadEnabled = true;
    mockCalendar.loaded = true;
    mockCalendar.events = [meetingEvent(new Date(2026, 0, 1, 9, 0), new Date(2026, 0, 1, 10, 0))];
    const reminderTime = new Date(2026, 0, 1, 9, 30).toISOString();
    await scheduleTaskReminder(makeTask({ id: 'meeting-1', reminderTime }));
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.trigger.date.toISOString()).toBe(new Date(2026, 0, 1, 10, 0).toISOString());
  });

  it('leaves the trigger alone when calendar read is off', async () => {
    jest.setSystemTime(new Date(2026, 0, 1, 8, 0));
    mockSettings.calendarReadEnabled = false;
    mockCalendar.loaded = true;
    mockCalendar.events = [meetingEvent(new Date(2026, 0, 1, 9, 0), new Date(2026, 0, 1, 10, 0))];
    const reminderTime = new Date(2026, 0, 1, 9, 30).toISOString();
    await scheduleTaskReminder(makeTask({ id: 'meeting-2', reminderTime }));
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.trigger.date.toISOString()).toBe(new Date(reminderTime).toISOString());
  });

  it('leaves the trigger alone when the nudge setting itself is off', async () => {
    jest.setSystemTime(new Date(2026, 0, 1, 8, 0));
    mockSettings.calendarReadEnabled = true;
    mockSettings.reminderMeetingNudgeEnabled = false;
    mockCalendar.loaded = true;
    mockCalendar.events = [meetingEvent(new Date(2026, 0, 1, 9, 0), new Date(2026, 0, 1, 10, 0))];
    const reminderTime = new Date(2026, 0, 1, 9, 30).toISOString();
    await scheduleTaskReminder(makeTask({ id: 'meeting-2b', reminderTime }));
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.trigger.date.toISOString()).toBe(new Date(reminderTime).toISOString());
  });

  it('leaves the trigger alone when the calendar window failed to load', async () => {
    jest.setSystemTime(new Date(2026, 0, 1, 8, 0));
    mockSettings.calendarReadEnabled = true;
    mockCalendar.loaded = false;
    mockCalendar.events = [meetingEvent(new Date(2026, 0, 1, 9, 0), new Date(2026, 0, 1, 10, 0))];
    const reminderTime = new Date(2026, 0, 1, 9, 30).toISOString();
    await scheduleTaskReminder(makeTask({ id: 'meeting-3', reminderTime }));
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.trigger.date.toISOString()).toBe(new Date(reminderTime).toISOString());
  });

  it('applies the meeting nudge before deferring past quiet hours', async () => {
    jest.setSystemTime(new Date(2026, 0, 1, 8, 0));
    mockSettings.calendarReadEnabled = true;
    mockSettings.quietHoursStart = '10:00';
    mockSettings.quietHoursEnd = '11:00';
    mockCalendar.loaded = true;
    // Meeting 9:30–10:15 pushes the reminder to 10:15, which now falls inside
    // quiet hours — the second defer has to see the nudged time, not the
    // original 9:45.
    mockCalendar.events = [meetingEvent(new Date(2026, 0, 1, 9, 30), new Date(2026, 0, 1, 10, 15))];
    const reminderTime = new Date(2026, 0, 1, 9, 45).toISOString();
    await scheduleTaskReminder(makeTask({ id: 'meeting-4', reminderTime }));
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.trigger.date.toISOString()).toBe(new Date(2026, 0, 1, 11, 0).toISOString());
  });
});

describe('scheduleTimerAlarm honors quiet hours by suppressing', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not schedule when the countdown would end inside quiet hours', async () => {
    jest.setSystemTime(new Date(2026, 0, 1, 22, 50)); // 10 minutes from 23:00
    mockSettings.quietHoursStart = '22:00';
    mockSettings.quietHoursEnd = '07:00';
    await scheduleTimerAlarm(
      makeTask({
        id: 'timer-quiet',
        timedMinutes: 10,
        timerStartedAt: new Date(2026, 0, 1, 22, 50).toISOString(),
      })
    );
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules normally when the countdown ends outside quiet hours', async () => {
    jest.setSystemTime(new Date(2026, 0, 1, 8, 0));
    mockSettings.quietHoursStart = '22:00';
    mockSettings.quietHoursEnd = '07:00';
    await scheduleTimerAlarm(
      makeTask({
        id: 'timer-not-quiet',
        timedMinutes: 10,
        timerStartedAt: new Date(2026, 0, 1, 8, 0).toISOString(),
      })
    );
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });
});

describe('cancelTimerAlarm', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cancels the namespaced id, leaving the task reminder alone', async () => {
    await cancelTimerAlarm('task-1');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('timer:task-1');
  });
});

describe('rescheduleAllTimerAlarms', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sweeps every timer: alarm actually pending, including ones for tasks not passed in', async () => {
    // Simulates the OS still holding an alarm from the previous session for a
    // task that's since been deleted — rescheduleAllTimerAlarms has no fixed
    // id to cancel it by, unlike the daily agenda or trip reminder, so it has
    // to find it rather than assume the task list alone accounts for it.
    (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockResolvedValueOnce([
      { identifier: 'timer:gone-task' },
      { identifier: 'timer:task-1' },
      { identifier: 'daily-agenda' },
      { identifier: 'not-a-timer-id' },
    ]);
    await rescheduleAllTimerAlarms([]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('timer:gone-task');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('timer:task-1');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('daily-agenda');
    expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('not-a-timer-id');
  });

  it('reschedules a running timer from the task list', async () => {
    const task = makeTask({ id: 'task-1', timedMinutes: 15, timerStartedAt: new Date().toISOString() });
    await rescheduleAllTimerAlarms([task]);
    const arg = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(arg.identifier).toBe('timer:task-1');
  });
});

// ─── upcomingReminders / pendingReminderStats ────────────────────────────────

describe('upcomingReminders', () => {
  const NOW = new Date('2026-06-10T12:00:00.000Z');
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

  it('keeps only future reminders on live tasks', () => {
    const tasks = [
      makeTask({ id: 'keep', reminderTime: at(10) }),
      makeTask({ id: 'no-reminder', reminderTime: null }),
      makeTask({ id: 'past', reminderTime: at(-10) }),
      makeTask({ id: 'done', reminderTime: at(10), completed: true }),
      makeTask({ id: 'archived', reminderTime: at(10), archived: true }),
    ];
    expect(upcomingReminders(tasks, NOW).map(t => t.id)).toEqual(['keep']);
  });

  it('sorts soonest first, since that is the order the cap keeps', () => {
    const tasks = [
      makeTask({ id: 'later', reminderTime: at(120) }),
      makeTask({ id: 'soonest', reminderTime: at(5) }),
      makeTask({ id: 'middle', reminderTime: at(60) }),
    ];
    expect(upcomingReminders(tasks, NOW).map(t => t.id)).toEqual(['soonest', 'middle', 'later']);
  });

  it('is uncapped — the cap is applied by the caller, so the count stays honest', () => {
    const tasks = Array.from({ length: MAX_PENDING_REMINDERS + 10 }, (_, i) =>
      makeTask({ id: `t${i}`, reminderTime: at(i + 1) }));
    expect(upcomingReminders(tasks, NOW)).toHaveLength(MAX_PENDING_REMINDERS + 10);
  });

  it('returns nothing for an empty list', () => {
    expect(upcomingReminders([], NOW)).toEqual([]);
  });
});

describe('pendingReminderStats', () => {
  const NOW = new Date('2026-06-10T12:00:00.000Z');
  const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();
  const nUpcoming = (n: number) =>
    Array.from({ length: n }, (_, i) => makeTask({ id: `t${i}`, reminderTime: at(i + 1) }));

  it('drops nothing while under the cap', () => {
    expect(pendingReminderStats(nUpcoming(3), NOW)).toEqual({ wanted: 3, scheduled: 3, dropped: 0 });
  });

  it('drops nothing at exactly the cap', () => {
    expect(pendingReminderStats(nUpcoming(MAX_PENDING_REMINDERS), NOW)).toEqual({
      wanted: MAX_PENDING_REMINDERS,
      scheduled: MAX_PENDING_REMINDERS,
      dropped: 0,
    });
  });

  it('reports the overflow past the cap — the reminders that will never fire', () => {
    expect(pendingReminderStats(nUpcoming(MAX_PENDING_REMINDERS + 16), NOW)).toEqual({
      wanted: MAX_PENDING_REMINDERS + 16,
      scheduled: MAX_PENDING_REMINDERS,
      dropped: 16,
    });
  });

  it('counts only what would actually be scheduled, not every task with a date', () => {
    const tasks = [
      ...nUpcoming(2),
      makeTask({ id: 'past', reminderTime: at(-1) }),
      makeTask({ id: 'done', reminderTime: at(5), completed: true }),
      makeTask({ id: 'none', reminderTime: null }),
    ];
    expect(pendingReminderStats(tasks, NOW)).toEqual({ wanted: 2, scheduled: 2, dropped: 0 });
  });

  it('is all zeroes with nothing scheduled', () => {
    expect(pendingReminderStats([], NOW)).toEqual({ wanted: 0, scheduled: 0, dropped: 0 });
  });

  it('excludes alarm-kind reminders from the notification cap when AlarmKit is available', () => {
    mockAlarmKitAvailable = true;
    const tasks = [
      ...nUpcoming(2),
      makeTask({ id: 'alarm-1', reminderKind: 'alarm', reminderTime: at(3) }),
      makeTask({ id: 'alarm-2', reminderKind: 'alarm', reminderTime: at(4) }),
    ];
    expect(pendingReminderStats(tasks, NOW)).toEqual({ wanted: 2, scheduled: 2, dropped: 0 });
  });

  it('counts alarm-kind reminders against the cap when AlarmKit is unavailable (they fall back to notifications)', () => {
    mockAlarmKitAvailable = false;
    const tasks = [
      ...nUpcoming(2),
      makeTask({ id: 'alarm-1', reminderKind: 'alarm', reminderTime: at(3) }),
    ];
    expect(pendingReminderStats(tasks, NOW)).toEqual({ wanted: 3, scheduled: 3, dropped: 0 });
  });
});

// ─── getNotificationPermission ───────────────────────────────────────────────

describe('getNotificationPermission', () => {
  it('reports granted', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true, status: 'granted' });
    expect(await getNotificationPermission()).toBe('granted');
  });

  it('reports undetermined before the OS prompt has been shown', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false, status: 'undetermined', canAskAgain: true,
    });
    expect(await getNotificationPermission()).toBe('undetermined');
  });

  it('reports denied once the prompt is spent — the case only system Settings can undo', async () => {
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false, status: 'denied', canAskAgain: false,
    });
    expect(await getNotificationPermission()).toBe('denied');
  });

  it('treats a still-askable non-granted state as undetermined, not denied', async () => {
    // Offering "Open Settings" for a permission the app can still ask for
    // itself would send the user on a detour it doesn't need.
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false, status: 'denied', canAskAgain: true,
    });
    expect(await getNotificationPermission()).toBe('undetermined');
  });

  it('reports unsupported on web without touching the Notifications API', async () => {
    (Platform as any).OS = 'web';
    expect(await getNotificationPermission()).toBe('unsupported');
    expect(Notifications.getPermissionsAsync).not.toHaveBeenCalled();
  });
});

// ─── daily agenda ─────────────────────────────────────────────────────────────

const agendaCall = () =>
  (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls
    .map(c => c[0])
    .find(a => a.identifier === 'daily-agenda');

// Dated onto whichever day the next agenda actually covers — today's if the
// send time is still ahead, otherwise tomorrow's. Anchoring the fixture to
// `new Date()` instead made these pass or fail depending on what time of day
// the suite ran: after the send time the agenda covers tomorrow, and a task
// due today is correctly reported as overdue rather than due.
const dueOnAgendaDay = (overrides: Partial<Task> = {}) =>
  makeTask({
    id: 'due-then',
    dueDate: nextAgendaTime(new Date(), mockSettings.dailyAgendaTime).toISOString(),
    ...overrides,
  });

describe('scheduleDailyAgenda', () => {
  it('schedules nothing while the setting is off', async () => {
    mockSettings.dailyAgendaEnabled = false;
    await scheduleDailyAgenda([dueOnAgendaDay()]);
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('always clears the pending one first, so turning it off cancels', async () => {
    mockSettings.dailyAgendaEnabled = false;
    await scheduleDailyAgenda([dueOnAgendaDay()]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('daily-agenda');
  });

  it('schedules under a fixed id so it replaces rather than stacks', async () => {
    mockSettings.dailyAgendaEnabled = true;
    await scheduleDailyAgenda([dueOnAgendaDay()]);
    await scheduleDailyAgenda([dueOnAgendaDay()]);
    const agendaCalls = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls
      .filter(c => c[0].identifier === 'daily-agenda');
    expect(agendaCalls).toHaveLength(2);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('daily-agenda');
  });

  it('titles it Today and puts the counts in the body', async () => {
    mockSettings.dailyAgendaEnabled = true;
    await scheduleDailyAgenda([dueOnAgendaDay()]);
    const arg = agendaCall();
    expect(arg.content.title).toBe('Today');
    expect(arg.content.body).toBe('1 due');
    expect(arg.content.data).toEqual({ dailyAgenda: true });
  });

  // The feature's central rule: no notification on a day with nothing on it.
  it('schedules nothing when the day is empty', async () => {
    mockSettings.dailyAgendaEnabled = true;
    await scheduleDailyAgenda([makeTask({ dueDate: null })]);
    expect(agendaCall()).toBeUndefined();
  });

  it('schedules nothing when every dated task is already done', async () => {
    mockSettings.dailyAgendaEnabled = true;
    await scheduleDailyAgenda([dueOnAgendaDay({ completed: true })]);
    expect(agendaCall()).toBeUndefined();
  });

  it('schedules for a future moment', async () => {
    mockSettings.dailyAgendaEnabled = true;
    await scheduleDailyAgenda([dueOnAgendaDay()]);
    expect(agendaCall().trigger.date.getTime()).toBeGreaterThan(Date.now());
  });

  it('leaves a vacation-paused task out of the count while vacation mode is on', async () => {
    mockSettings.dailyAgendaEnabled = true;
    mockSettings.vacationMode = true;
    await scheduleDailyAgenda([dueOnAgendaDay({ id: 'paused', vacationPause: true })]);
    // Its only task is hidden, so there is nothing to report.
    expect(agendaCall()).toBeUndefined();
  });

  it('counts the same task once vacation mode is off', async () => {
    mockSettings.dailyAgendaEnabled = true;
    mockSettings.vacationMode = false;
    await scheduleDailyAgenda([dueOnAgendaDay({ id: 'paused', vacationPause: true })]);
    expect(agendaCall()?.content.body).toBe('1 due');
  });

  it('handles an empty task list without error', async () => {
    mockSettings.dailyAgendaEnabled = true;
    await expect(scheduleDailyAgenda([])).resolves.toBeUndefined();
  });
});

describe('cancelDailyAgenda', () => {
  it('cancels the namespaced id, leaving task reminders alone', async () => {
    await cancelDailyAgenda();
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('daily-agenda');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  });
});

// The daily agenda is scheduled on every full resync, under its own fixed id
// — cancelled and replaced by scheduleDailyAgenda itself, independent of
// every other kind rescheduleAllReminders rebuilds.
describe('rescheduleAllReminders restores the agenda it just cancelled', () => {
  it('reschedules the agenda on every resync', async () => {
    mockSettings.dailyAgendaEnabled = true;
    await rescheduleAllReminders([dueOnAgendaDay()]);
    expect(Notifications.cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(agendaCall()).toBeDefined();
  });

  it('does not resurrect the agenda when the setting is off', async () => {
    mockSettings.dailyAgendaEnabled = false;
    await rescheduleAllReminders([dueOnAgendaDay()]);
    expect(agendaCall()).toBeUndefined();
  });

  it('schedules the agenda alongside reminders rather than instead of them', async () => {
    mockSettings.dailyAgendaEnabled = true;
    await rescheduleAllReminders([dueOnAgendaDay({ id: 'with-reminder', reminderTime: FUTURE })]);
    const ids = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.map(c => c[0].identifier);
    expect(ids).toContain('with-reminder');
    expect(ids).toContain('daily-agenda');
  });
});

// The trip reminder is rebuilt under its own fixed id on every full resync —
// omitted entirely (the shape every existing call above uses), it's simply
// left cancelled, which is right for all of them since none is mid-trip.
describe('rescheduleAllReminders restores the trip reminder it just cancelled', () => {
  it('reschedules a live trip on every resync', async () => {
    mockSettings.tripReminderEnabled = true;
    const costco = makeShop();
    const startedAt = new Date().toISOString();
    await rescheduleAllReminders([], { shopId: costco.id, startedAt, shops: [costco] });
    const ids = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.map(c => c[0].identifier);
    expect(ids).toContain('active-trip-reminder');
  });

  it('leaves it cancelled when no trip info is passed', async () => {
    await rescheduleAllReminders([]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('active-trip-reminder');
  });
});

// Cancelled and rescheduled by their own `event-reminder:<key>` id — omitted
// entirely, same as trip info, it's simply left cancelled.
describe('rescheduleAllReminders restores event reminders it just cancelled', () => {
  it('reschedules every event reminder passed in, on every resync', async () => {
    const reminder = makeEventReminder();
    await rescheduleAllReminders([], undefined, [reminder]);
    const ids = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.map(c => c[0].identifier);
    expect(ids).toContain(`event-reminder:${reminder.key}`);
  });

  it('schedules nothing extra when none are passed', async () => {
    await rescheduleAllReminders([]);
    const ids = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.map(c => c[0].identifier);
    expect(ids.some(id => id.startsWith('event-reminder:'))).toBe(false);
  });
});

// ─── demo mode ────────────────────────────────────────────────────────────
//
// A demo task is seeded through the normal addTask action, which schedules a
// real device notification or AlarmKit alarm for any reminder it's given —
// but a demo task only ever lives in the scratch database demo mode swaps
// back out, so an alarm scheduled for one would keep ringing on the device
// with no task left in the app that can reference it. isDemoModeActive() is
// what stops it from ever being scheduled in the first place.

describe('demo mode suppresses scheduling', () => {
  afterEach(() => setDemoModeActive(false));

  it('does not schedule a plain task reminder', async () => {
    setDemoModeActive(true);
    await scheduleTaskReminder(makeTask({ reminderTime: FUTURE }));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule a persistent "ring until done" AlarmKit chain', async () => {
    mockAlarmKitAvailable = true;
    setDemoModeActive(true);
    await scheduleTaskReminder(makeTask({ reminderTime: FUTURE, reminderKind: 'persistent' }));
    expect(scheduleNativeAlarm).not.toHaveBeenCalled();
  });

  it('does not schedule a timer alarm', async () => {
    setDemoModeActive(true);
    await scheduleTimerAlarm(
      makeTask({ id: 'timer-demo', timedMinutes: 15, timerStartedAt: new Date().toISOString() })
    );
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does not schedule the daily agenda', async () => {
    mockSettings.dailyAgendaEnabled = true;
    setDemoModeActive(true);
    await scheduleDailyAgenda([dueOnAgendaDay()]);
    expect(agendaCall()).toBeUndefined();
  });

  it('does not schedule a calendar-event reminder', async () => {
    setDemoModeActive(true);
    await scheduleEventReminder(makeEventReminder());
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('resumes scheduling normally once demo mode is cleared', async () => {
    setDemoModeActive(true);
    await scheduleTaskReminder(makeTask({ id: 'during-demo', reminderTime: FUTURE }));
    setDemoModeActive(false);
    await scheduleTaskReminder(makeTask({ id: 'after-demo', reminderTime: FUTURE }));
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(
      (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0].identifier
    ).toBe('after-demo');
  });
});

// ─── Cooking step timers ─────────────────────────────────────────────────────

const makeStepTimer = (overrides: Partial<StepTimer> = {}): StepTimer => ({
  id: 'st1',
  recipeId: 'r1',
  stepId: 's2',
  recipeName: 'Sticky, Spicy Tempeh',
  stepLabel: 'Step 2 of 3',
  durationSeconds: 7 * 60,
  startedAt: new Date().toISOString(),
  elapsedSeconds: 0,
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe('scheduleStepAlarm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAlarmKitAvailable = false;
    Object.assign(mockSettings, DEFAULT_MOCK_SETTINGS);
  });

  afterEach(() => {
    setDemoModeActive(false);
    mockAlarmKitAvailable = false;
  });

  it('schedules against what is left, not the full length', async () => {
    await scheduleStepAlarm(makeStepTimer({ elapsedSeconds: 120 }));
    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    const ringsIn = (call.trigger.date as Date).getTime() - Date.now();
    expect(Math.round(ringsIn / 1000)).toBe(5 * 60);
  });

  it('names the dish and the step', async () => {
    await scheduleStepAlarm(makeStepTimer());
    const call = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(call.content.title).toBe('Sticky, Spicy Tempeh');
    expect(call.content.body).toBe('Step 2 of 3: your 7m timer is up.');
    expect(call.content.data).toEqual({ stepTimerId: 'st1', recipeId: 'r1' });
  });

  it('schedules nothing for a paused timer', async () => {
    await scheduleStepAlarm(makeStepTimer({ startedAt: null, elapsedSeconds: 60 }));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules nothing for a timer that has already rung', async () => {
    await scheduleStepAlarm(makeStepTimer({ elapsedSeconds: 8 * 60 }));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels whatever was pending before scheduling, so a nudge replaces rather than stacks', async () => {
    await scheduleStepAlarm(makeStepTimer());
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('step-timer:st1');
    expect(cancelNativeAlarm).toHaveBeenCalledWith(stepTimerAlarmUuid('st1'));
  });

  it('rings inside quiet hours, unlike a task timer or a focus step', async () => {
    // Deliberate divergence: this countdown was started seconds ago by
    // somebody standing at a stove — see scheduleStepAlarm's own note.
    Object.assign(mockSettings, { quietHoursStart: '00:00', quietHoursEnd: '23:59' });
    await scheduleStepAlarm(makeStepTimer());
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled();
  });

  it('rings as a native alarm where AlarmKit can deliver one', async () => {
    mockAlarmKitAvailable = true;
    await scheduleStepAlarm(makeStepTimer());
    expect(scheduleNativeAlarm).toHaveBeenCalledWith(
      stepTimerAlarmUuid('st1'),
      expect.any(Date),
      'Sticky, Spicy Tempeh · Step 2 of 3'
    );
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules nothing in demo mode', async () => {
    setDemoModeActive(true);
    await scheduleStepAlarm(makeStepTimer());
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(scheduleNativeAlarm).not.toHaveBeenCalled();
  });

  it('cancels in both backends without being told which one was used', async () => {
    await cancelStepAlarm('st1');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('step-timer:st1');
    expect(cancelNativeAlarm).toHaveBeenCalledWith(stepTimerAlarmUuid('st1'));
  });

  it('gives a step timer and a task the same id different alarm uuids', () => {
    expect(stepTimerAlarmUuid('x')).not.toBe(taskAlarmUuid('x'));
  });
});

describe('scheduleQuotaNudges', () => {
  const paced = (overrides: Partial<Task> = {}): Task =>
    makeTask({
      id: 'eyes',
      title: 'Look 20 feet away',
      notes: 'Rest your eyes for 20 seconds.',
      targetCount: 24,
      quotaIntervalMinutes: 20,
      quotaReminders: true,
      windowStart: '09:00',
      windowEnd: '17:00',
      recurrenceType: 'daily',
      ...overrides,
    });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 26, 9, 5, 0));
  });

  afterEach(() => {
    jest.useRealTimers();
    setDemoModeActive(false);
  });

  it('lays down the next few instants, not the whole day', () => {
    // A run at this cadence wants 24 of them and iOS holds 64 requests in
    // total: handing one task a third of the device budget would silently
    // starve the reminders on real tasks.
    return scheduleQuotaNudges(paced()).then(() => {
      expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(MAX_QUOTA_NUDGES_AHEAD);
    });
  });

  it('fires at the grid the pace ramp owes units at', async () => {
    await scheduleQuotaNudges(paced());
    const dates = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.map(
      ([arg]) => arg.trigger.date as Date
    );
    expect(dates[0]).toEqual(new Date(2026, 7, 26, 9, 20, 0));
    expect(dates[1]).toEqual(new Date(2026, 7, 26, 9, 40, 0));
  });

  it('starts from a hand-started run rather than the window', async () => {
    jest.setSystemTime(new Date(2026, 7, 26, 10, 30, 0));
    await scheduleQuotaNudges(paced({
      quotaStartedAt: new Date(2026, 7, 26, 10, 30, 0).toISOString(),
      targetCount: 19,
    }));
    const first = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0].trigger.date;
    // 6.5 hours over 19 units is 20 minutes and change, so the first lands
    // roughly one interval past the start rather than back at 09:00.
    expect(first.getHours()).toBe(10);
    expect(first.getMinutes()).toBeGreaterThanOrEqual(50);
  });

  it('carries the notes, which is where the instruction lives', async () => {
    await scheduleQuotaNudges(paced());
    const { content } = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls[0][0];
    expect(content.title).toBe('Look 20 feet away');
    expect(content.body).toBe('Rest your eyes for 20 seconds.');
  });

  it('schedules nothing when the toggle is off', async () => {
    await scheduleQuotaNudges(paced({ quotaReminders: false }));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules nothing for a completed or archived run', async () => {
    await scheduleQuotaNudges(paced({ completed: true }));
    await scheduleQuotaNudges(paced({ archived: true }));
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules nothing once the run is over', async () => {
    jest.setSystemTime(new Date(2026, 7, 26, 17, 30, 0));
    await scheduleQuotaNudges(paced());
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('schedules nothing in demo mode', async () => {
    // A notification is a side effect on the device, not on the scratch
    // database demo mode swaps back out.
    setDemoModeActive(true);
    await scheduleQuotaNudges(paced());
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('drops instants inside quiet hours rather than deferring them', async () => {
    // Deferring would stack the rest of the run onto the window's close and
    // deliver six at once — the same call scheduleTimerAlarm makes.
    mockSettings.quietHoursStart = '09:30';
    mockSettings.quietHoursEnd = '10:30';
    await scheduleQuotaNudges(paced());
    const dates = (Notifications.scheduleNotificationAsync as jest.Mock).mock.calls.map(
      ([arg]) => arg.trigger.date as Date
    );
    expect(dates.every(d => d < new Date(2026, 7, 26, 9, 30, 0) || d >= new Date(2026, 7, 26, 10, 30, 0))).toBe(true);
    mockSettings.quietHoursStart = null;
    mockSettings.quietHoursEnd = null;
  });

  it('cancels what it had before laying down a new set', async () => {
    await scheduleQuotaNudges(paced());
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('pace:eyes:0');
  });
});

describe('cancelQuotaNudges', () => {
  it('names every id a run could be holding', async () => {
    await cancelQuotaNudges('eyes');
    for (let i = 0; i < MAX_QUOTA_NUDGES_AHEAD; i++) {
      expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(`pace:eyes:${i}`);
    }
  });
});

describe('quotaNudgeTasks', () => {
  const paced = (overrides: Partial<Task> = {}) =>
    makeTask({ targetCount: 24, quotaReminders: true, ...overrides });

  it('names the tasks wanting nudges', () => {
    expect(quotaNudgeTasks([paced({ id: 'a' })]).map(t => t.id)).toEqual(['a']);
  });

  it('skips tasks with the toggle off, completed, archived, or not a target', () => {
    expect(quotaNudgeTasks([
      paced({ id: 'off', quotaReminders: false }),
      paced({ id: 'done', completed: true }),
      paced({ id: 'filed', archived: true }),
      paced({ id: 'plain', targetCount: null }),
    ])).toEqual([]);
  });
});
