/**
 * The write half of `calendarSync.ts`: what an update to an existing event
 * sends back so the fields the app doesn't own survive it.
 *
 * expo-calendar's save assigns `location`, `notes`, `alarms`, `isAllDay` and
 * `availability` on every save, defaulting the missing ones to empty, so an
 * update that named only the title and the day wiped a location, a note or an
 * alert the user had added by hand in the Calendar app. The effectful half is
 * tested against a mocked expo-calendar, the way `remindersImportSync.test.ts`
 * tests the Reminders half.
 */

const mockCalendar = {
  getEventAsync: jest.fn(),
  updateEventAsync: jest.fn(),
  deleteEventAsync: jest.fn(),
  getCalendarsAsync: jest.fn(),
  getCalendarPermissionsAsync: jest.fn(),
  requestCalendarPermissionsAsync: jest.fn(),
  EntityTypes: { EVENT: 'event' },
  Availability: { BUSY: 'busy', FREE: 'free' },
};
jest.mock('expo-calendar/legacy', () => mockCalendar);

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
const mockCoordinates = jest.fn();
jest.mock('todo-eventkit-bridge', () => ({
  eventCoordinatesRaw: (ids: string[]) => mockCoordinates(ids),
}), { virtual: true });
const mockDemo = jest.fn(() => false);
jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => mockDemo() }));

import {
  carriedEventFields,
  deleteEventDirect,
  eventCoordinate,
  readEventForEdit,
  updateEventDirect,
  moveAllDayEvent,
  updateTimeBlockEvent,
} from '../utils/calendarSync';

/** An event as `getEventAsync` hands it back (`serializeCalendar(event:)`). */
function readEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt-1',
    calendarId: 'cal-1',
    title: 'Pay taxes',
    location: 'Tax office, 2nd floor',
    notes: 'Bring the blue folder',
    alarms: [{ relativeOffset: -1440 }],
    startDate: '2026-08-20T00:00:00.000Z',
    endDate: '2026-08-21T00:00:00.000Z',
    allDay: true,
    availability: 'free',
    status: 'none',
    ...overrides,
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockCalendar.getEventAsync.mockResolvedValue(readEvent());
  mockCalendar.updateEventAsync.mockImplementation((id: string) => Promise.resolve(id));
});

