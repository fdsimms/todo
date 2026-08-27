import {
  describeEventReminderOffset,
  eventReminderKey,
  isReminderStale,
  pruneStaleReminders,
  reminderFromEvent,
  reminderTriggerDate,
  type EventReminder,
} from '../utils/eventReminders';
import type { BusyEvent } from '../utils/calendarBusy';

const makeEvent = (overrides: Partial<BusyEvent> = {}): BusyEvent => ({
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

describe('eventReminderKey', () => {
  it('combines id and start, so recurring occurrences never collide', () => {
    const key = eventReminderKey(makeEvent());
    expect(key).toBe('evt-1|2026-01-10T09:00:00.000Z');
  });

  it('differs for two occurrences of the same series', () => {
    const monday = eventReminderKey(makeEvent({ start: '2026-01-05T09:00:00.000Z' }));
    const tuesday = eventReminderKey(makeEvent({ start: '2026-01-06T09:00:00.000Z' }));
    expect(monday).not.toBe(tuesday);
  });
});

describe('reminderFromEvent', () => {
  it('falls back to a generic title for an event with none', () => {
    const reminder = reminderFromEvent(makeEvent({ title: '' }), 15);
    expect(reminder.eventTitle).toBe('Event');
  });

  it('carries the event id, start and chosen offset', () => {
    const reminder = reminderFromEvent(makeEvent(), 30);
    expect(reminder.eventId).toBe('evt-1');
    expect(reminder.eventStart).toBe('2026-01-10T09:00:00.000Z');
    expect(reminder.offsetMinutes).toBe(30);
  });
});

describe('reminderTriggerDate', () => {
  it('subtracts offsetMinutes from the event start', () => {
    const reminder: EventReminder = {
      key: 'k', eventId: 'evt-1', eventTitle: 'Standup',
      eventStart: '2026-01-10T09:00:00.000Z', offsetMinutes: 15,
    };
    expect(reminderTriggerDate(reminder).toISOString()).toBe('2026-01-10T08:45:00.000Z');
  });

  it('is exactly the start time for a zero offset', () => {
    const reminder: EventReminder = {
      key: 'k', eventId: 'evt-1', eventTitle: 'Standup',
      eventStart: '2026-01-10T09:00:00.000Z', offsetMinutes: 0,
    };
    expect(reminderTriggerDate(reminder).toISOString()).toBe('2026-01-10T09:00:00.000Z');
  });
});

describe('isReminderStale / pruneStaleReminders', () => {
  const past: EventReminder = {
    key: 'past', eventId: 'e1', eventTitle: 'Yesterday',
    eventStart: '2026-01-01T09:00:00.000Z', offsetMinutes: 15,
  };
  const future: EventReminder = {
    key: 'future', eventId: 'e2', eventTitle: 'Tomorrow',
    eventStart: '2026-01-20T09:00:00.000Z', offsetMinutes: 15,
  };
  const now = new Date('2026-01-10T00:00:00.000Z');

  it('is stale once the event start has passed', () => {
    expect(isReminderStale(past, now)).toBe(true);
    expect(isReminderStale(future, now)).toBe(false);
  });

  it('drops only the stale entries, keeping the rest', () => {
    const pruned = pruneStaleReminders({ past, future }, now);
    expect(pruned).toEqual({ future });
  });
});

describe('describeEventReminderOffset', () => {
  it('describes zero as the start time', () => {
    expect(describeEventReminderOffset(0)).toBe('At start time');
  });

  it('describes minutes under an hour', () => {
    expect(describeEventReminderOffset(15)).toBe('15 min before');
  });

  it('describes whole hours, singular and plural', () => {
    expect(describeEventReminderOffset(60)).toBe('1 hr before');
    expect(describeEventReminderOffset(120)).toBe('2 hrs before');
  });
});
