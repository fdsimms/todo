import {
  useEventPeopleStore,
  EVENT_PEOPLE_SETTING_KEY,
  EVENT_PEOPLE_MIGRATION_FLAG,
} from '../store/useEventPeopleStore';
import {
  dbDeleteSetting,
  dbGetSetting,
  dbSetSetting,
} from '../db/database';
import { deleteEventDirect, rescheduleEventDirect, saveEventDirect, updateEventDirect } from '../utils/calendarSync';
import { isDemoModeActive } from '../utils/demoState';
import { useCalendarStore } from '../store/useCalendarStore';
import type { BusyEvent } from '../utils/calendarBusy';
import type { EventPeopleLink } from '../types';

// An in-memory event_people_links mockTable, so the store's reads and writes
// round-trip the way they do against SQLite.
let mockTable: EventPeopleLink[] = [];
let mockSettings: Record<string, string> = {};

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn((key: string) => mockSettings[key] ?? null),
  dbSetSetting: jest.fn((key: string, value: string) => { mockSettings[key] = value; }),
  dbDeleteSetting: jest.fn((key: string) => { delete mockSettings[key]; }),
  dbGetAllEventPeopleLinks: jest.fn(() => mockTable.map(r => ({ ...r, personIds: [...r.personIds] }))),
  dbUpsertEventPeopleLink: jest.fn((link: EventPeopleLink) => {
    mockTable = [...mockTable.filter(r => r.id !== link.id), { ...link }];
  }),
  dbDeleteEventPeopleLinks: jest.fn((ids: string[]) => {
    mockTable = mockTable.filter(r => !ids.includes(r.id));
  }),
}));
jest.mock('../utils/calendarSync', () => ({
  saveEventDirect: jest.fn(),
  updateEventDirect: jest.fn(),
  rescheduleEventDirect: jest.fn(),
  deleteEventDirect: jest.fn(),
}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn().mockReturnValue(false) }));
jest.mock('../store/useCalendarStore', () => {
  const refresh = jest.fn().mockResolvedValue(undefined);
  const state = { refresh, events: [], pastEvents: [], gridEvents: [] };
  return { useCalendarStore: { getState: () => state, subscribe: jest.fn() } };
});
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));
const mockExternalIds = jest.fn();
jest.mock('todo-eventkit-bridge', () => ({ externalIdentifiers: (ids: string[]) => mockExternalIds(ids) }));

const event = (overrides: Partial<BusyEvent> = {}): BusyEvent => ({
  id: 'e1',
  title: 'Dinner',
  start: '2099-01-10T18:00:00.000Z',
  end: '2099-01-10T20:00:00.000Z',
  allDay: false,
  calendarId: 'cal',
  location: null,
  status: 'confirmed',
  availability: 'busy',
  ...overrides,
});


beforeEach(() => {
  jest.clearAllMocks();
  mockTable = [];
  mockSettings = { [EVENT_PEOPLE_MIGRATION_FLAG]: '1' };
  mockExternalIds.mockResolvedValue({});
  // The calendar mock's state is shared across tests; one that fills it must
  // not leak its events into whichever test the random order runs next.
  Object.assign(useCalendarStore.getState(), { events: [], pastEvents: [], gridEvents: [] });
  (isDemoModeActive as jest.Mock).mockReturnValue(false);
  useEventPeopleStore.setState({ rows: [], links: { byKey: {}, externalIds: {} }, loaded: false });
});

