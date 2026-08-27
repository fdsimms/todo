import { useEventReminderStore } from '../store/useEventReminderStore';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { scheduleEventReminder, cancelEventReminder } from '../utils/notifications';
import { eventReminderKey } from '../utils/eventReminders';
import type { BusyEvent } from '../utils/calendarBusy';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
}));

jest.mock('../utils/notifications', () => ({
  scheduleEventReminder: jest.fn(),
  cancelEventReminder: jest.fn(),
}));

const event = (overrides: Partial<BusyEvent> = {}): BusyEvent => ({
  id: 'evt-1',
  title: 'Standup',
  start: '2026-01-10T09:00:00.000Z',
  end: '2026-01-10T09:15:00.000Z',
  allDay: false,
  calendarId: 'cal-1',
  location: null,
  status: 'confirmed',
  availability: 'busy',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetSetting as jest.Mock).mockReturnValue(null);
  useEventReminderStore.setState({ remindersByKey: {}, loaded: false });
});

describe('initialize', () => {
  it('starts empty with no stored data', () => {
    useEventReminderStore.getState().initialize();
    expect(useEventReminderStore.getState().remindersByKey).toEqual({});
    expect(useEventReminderStore.getState().loaded).toBe(true);
  });

  it('loads a persisted reminder for an event still ahead', () => {
    const key = eventReminderKey(event());
    const stored = { [key]: { key, eventId: 'evt-1', eventTitle: 'Standup', eventStart: '2099-01-01T09:00:00.000Z', offsetMinutes: 15 } };
    (dbGetSetting as jest.Mock).mockReturnValue(JSON.stringify(stored));
    useEventReminderStore.getState().initialize();
    expect(useEventReminderStore.getState().remindersByKey).toEqual(stored);
  });

  it('prunes a reminder whose event has already started, and persists the prune', () => {
    const key = 'evt-1|2000-01-01T09:00:00.000Z';
    const stored = { [key]: { key, eventId: 'evt-1', eventTitle: 'Old meeting', eventStart: '2000-01-01T09:00:00.000Z', offsetMinutes: 15 } };
    (dbGetSetting as jest.Mock).mockReturnValue(JSON.stringify(stored));
    useEventReminderStore.getState().initialize();
    expect(useEventReminderStore.getState().remindersByKey).toEqual({});
    expect(dbSetSetting).toHaveBeenCalledWith('event_reminders', JSON.stringify({}));
  });

  it('tolerates corrupt stored JSON by starting empty', () => {
    (dbGetSetting as jest.Mock).mockReturnValue('not json');
    useEventReminderStore.getState().initialize();
    expect(useEventReminderStore.getState().remindersByKey).toEqual({});
  });
});

describe('setReminder', () => {
  it('stores the reminder, persists it, and schedules its notification', () => {
    const e = event();
    useEventReminderStore.getState().setReminder(e, 15);
    const key = eventReminderKey(e);
    expect(useEventReminderStore.getState().remindersByKey[key]).toMatchObject({ offsetMinutes: 15, eventId: 'evt-1' });
    expect(dbSetSetting).toHaveBeenCalledWith('event_reminders', expect.stringContaining(key));
    expect(scheduleEventReminder).toHaveBeenCalledWith(useEventReminderStore.getState().remindersByKey[key]);
  });

  it('replaces an existing reminder for the same event without disturbing others', () => {
    const e = event();
    const other = event({ id: 'evt-2', start: '2026-01-11T09:00:00.000Z' });
    useEventReminderStore.getState().setReminder(other, 30);
    useEventReminderStore.getState().setReminder(e, 15);
    useEventReminderStore.getState().setReminder(e, 60);
    expect(useEventReminderStore.getState().remindersByKey[eventReminderKey(e)].offsetMinutes).toBe(60);
    expect(useEventReminderStore.getState().remindersByKey[eventReminderKey(other)].offsetMinutes).toBe(30);
  });
});

describe('clearReminder', () => {
  it('removes the reminder, persists the removal, and cancels its notification', () => {
    const e = event();
    useEventReminderStore.getState().setReminder(e, 15);
    useEventReminderStore.getState().clearReminder(e);
    expect(useEventReminderStore.getState().remindersByKey).toEqual({});
    expect(cancelEventReminder).toHaveBeenCalledWith(eventReminderKey(e));
  });

  it('is a no-op for an event with no reminder set', () => {
    const e = event();
    useEventReminderStore.getState().clearReminder(e);
    expect(cancelEventReminder).not.toHaveBeenCalled();
    expect(dbSetSetting).not.toHaveBeenCalled();
  });
});

describe('reminderFor', () => {
  it('finds a reminder by the same (id, start) key an event carries', () => {
    const e = event();
    useEventReminderStore.getState().setReminder(e, 15);
    expect(useEventReminderStore.getState().reminderFor(e)?.offsetMinutes).toBe(15);
  });

  it('is undefined for an event with none set', () => {
    expect(useEventReminderStore.getState().reminderFor(event())).toBeUndefined();
  });
});
