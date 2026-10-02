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
import { presentEventCreate, readTimeBlockEvent } from '../utils/calendarSync';
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
  presentEventCreate: jest.fn(),
  readTimeBlockEvent: jest.fn(),
}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn().mockReturnValue(false) }));
jest.mock('../store/useCalendarStore', () => {
  const refresh = jest.fn().mockResolvedValue(undefined);
  const state = { refresh, events: [], pastEvents: [] };
  return { useCalendarStore: { getState: () => state, subscribe: jest.fn() } };
});
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));
const mockExternalIds = jest.fn();
jest.mock('todo-eventkit-bridge', () => ({ externalIdentifiers: (ids: string[]) => mockExternalIds(ids) }), { virtual: true });

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

const fields = { title: 'With Dustin', start: new Date(2099, 0, 10, 18), end: new Date(2099, 0, 10, 19) };

beforeEach(() => {
  jest.clearAllMocks();
  mockTable = [];
  mockSettings = { [EVENT_PEOPLE_MIGRATION_FLAG]: '1' };
  mockExternalIds.mockResolvedValue({});
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

describe('createEvent', () => {
  it('does nothing in demo mode, so no event reaches the real calendar', async () => {
    (isDemoModeActive as jest.Mock).mockReturnValue(true);
    await expect(useEventPeopleStore.getState().createEvent(fields, ['p1'])).resolves.toBe(false);
    expect(presentEventCreate).not.toHaveBeenCalled();
  });

  it('links nobody when the sheet is cancelled', async () => {
    (presentEventCreate as jest.Mock).mockResolvedValue({ saved: false, deleted: false, eventId: null });
    await expect(useEventPeopleStore.getState().createEvent(fields, ['p1'])).resolves.toBe(false);
    expect(mockTable).toEqual([]);
    expect(useCalendarStore.getState().refresh).not.toHaveBeenCalled();
  });

  it('links the saved event at the start the user saved, under its server id', async () => {
    (presentEventCreate as jest.Mock).mockResolvedValue({ saved: true, deleted: false, eventId: 'new' });
    const movedStart = new Date(2099, 0, 11, 19);
    (readTimeBlockEvent as jest.Mock).mockResolvedValue({
      title: 'Dinner with Dustin', start: movedStart, end: new Date(2099, 0, 11, 21), allDay: false,
    });
    mockExternalIds.mockResolvedValue({ new: 'google-new' });
    await expect(useEventPeopleStore.getState().createEvent(fields, ['p1'])).resolves.toBe(true);
    expect(mockTable).toHaveLength(1);
    expect(mockTable[0].eventKey).toBe(`google-new#${movedStart.toISOString()}`);
    expect(mockTable[0].title).toBe('Dinner with Dustin');
    expect(useCalendarStore.getState().refresh).toHaveBeenCalled();
  });

  it('saves without linking when nobody was named', async () => {
    (presentEventCreate as jest.Mock).mockResolvedValue({ saved: true, deleted: false, eventId: 'new' });
    await expect(useEventPeopleStore.getState().createEvent(fields)).resolves.toBe(true);
    expect(readTimeBlockEvent).not.toHaveBeenCalled();
    expect(mockTable).toEqual([]);
  });

  it('keeps the event but skips the link when it cannot be read back', async () => {
    (presentEventCreate as jest.Mock).mockResolvedValue({ saved: true, deleted: false, eventId: 'new' });
    (readTimeBlockEvent as jest.Mock).mockResolvedValue(null);
    await expect(useEventPeopleStore.getState().createEvent(fields, ['p1'])).resolves.toBe(true);
    expect(mockTable).toEqual([]);
  });
});

// Keep the imports honest: these are asserted through the mock above.
void dbGetSetting;