describe('initialize', () => {
  it('moves the old device-local setting into the mockTable once, then deletes it', () => {
    delete mockSettings[EVENT_PEOPLE_MIGRATION_FLAG];
    const start = '2099-01-10T18:00:00.000Z';
    mockSettings[EVENT_PEOPLE_SETTING_KEY] = JSON.stringify({
      [`e1|${start}`]: { eventId: 'e1', eventStart: start, eventEnd: start, title: 'Dinner', personIds: ['p1'] },
    });
    useEventPeopleStore.getState().initialize();
    expect(mockTable).toHaveLength(1);
    expect(dbDeleteSetting).toHaveBeenCalledWith(EVENT_PEOPLE_SETTING_KEY);
    expect(dbSetSetting).toHaveBeenCalledWith(EVENT_PEOPLE_MIGRATION_FLAG, '1');
    expect(useEventPeopleStore.getState().peopleFor(event())).toEqual(['p1']);

    // A second launch does not migrate again.
    useEventPeopleStore.getState().initialize();
    expect(mockTable).toHaveLength(1);
  });

  it('prunes rows past the history window', () => {
    mockTable = [
      { id: 'keep', eventKey: `e1#2099-01-10T18:00:00.000Z`, eventStart: '2099-01-10T18:00:00.000Z', eventEnd: '2099-01-10T20:00:00.000Z', title: '', personIds: ['p1'], createdAt: 'x' },
      { id: 'drop', eventKey: `e2#2000-01-10T18:00:00.000Z`, eventStart: '2000-01-10T18:00:00.000Z', eventEnd: '2000-01-10T20:00:00.000Z', title: '', personIds: ['p1'], createdAt: 'x' },
    ];
    useEventPeopleStore.getState().initialize();
    expect(mockTable.map(r => r.id)).toEqual(['keep']);
    expect(useEventPeopleStore.getState().rows.map(r => r.id)).toEqual(['keep']);
  });

  it("reads server ids for the calendar's events", async () => {
    const calendar = useCalendarStore.getState() as unknown as { events: BusyEvent[] };
    calendar.events = [event()];
    mockExternalIds.mockResolvedValue({ e1: 'google-abc' });
    useEventPeopleStore.getState().initialize();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExternalIds).toHaveBeenCalledWith(['e1']);
    calendar.events = [];
  });
});

describe('setPeople', () => {
  it('writes a row and reads it back', () => {
    useEventPeopleStore.getState().setPeople(event(), ['p1']);
    expect(mockTable).toHaveLength(1);
    expect(useEventPeopleStore.getState().peopleFor(event())).toEqual(['p1']);
  });

  it('removes the row when the set goes empty', () => {
    useEventPeopleStore.getState().setPeople(event(), ['p1']);
    useEventPeopleStore.getState().setPeople(event(), []);
    expect(mockTable).toEqual([]);
  });

  it('writes under the server id once it is known', async () => {
    mockExternalIds.mockResolvedValue({ e1: 'google-abc' });
    await useEventPeopleStore.getState().resolveExternalIds([event()]);
    useEventPeopleStore.getState().setPeople(event(), ['p1']);
    expect(mockTable[0].eventKey.startsWith('google-abc#')).toBe(true);
  });
});

describe('resolveExternalIds', () => {
  it('asks only about ids it does not know yet', async () => {
    mockExternalIds.mockResolvedValue({ e1: 'google-abc' });
    await useEventPeopleStore.getState().resolveExternalIds([event()]);
    await useEventPeopleStore.getState().resolveExternalIds([event(), event({ id: 'e2' })]);
    expect(mockExternalIds).toHaveBeenLastCalledWith(['e2']);
  });

  it('keeps working with local ids when the native module fails', async () => {
    mockExternalIds.mockRejectedValue(new Error('not linked'));
    await useEventPeopleStore.getState().resolveExternalIds([event()]);
    useEventPeopleStore.getState().setPeople(event(), ['p1']);
    expect(mockTable[0].eventKey.startsWith('e1#')).toBe(true);
  });
});

describe('saveEvent', () => {
  const saveFields = { title: 'Dinner', start: new Date(2099, 0, 10, 18), end: new Date(2099, 0, 10, 19) };

  it('does nothing in demo mode, so no event reaches the real calendar', async () => {
    (isDemoModeActive as jest.Mock).mockReturnValue(true);
    await expect(useEventPeopleStore.getState().saveEvent(saveFields, ['p1'])).resolves.toBeNull();
    expect(saveEventDirect).not.toHaveBeenCalled();
  });

  it('links nobody and refreshes nothing when the write fails', async () => {
    (saveEventDirect as jest.Mock).mockResolvedValue(null);
    await expect(useEventPeopleStore.getState().saveEvent(saveFields, ['p1'])).resolves.toBeNull();
    expect(mockTable).toEqual([]);
    expect(useCalendarStore.getState().refresh).not.toHaveBeenCalled();
  });

  it('links the event at the span it wrote, under its server id, with no read back', async () => {
    (saveEventDirect as jest.Mock).mockResolvedValue({ id: 'new', calendarId: 'cal1' });
    mockExternalIds.mockResolvedValue({ new: 'google-new' });
    await expect(useEventPeopleStore.getState().saveEvent(saveFields, ['p1'])).resolves.toEqual({ id: 'new', calendarId: 'cal1' });
    expect(mockTable).toHaveLength(1);
    expect(mockTable[0].eventKey).toBe(`google-new#${saveFields.start.toISOString()}`);
    expect(useCalendarStore.getState().refresh).toHaveBeenCalled();
  });

  it('saves without linking when nobody was named', async () => {
    (saveEventDirect as jest.Mock).mockResolvedValue({ id: 'new', calendarId: 'cal1' });
    await expect(useEventPeopleStore.getState().saveEvent(saveFields)).resolves.not.toBeNull();
    expect(mockTable).toEqual([]);
  });
});

