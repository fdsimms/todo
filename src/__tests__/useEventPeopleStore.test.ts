import { useEventPeopleStore, EVENT_PEOPLE_SETTING_KEY } from '../store/useEventPeopleStore';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { presentEventCreate, readTimeBlockEvent } from '../utils/calendarSync';
import { isDemoModeActive } from '../utils/demoState';
import { useCalendarStore } from '../store/useCalendarStore';
import { eventPeopleKey } from '../utils/eventPeople';
import type { BusyEvent } from '../utils/calendarBusy';

jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
}));
jest.mock('../utils/calendarSync', () => ({
  presentEventCreate: jest.fn(),
  readTimeBlockEvent: jest.fn(),
}));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn().mockReturnValue(false) }));
jest.mock('../store/useCalendarStore', () => {
  const refresh = jest.fn().mockResolvedValue(undefined);
  return { useCalendarStore: { getState: () => ({ refresh }) } };
});
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => ({ dayResetTime: '00:00', weekStartsOn: 0 }) },
}));

const event = (over: Partial<BusyEvent> = {}): BusyEvent => ({
  id: 'e1',
  title: 'Dinner',
  start: '2099-01-10T18:00:00.000Z',
  end: '2099-01-10T20:00:00.000Z',
  allDay: false,
  calendarId: 'cal',
  location: null,
  status: 'confirmed',
  availability: 'busy',
  ...over,
});

const fields = { title: 'With Dustin', start: new Date(2099, 0, 10, 18), end: new Date(2099, 0, 10, 19) };

beforeEach(() => {
  jest.clearAllMocks();
  (dbGetSetting as jest.Mock).mockReturnValue(null);
  (isDemoModeActive as jest.Mock).mockReturnValue(false);
  useEventPeopleStore.setState({ links: {}, loaded: false });
});

describe('initialize', () => {
  it('loads stored links and prunes the ones past the history window', () => {
    const keep = { key: 'a', eventId: 'e1', eventStart: '2099-01-10T18:00:00.000Z', eventEnd: '2099-01-10T20:00:00.000Z', title: '', personIds: ['p1'] };
    const drop = { key: 'b', eventId: 'e2', eventStart: '2000-01-10T18:00:00.000Z', eventEnd: '2000-01-10T20:00:00.000Z', title: '', personIds: ['p1'] };
    (dbGetSetting as jest.Mock).mockReturnValue(JSON.stringify({ a: keep, b: drop }));
    useEventPeopleStore.getState().initialize();
    expect(Object.keys(useEventPeopleStore.getState().links)).toEqual(['a']);
    expect(dbSetSetting).toHaveBeenCalledWith(EVENT_PEOPLE_SETTING_KEY, expect.not.stringContaining('e2'));
  });
});

describe('setPeople', () => {
  it('links and persists', () => {
    useEventPeopleStore.getState().setPeople(event(), ['p1']);
    expect(useEventPeopleStore.getState().peopleFor(event())).toEqual(['p1']);
    expect(dbSetSetting).toHaveBeenCalledWith(EVENT_PEOPLE_SETTING_KEY, expect.stringContaining('p1'));
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
    expect(useEventPeopleStore.getState().links).toEqual({});
    expect(useCalendarStore.getState().refresh).not.toHaveBeenCalled();
  });

  it('links the saved event at the start the user saved, not the prefill', async () => {
    (presentEventCreate as jest.Mock).mockResolvedValue({ saved: true, deleted: false, eventId: 'new' });
    const movedStart = new Date(2099, 0, 11, 19);
    (readTimeBlockEvent as jest.Mock).mockResolvedValue({
      title: 'Dinner with Dustin', start: movedStart, end: new Date(2099, 0, 11, 21), allDay: false,
    });
    await expect(useEventPeopleStore.getState().createEvent(fields, ['p1'])).resolves.toBe(true);
    const key = eventPeopleKey({ id: 'new', start: movedStart.toISOString() });
    expect(useEventPeopleStore.getState().links[key]?.personIds).toEqual(['p1']);
    expect(useEventPeopleStore.getState().links[key]?.title).toBe('Dinner with Dustin');
    expect(useCalendarStore.getState().refresh).toHaveBeenCalled();
  });

  it('saves without linking when nobody was named', async () => {
    (presentEventCreate as jest.Mock).mockResolvedValue({ saved: true, deleted: false, eventId: 'new' });
    await expect(useEventPeopleStore.getState().createEvent(fields)).resolves.toBe(true);
    expect(readTimeBlockEvent).not.toHaveBeenCalled();
    expect(useEventPeopleStore.getState().links).toEqual({});
  });

  it('keeps the event but skips the link when it cannot be read back', async () => {
    (presentEventCreate as jest.Mock).mockResolvedValue({ saved: true, deleted: false, eventId: 'new' });
    (readTimeBlockEvent as jest.Mock).mockResolvedValue(null);
    await expect(useEventPeopleStore.getState().createEvent(fields, ['p1'])).resolves.toBe(true);
    expect(useEventPeopleStore.getState().links).toEqual({});
  });
});