describe('carriedEventFields', () => {
  it('carries the location, notes, availability and all-day flag the event holds', () => {
    expect(carriedEventFields(readEvent())).toEqual({
      location: 'Tax office, 2nd floor',
      notes: 'Bring the blue folder',
      alarms: [{ relativeOffset: -1440 }],
      availability: 'free',
      allDay: true,
    });
  });

  it('carries none of what the save leaves alone when it is missing', () => {
    // The calendar, the dates, the URL, a repeat rule and the time zone are
    // assigned only when present, so sending them would be a change rather
    // than a carry. The time zone especially: the read gives a display name
    // ("PST"), which the write would refuse as an identifier.
    const carried = carriedEventFields(readEvent({
      url: 'https://example.com',
      timeZone: 'PST',
      recurrenceRule: { frequency: 'weekly' },
    }));
    expect(Object.keys(carried).sort()).toEqual(['alarms', 'allDay', 'availability', 'location', 'notes']);
  });

  it('never sends a null, which the native record refuses for a non-optional field', () => {
    // An event with no notes reads back `notes: null`, and one with no location
    // leaves the key out altogether.
    const carried = carriedEventFields(readEvent({ notes: null, location: undefined, availability: '' }));
    expect(carried).not.toHaveProperty('notes');
    expect(carried).not.toHaveProperty('location');
    expect(carried).not.toHaveProperty('availability');
    expect(Object.values(carried)).not.toContain(null);
  });

  it('is empty for a read that came back with nothing usable', () => {
    expect(carriedEventFields(null)).toEqual({});
    expect(carriedEventFields(undefined)).toEqual({});
    expect(carriedEventFields('evt-1')).toEqual({});
  });

  it('keeps an empty alarm list as an empty list', () => {
    expect(carriedEventFields(readEvent({ alarms: [] })).alarms).toEqual([]);
  });

  describe('alarms, which the read and the write shape differently', () => {
    const alarmsOf = (alarms: unknown[]) => carriedEventFields(readEvent({ alarms })).alarms;

    it('rounds a relative offset to the whole minutes the write takes', () => {
      // The read divides seconds by 60.0; the write's field is an Int.
      expect(alarmsOf([{ relativeOffset: -15 }, { relativeOffset: -14.6 }, { relativeOffset: 540.4 }]))
        .toEqual([{ relativeOffset: -15 }, { relativeOffset: -15 }, { relativeOffset: 540 }]);
    });

    it('sends an absolute alert as its date alone', () => {
      // The read reports a zero offset beside the date; the write reads the
      // date first and ignores the offset, so only the date means anything.
      expect(alarmsOf([{ absoluteDate: '2026-08-19T09:00:00.000Z', relativeOffset: 0 }]))
        .toEqual([{ absoluteDate: '2026-08-19T09:00:00.000Z' }]);
    });

    it('moves a location alert from `coord` to the `coords` the write reads', () => {
      expect(alarmsOf([{
        relativeOffset: 0,
        structuredLocation: {
          title: 'Home',
          proximity: 'leave',
          radius: 150,
          coord: { latitude: 51.5, longitude: -0.12 },
        },
      }])).toEqual([{
        relativeOffset: 0,
        structuredLocation: {
          title: 'Home',
          proximity: 'leave',
          radius: 150,
          coords: { latitude: 51.5, longitude: -0.12 },
        },
      }]);
    });

    it('gives a location alert with no title the empty title the write requires', () => {
      const [alarm] = alarmsOf([{
        relativeOffset: 0,
        structuredLocation: { title: null, proximity: 'None', radius: 0, coord: { latitude: 1, longitude: 2 } },
      }])!;
      expect(alarm.structuredLocation).toEqual({ title: '', radius: 0, coords: { latitude: 1, longitude: 2 } });
    });

    it('leaves out a location alert whose coordinates did not read back', () => {
      // Written without them, the write would ignore the location and keep the
      // zero offset: an "at the time of the event" alert nobody set.
      expect(alarmsOf([
        { relativeOffset: 0, structuredLocation: { title: 'Home', coord: { latitude: null, longitude: null } } },
        { relativeOffset: -30 },
      ])).toEqual([{ relativeOffset: -30 }]);
    });

    it('drops an entry that says nothing an alert could be built from', () => {
      expect(alarmsOf([null, 'soon', {}, { relativeOffset: Number.NaN }, { relativeOffset: -5 }]))
        .toEqual([{ relativeOffset: -5 }]);
    });
  });
});

describe('moveAllDayEvent', () => {
  const fields = { title: 'Renew passport', date: new Date(2026, 7, 20) };

  it('sends back what the event already holds, so a hand-added location, note and alert survive', async () => {
    expect(await moveAllDayEvent('evt-1', 'cal-1', fields)).toBe('evt-1');
    expect(mockCalendar.getEventAsync).toHaveBeenCalledWith('evt-1', undefined);
    expect(mockCalendar.updateEventAsync).toHaveBeenCalledWith('evt-1', {
      location: 'Tax office, 2nd floor',
      notes: 'Bring the blue folder',
      alarms: [{ relativeOffset: -1440 }],
      availability: 'free',
      allDay: true,
      calendarId: 'cal-1',
      title: 'Renew passport',
      startDate: new Date(2026, 7, 20),
      endDate: new Date(2026, 7, 21),
    }, undefined);
  });

  it('carries them into the new calendar, and links the id the event comes back with', async () => {
    mockCalendar.updateEventAsync.mockResolvedValue('evt-moved');
    expect(await moveAllDayEvent('evt-1', 'cal-home', fields)).toBe('evt-moved');
    expect(mockCalendar.updateEventAsync).toHaveBeenCalledWith('evt-1', expect.objectContaining({
      calendarId: 'cal-home',
      location: 'Tax office, 2nd floor',
      notes: 'Bring the blue folder',
      alarms: [{ relativeOffset: -1440 }],
    }), undefined);
  });

  it('writes its own fields over whatever the event said', async () => {
    mockCalendar.getEventAsync.mockResolvedValue(readEvent({ title: 'Old title', allDay: false, calendarId: 'cal-old' }));
    await moveAllDayEvent('evt-1', 'cal-1', fields);
    const [, details] = mockCalendar.updateEventAsync.mock.calls[0];
    expect(details.title).toBe('Renew passport');
    expect(details.allDay).toBe(true);
    expect(details.calendarId).toBe('cal-1');
  });

  it('still writes the title, day and calendar when the read fails', async () => {
    mockCalendar.getEventAsync.mockRejectedValue(new Error('EventKit is unhappy'));
    expect(await moveAllDayEvent('evt-1', 'cal-1', fields)).toBe('evt-1');
    expect(mockCalendar.updateEventAsync).toHaveBeenCalledWith('evt-1', {
      calendarId: 'cal-1',
      title: 'Renew passport',
      startDate: new Date(2026, 7, 20),
      endDate: new Date(2026, 7, 21),
      allDay: true,
    }, undefined);
  });

  it('reports a failed write, for the caller to fall back on', async () => {
    mockCalendar.getEventAsync.mockRejectedValue(new Error('not found'));
    mockCalendar.updateEventAsync.mockRejectedValue(new Error('not found'));
    expect(await moveAllDayEvent('gone', 'cal-1', fields)).toBeNull();
  });
});

