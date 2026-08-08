import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Task } from '../types';
import { nextAgendaTime } from '../utils/dailyAgenda';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  cancelAllScheduledNotificationsAsync: jest.fn().mockResolvedValue(undefined),
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
};

jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
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
  getNotificationPermission,
  upcomingReminders,
  pendingReminderStats,
  MAX_PENDING_REMINDERS,
  scheduleDailyAgenda,
  cancelDailyAgenda,
} from '../utils/notifications';
import { scheduleNativeAlarm, cancelNativeAlarm } from 'todo-alarmkit-bridge';

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
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  targetCount: null,
  targetUnit: null,
  progressCount: 0,
  tags: [],
  sortOrder: 1,
  pinned: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  previousStreakCount: 0,
  previousStreakDate: null,
  showStreak: false,
  parentId: null,
  groupId: null,
  projectId: null,
  reminderTime: null,
  reminderKind: 'notification',
  chainEnabled: false,
  chainIndex: 0,
  chainItems: [],
  chainStepOnSchedule: false,
  category: null,
  vacationPause: false,
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
  blockedById: null,
  pendingImport: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (Platform as any).OS = 'ios';
  for (const key of Object.keys(mockSettings)) delete mockSettings[key];
  Object.assign(mockSettings, DEFAULT_MOCK_SETTINGS);
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
    expect(scheduleNativeAlarm).toHaveBeenCalledWith('task-alarm', new Date(FUTURE), 'Wake up');
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    // Still clears any stale plain notification left behind by a prior 'notification'-kind schedule.
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('task-alarm');
  });

  it('clears any stale native alarm when scheduling a plain notification', async () => {
    mockAlarmKitAvailable = true;
    await scheduleTaskReminder(makeTask({ id: 'task-1', reminderTime: FUTURE, reminderKind: 'notification' }));
    expect(cancelNativeAlarm).toHaveBeenCalledWith('task-1');
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
    expect(cancelNativeAlarm).toHaveBeenCalledWith('my-task-id');
  });
});

// ─── rescheduleAllReminders ───────────────────────────────────────────────────

describe('rescheduleAllReminders', () => {
  it('cancels all scheduled notifications once regardless of task list contents', async () => {
    const task = makeTask({ id: 'task-1', completed: true, reminderTime: FUTURE });
    await rescheduleAllReminders([task]);
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
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
    expect(scheduleNativeAlarm).toHaveBeenCalledWith('alarm-1', new Date(FUTURE), expect.any(String));
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

describe('cancelTimerAlarm', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cancels the namespaced id, leaving the task reminder alone', async () => {
    await cancelTimerAlarm('task-1');
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('timer:task-1');
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

// The blanket cancelAllScheduledNotificationsAsync in rescheduleAllReminders
// clears everything this app owns, so anything else it schedules has to be put
// back in the same pass. That was already true of timer alarms; the agenda is
// the second thing it's true of, and the easiest to lose silently.
describe('rescheduleAllReminders restores the agenda it just cancelled', () => {
  it('reschedules the agenda after the blanket cancel', async () => {
    mockSettings.dailyAgendaEnabled = true;
    await rescheduleAllReminders([dueOnAgendaDay()]);
    expect(Notifications.cancelAllScheduledNotificationsAsync).toHaveBeenCalledTimes(1);
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