// Links are keyed by occurrence (id + start), so an edit that moves the event
// has to move its people with it, or they stay behind on the old slot.
describe('moveEvent', () => {
  const before = event();
  const start = new Date('2099-01-10T19:00:00.000Z');
  const end = new Date('2099-01-10T21:30:00.000Z');

  beforeEach(() => {
    mockExternalIds.mockResolvedValue({});
    useEventPeopleStore.getState().setPeople(before, ['p1']);
  });

  it('moves the event this occurrence only, and its people with it', async () => {
    (rescheduleEventDirect as jest.Mock).mockResolvedValue('e1');

    await expect(useEventPeopleStore.getState().moveEvent(before, start, end)).resolves.toBe('e1');

    expect(rescheduleEventDirect).toHaveBeenCalledWith('e1', 'Dinner', start, end, before.start);
    expect(useEventPeopleStore.getState().peopleFor(before)).toEqual([]);
    expect(useEventPeopleStore.getState().peopleFor({ id: 'e1', start: start.toISOString() })).toEqual(['p1']);
    expect(useCalendarStore.getState().refresh).toHaveBeenCalled();
  });

  it('leaves the links alone when the move fails', async () => {
    (rescheduleEventDirect as jest.Mock).mockResolvedValue(null);

    await expect(useEventPeopleStore.getState().moveEvent(before, start, end)).resolves.toBeNull();

    expect(useEventPeopleStore.getState().peopleFor(before)).toEqual(['p1']);
  });

  it('touches nothing in demo mode', async () => {
    (isDemoModeActive as jest.Mock).mockReturnValueOnce(true);
    await expect(useEventPeopleStore.getState().moveEvent(before, start, end)).resolves.toBeNull();
    expect(rescheduleEventDirect).not.toHaveBeenCalled();
  });
});

describe('updateEvent and deleteEvent', () => {
  const before = event();
  const moved = { title: 'Dinner', start: new Date('2099-01-11T18:00:00.000Z'), end: new Date('2099-01-11T20:00:00.000Z') };

  beforeEach(() => {
    mockExternalIds.mockResolvedValue({});
    useEventPeopleStore.getState().setPeople(before, ['p1']);
  });

  it('moves the people to the new time when the edit moved the event', async () => {
    (updateEventDirect as jest.Mock).mockResolvedValue('e1');

    await expect(useEventPeopleStore.getState().updateEvent('e1', before, moved, ['p1', 'p2'], before.start)).resolves.toBe('e1');

    expect(updateEventDirect).toHaveBeenCalledWith('e1', moved, before.start);
    expect(useEventPeopleStore.getState().peopleFor(before)).toEqual([]);
    expect(useEventPeopleStore.getState().peopleFor({ id: 'e1', start: moved.start.toISOString() })).toEqual(['p1', 'p2']);
    expect(useCalendarStore.getState().refresh).toHaveBeenCalled();
  });

  it('follows a new id EventKit handed back for the occurrence', async () => {
    (updateEventDirect as jest.Mock).mockResolvedValue('e1-detached');
    const same = { title: 'Dinner', start: new Date(before.start), end: new Date(before.end) };

    await useEventPeopleStore.getState().updateEvent('e1', before, same, ['p1']);

    expect(useEventPeopleStore.getState().peopleFor(before)).toEqual([]);
    expect(useEventPeopleStore.getState().peopleFor({ id: 'e1-detached', start: before.start })).toEqual(['p1']);
  });

  it('leaves the links alone when the save fails', async () => {
    (updateEventDirect as jest.Mock).mockResolvedValue(null);

    await expect(useEventPeopleStore.getState().updateEvent('e1', before, moved, [])).resolves.toBeNull();

    expect(useEventPeopleStore.getState().peopleFor(before)).toEqual(['p1']);
  });

  it('clears the people with the event it deletes, and only once it went', async () => {
    (deleteEventDirect as jest.Mock).mockResolvedValueOnce(false);
    await expect(useEventPeopleStore.getState().deleteEvent('e1', before)).resolves.toBe(false);
    expect(useEventPeopleStore.getState().peopleFor(before)).toEqual(['p1']);

    (deleteEventDirect as jest.Mock).mockResolvedValueOnce(true);
    await expect(useEventPeopleStore.getState().deleteEvent('e1', before)).resolves.toBe(true);
    expect(deleteEventDirect).toHaveBeenLastCalledWith('e1', before.start);
    expect(useEventPeopleStore.getState().peopleFor(before)).toEqual([]);
  });

  it('touches nothing in demo mode', async () => {
    (isDemoModeActive as jest.Mock).mockReturnValue(true);

    await expect(useEventPeopleStore.getState().updateEvent('e1', before, moved, [])).resolves.toBeNull();
    await expect(useEventPeopleStore.getState().deleteEvent('e1', before)).resolves.toBe(false);

    expect(updateEventDirect).not.toHaveBeenCalled();
    expect(deleteEventDirect).not.toHaveBeenCalled();
  });
});

