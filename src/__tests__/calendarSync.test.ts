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
};
jest.mock('expo-calendar/legacy', () => mockCalendar);

jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import {
  carriedEventFields,
  moveAllDayEvent,
  updateAllDayEvent,
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

describe('updateAllDayEvent', () => {
  const fields = { title: 'Renew passport', date: new Date(2026, 7, 20) };

  it('sends back what the event already holds, so a hand-added location, note and alert survive', async () => {
    expect(await updateAllDayEvent('evt-1', fields)).toBe(true);
    expect(mockCalendar.getEventAsync).toHaveBeenCalledWith('evt-1', undefined);
    expect(mockCalendar.updateEventAsync).toHaveBeenCalledWith('evt-1', {
      location: 'Tax office, 2nd floor',
      notes: 'Bring the blue folder',
      alarms: [{ relativeOffset: -1440 }],
      availability: 'free',
      allDay: true,
      title: 'Renew passport',
      startDate: new Date(2026, 7, 20),
      endDate: new Date(2026, 7, 21),
    }, undefined);
  });

  it('writes its own fields over whatever the event said', async () => {
    mockCalendar.getEventAsync.mockResolvedValue(readEvent({ title: 'Old title', allDay: false }));
    await updateAllDayEvent('evt-1', fields);
    const [, details] = mockCalendar.updateEventAsync.mock.calls[0];
    expect(details.title).toBe('Renew passport');
    expect(details.allDay).toBe(true);
  });

  it('still writes the title and day when the read fails', async () => {
    mockCalendar.getEventAsync.mockRejectedValue(new Error('EventKit is unhappy'));
    expect(await updateAllDayEvent('evt-1', fields)).toBe(true);
    expect(mockCalendar.updateEventAsync).toHaveBeenCalledWith('evt-1', {
      title: 'Renew passport',
      startDate: new Date(2026, 7, 20),
      endDate: new Date(2026, 7, 21),
      allDay: true,
    }, undefined);
  });

  it('reports a failed write, for the caller to fall back on', async () => {
    mockCalendar.getEventAsync.mockRejectedValue(new Error('not found'));
    mockCalendar.updateEventAsync.mockRejectedValue(new Error('not found'));
    expect(await updateAllDayEvent('gone', fields)).toBe(false);
  });
});

describe('moveAllDayEvent', () => {
  it('carries the hand-added details into the new calendar with the event', async () => {
    mockCalendar.updateEventAsync.mockResolvedValue('evt-moved');
    const id = await moveAllDayEvent('evt-1', 'cal-home', { title: 'Dinner: Ragu', date: new Date(2026, 7, 20) });
    expect(id).toBe('evt-moved');
    expect(mockCalendar.updateEventAsync).toHaveBeenCalledWith('evt-1', expect.objectContaining({
      calendarId: 'cal-home',
      title: 'Dinner: Ragu',
      location: 'Tax office, 2nd floor',
      notes: 'Bring the blue folder',
      alarms: [{ relativeOffset: -1440 }],
    }), undefined);
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
