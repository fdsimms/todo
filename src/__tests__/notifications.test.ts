import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import type { Task } from '../types';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  scheduleNotificationAsync: jest.fn().mockResolvedValue('test-id'),
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import {
  requestNotificationPermissions,
  scheduleTaskReminder,
  cancelTaskReminder,
  rescheduleAllReminders,
} from '../utils/notifications';

const FUTURE = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const PAST   = new Date(Date.now() - 10 * 60 * 1000).toISOString();

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Test Task',
  notes: '',
  completed: false,
  completedAt: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  dueDate: null,
  deadline: null,
  deferUntil: null,
  timeSegments: [],
  windowStart: null,
  windowEnd: null,
  recurrenceType: 'none',
  recurrenceInterval: 1,
  recurrenceDays: [],
  recurrenceEndDate: null,
  recurrenceCount: null,
  recurrenceFromCompletion: false,
  tags: [],
  sortOrder: 1,
  focused: false,
  priority: 0,
  effort: 0,
  estimatedMinutes: null,
  streakCount: 0,
  streakDate: null,
  parentId: null,
  reminderTime: null,
  cycleEnabled: false,
  cycleIndex: 0,
  cycleItems: [],
  category: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (Platform as any).OS = 'ios';
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
});

// ─── rescheduleAllReminders ───────────────────────────────────────────────────

describe('rescheduleAllReminders', () => {
  it('cancels reminder for a completed task', async () => {
    const task = makeTask({ id: 'task-1', completed: true, reminderTime: FUTURE });
    await rescheduleAllReminders([task]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('task-1');
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels reminder for a task with no reminderTime', async () => {
    const task = makeTask({ id: 'task-2', reminderTime: null });
    await rescheduleAllReminders([task]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('task-2');
  });

  it('cancels reminder for a task whose reminderTime is in the past', async () => {
    const task = makeTask({ id: 'task-3', reminderTime: PAST });
    await rescheduleAllReminders([task]);
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('task-3');
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
    expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('a');
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('handles an empty list without error', async () => {
    await expect(rescheduleAllReminders([])).resolves.toBeUndefined();
  });
});