describe('updateTimeBlockEvent', () => {
  it('keeps the alert set on the block in the sheet, and reads the instance it writes', async () => {
    mockCalendar.getEventAsync.mockResolvedValue(readEvent({
      allDay: false,
      alarms: [{ relativeOffset: -10 }],
      availability: 'busy',
    }));
    const endDate = new Date(2026, 7, 20, 10, 30);
    expect(await updateTimeBlockEvent('evt-1', { title: 'Write report', endDate })).toBe(true);
    expect(mockCalendar.getEventAsync).toHaveBeenCalledWith('evt-1', { futureEvents: false });
    expect(mockCalendar.updateEventAsync).toHaveBeenCalledWith('evt-1', {
      location: 'Tax office, 2nd floor',
      notes: 'Bring the blue folder',
      alarms: [{ relativeOffset: -10 }],
      availability: 'busy',
      allDay: false,
      title: 'Write report',
      endDate,
    }, { futureEvents: false });
  });
});

describe('eventCoordinate', () => {
  beforeEach(() => {
    mockCoordinates.mockReset();
    mockDemo.mockReturnValue(false);
  });

  it("reads the event's map pin", async () => {
    mockCoordinates.mockResolvedValue({ 'evt-1': { latitude: 40.73, longitude: -74.0 } });
    await expect(eventCoordinate('evt-1')).resolves.toEqual({ latitude: 40.73, longitude: -74.0 });
    expect(mockCoordinates).toHaveBeenCalledWith(['evt-1']);
  });

  it('is null for an event with no pin, a malformed answer, or a failed read', async () => {
    mockCoordinates.mockResolvedValue({});
    await expect(eventCoordinate('evt-1')).resolves.toBeNull();
    mockCoordinates.mockResolvedValue({ 'evt-1': { latitude: 'x', longitude: 2 } });
    await expect(eventCoordinate('evt-1')).resolves.toBeNull();
    mockCoordinates.mockRejectedValue(new Error('no access'));
    await expect(eventCoordinate('evt-1')).resolves.toBeNull();
  });

  it('reads nothing in demo mode or for no id', async () => {
    mockDemo.mockReturnValue(true);
    await expect(eventCoordinate('evt-1')).resolves.toBeNull();
    mockDemo.mockReturnValue(false);
    await expect(eventCoordinate('')).resolves.toBeNull();
    expect(mockCoordinates).not.toHaveBeenCalled();
  });
});