// Keep the imports honest: these are asserted through the mock above.
void dbGetSetting;

describe('followMovedEvents', () => {
  const row = (over: Partial<EventPeopleLink> = {}): EventPeopleLink => ({
    id: 'r1',
    eventKey: 'e1#2099-01-10T18:00:00.000Z',
    eventStart: '2099-01-10T18:00:00.000Z',
    eventEnd: '2099-01-10T20:00:00.000Z',
    title: 'Dinner',
    personIds: ['p1'],
    createdAt: '2099-01-01T00:00:00.000Z',
    ...over,
  });
  const moved = event({ start: '2099-01-12T18:00:00.000Z', end: '2099-01-12T20:00:00.000Z' });

  function load(events: BusyEvent[], loaded = true) {
    Object.assign(useCalendarStore.getState(), {
      events, loaded, windowStart: '2099-01-01T00:00:00.000Z', windowEnd: '2099-01-20T00:00:00.000Z',
    });
  }

  it('moves a link to the slot its event now sits in', () => {
    mockTable = [row()];
    useEventPeopleStore.getState().initialize();
    load([moved]);
    useEventPeopleStore.getState().followMovedEvents();
    expect(mockTable).toHaveLength(1);
    expect(mockTable[0].eventKey).toBe('e1#2099-01-12T18:00:00.000Z');
    expect(mockTable[0].personIds).toEqual(['p1']);
    expect(useEventPeopleStore.getState().peopleFor(moved)).toEqual(['p1']);
  });

  it('keeps the row\'s id when it follows the event, so two devices write the same row', () => {
    mockTable = [row()];
    useEventPeopleStore.getState().initialize();
    load([moved]);
    useEventPeopleStore.getState().followMovedEvents();
    expect(mockTable.map(r => r.id)).toEqual(['r1']);
    expect(mockTable[0].eventStart).toBe(moved.start);
  });

  it('asks about the server ids of events only the grid read covers', async () => {
    mockExternalIds.mockResolvedValue({ g1: 'google-grid' });
    useEventPeopleStore.getState().initialize();
    Object.assign(useCalendarStore.getState(), { gridEvents: [event({ id: 'g1' })] });
    useEventPeopleStore.getState().initialize();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockExternalIds).toHaveBeenCalledWith(expect.arrayContaining(['g1']));
  });

  it('keeps people already linked to the new slot', () => {
    mockTable = [row(), row({ id: 'r2', eventKey: 'e1#2099-01-12T18:00:00.000Z', eventStart: moved.start, personIds: ['p2'] })];
    useEventPeopleStore.getState().initialize();
    load([moved]);
    useEventPeopleStore.getState().followMovedEvents();
    expect(useEventPeopleStore.getState().peopleFor(moved).sort()).toEqual(['p1', 'p2']);
    expect(mockTable).toHaveLength(1);
  });

  it('does nothing while the calendar window is unread, or in demo mode', () => {
    mockTable = [row()];
    useEventPeopleStore.getState().initialize();
    load([], false);
    useEventPeopleStore.getState().followMovedEvents();
    expect(mockTable[0].eventKey).toBe('e1#2099-01-10T18:00:00.000Z');
    load([moved]);
    (isDemoModeActive as jest.Mock).mockReturnValue(true);
    useEventPeopleStore.getState().followMovedEvents();
    expect(mockTable[0].eventKey).toBe('e1#2099-01-10T18:00:00.000Z');
  });
});