// The edit card: reading an event in, saving it back,
// and deleting it. Only ever the occurrence the user opened.
describe('editing an event from the card', () => {
  beforeEach(() => {
    mockCalendar.getCalendarsAsync.mockResolvedValue([
      { id: 'cal-1', title: 'Home', allowsModifications: true },
      { id: 'cal-subscribed', title: 'Holidays', allowsModifications: false },
    ]);
    mockCalendar.getCalendarPermissionsAsync.mockResolvedValue({ granted: true });
    mockCalendar.deleteEventAsync.mockResolvedValue(undefined);
  });

  it('reads the occurrence tapped, with its first alert and whether it can be changed', async () => {
    mockCalendar.getEventAsync.mockResolvedValue(readEvent({
      allDay: false,
      startDate: '2026-08-20T09:00:00.000Z',
      endDate: '2026-08-20T10:30:00.000Z',
      alarms: [{ relativeOffset: -15 }, { relativeOffset: -60 }],
      url: 'https://example.com',
      recurrenceRule: { frequency: 'weekly' },
    }));

    const event = await readEventForEdit('evt-1', '2026-08-20T09:00:00.000Z');

    expect(mockCalendar.getEventAsync).toHaveBeenCalledWith('evt-1', {
      futureEvents: false, instanceStartDate: '2026-08-20T09:00:00.000Z',
    });
    expect(event).toMatchObject({
      title: 'Pay taxes',
      allDay: false,
      location: 'Tax office, 2nd floor',
      notes: 'Bring the blue folder',
      url: 'https://example.com',
      alertOffset: -15,
      availability: 'free',
      calendarId: 'cal-1',
      recurring: true,
      editable: true,
    });
    expect(event!.end.getTime() - event!.start.getTime()).toBe(90 * 60000);
  });

  it('says an event on a read-only calendar cannot be changed', async () => {
    mockCalendar.getEventAsync.mockResolvedValue(readEvent({ calendarId: 'cal-subscribed' }));

    await expect(readEventForEdit('evt-1')).resolves.toMatchObject({ editable: false });
  });

  it('answers null for an event that is gone', async () => {
    mockCalendar.getEventAsync.mockRejectedValue(new Error('not found'));

    await expect(readEventForEdit('evt-1')).resolves.toBeNull();
  });

  it('saves the fields the card owns and carries back what it does not show', async () => {
    const start = new Date('2026-08-21T14:00:00.000Z');
    const end = new Date('2026-08-21T15:00:00.000Z');

    const id = await updateEventDirect('evt-1', {
      title: 'Pay taxes (late)', start, end, allDay: false, alarms: [],
    }, '2026-08-20T00:00:00.000Z');

    expect(id).toBe('evt-1');
    const [, details, options] = mockCalendar.updateEventAsync.mock.calls[0];
    // An emptied location or alert clears it; notes the card left alone are
    // carried back from the event as it stood.
    expect(details).toMatchObject({
      title: 'Pay taxes (late)', startDate: start, endDate: end, allDay: false,
      location: '', alarms: [], notes: 'Bring the blue folder', availability: 'busy',
    });
    expect(options).toEqual({ futureEvents: false, instanceStartDate: '2026-08-20T00:00:00.000Z' });
  });

  it('never moves an event onto a calendar it cannot write to', async () => {
    await updateEventDirect('evt-1', {
      title: 'Pay taxes', start: new Date(), end: new Date(), calendarId: 'cal-subscribed',
    });

    const [, details] = mockCalendar.updateEventAsync.mock.calls[0];
    expect(details.calendarId).toBeUndefined();
  });

  it('writes nothing in demo mode', async () => {
    mockDemo.mockReturnValue(true);

    await expect(updateEventDirect('evt-1', { title: 'x', start: new Date(), end: new Date() })).resolves.toBeNull();
    await expect(deleteEventDirect('evt-1')).resolves.toBe(false);

    expect(mockCalendar.updateEventAsync).not.toHaveBeenCalled();
    expect(mockCalendar.deleteEventAsync).not.toHaveBeenCalled();
  });

  it('deletes only the occurrence opened', async () => {
    await expect(deleteEventDirect('evt-1', '2026-08-20T00:00:00.000Z')).resolves.toBe(true);
    expect(mockCalendar.deleteEventAsync).toHaveBeenCalledWith('evt-1', {
      futureEvents: false, instanceStartDate: '2026-08-20T00:00:00.000Z',
    });

    await deleteEventDirect('evt-2');
    expect(mockCalendar.deleteEventAsync).toHaveBeenLastCalledWith('evt-2', { futureEvents: false });
  });

  it('reports a delete that failed, so the caller keeps its pointer', async () => {
    mockCalendar.deleteEventAsync.mockRejectedValue(new Error('read-only'));

    await expect(deleteEventDirect('evt-1')).resolves.toBe(false);
  });
});
