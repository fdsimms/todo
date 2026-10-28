import { useTravelTimeStore, travelEstimatesWanted } from '../store/useTravelTimeStore';
import { estimateTravelMinutes } from '../services/travelTime';
import { isDemoModeActive } from '../utils/demoState';

const mockSettings = {
  dayResetTime: '00:00',
  travelTasks: true,
  travelEstimates: true,
  calendarReadEnabled: true,
  travelMode: 'driving' as 'driving' | 'transit' | 'walking',
  travelWalkUnderMinutes: 0,
  travelCompareModes: false,
  travelOriginPlaceId: null as string | null,
  travelLeadMinutes: 30,
  travelArriveEarlyMinutes: 0,
  travelLeadByCalendar: {} as Record<string, number>,
  travelEventPrefs: {} as Record<string, { mode: 'driving' | 'transit' | 'walking' | null; arriveEarlyMinutes: number | null }>,
};
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));
let mockCalendar: { events: unknown[]; loaded: boolean } = { events: [], loaded: true };
let mockPlaces: unknown[] = [];
jest.mock('../utils/savedPlaces', () => ({ readSavedPlaces: () => mockPlaces }));
jest.mock('../store/useCalendarStore', () => ({
  useCalendarStore: { getState: () => mockCalendar },
}));
jest.mock('../services/travelTime', () => ({ estimateTravelMinutes: jest.fn() }));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn(() => false) }));

const estimateMock = estimateTravelMinutes as jest.MockedFunction<typeof estimateTravelMinutes>;
const demoMock = isDemoModeActive as jest.MockedFunction<typeof isDemoModeActive>;

// Oct 5 2026, 9am local.
const NOW = new Date(2026, 9, 5, 9, 0, 0);
const event = (id: string, hour: number, overrides: Record<string, unknown> = {}) => ({
  id,
  title: 'Dentist',
  start: new Date(2026, 9, 5, hour, 0, 0).toISOString(),
  end: new Date(2026, 9, 5, hour + 1, 0, 0).toISOString(),
  allDay: false,
  calendarId: 'cal-1',
  location: '123 Main St',
  status: 'confirmed',
  availability: 'busy',
  ...overrides,
});
const key = (e: ReturnType<typeof event>) => `${e.id}|${e.start}`;

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  mockSettings.travelEstimates = true;
  mockSettings.travelMode = 'driving';
  mockSettings.travelWalkUnderMinutes = 0;
  mockSettings.travelCompareModes = false;
  mockSettings.travelEventPrefs = {};
  mockSettings.travelOriginPlaceId = null;
  mockPlaces = [];
  mockCalendar = { events: [event('a', 14)], loaded: true };
  estimateMock.mockReset();
  estimateMock.mockResolvedValue(18);
  demoMock.mockReturnValue(false);
  useTravelTimeStore.setState({ estimates: {}, refreshing: false });
});
afterEach(() => jest.useRealTimers());

describe('travelEstimatesWanted', () => {
  it('needs travel tasks, estimates and the calendar read all on', () => {
    expect(travelEstimatesWanted({ travelTasks: true, travelEstimates: true, calendarReadEnabled: true })).toBe(true);
    expect(travelEstimatesWanted({ travelTasks: true, travelEstimates: false, calendarReadEnabled: true })).toBe(false);
    expect(travelEstimatesWanted({ travelTasks: false, travelEstimates: true, calendarReadEnabled: true })).toBe(false);
    expect(travelEstimatesWanted({ travelTasks: true, travelEstimates: true, calendarReadEnabled: false })).toBe(false);
  });
});

describe('refresh with a walk-under threshold', () => {
  const e = event('a', 14);

  it('files a walk that comes in at or under the threshold, and asks only once', async () => {
    mockSettings.travelWalkUnderMinutes = 20;
    estimateMock.mockResolvedValue(20);
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock).toHaveBeenCalledTimes(1);
    expect(estimateMock.mock.calls[0][2]).toBe('walking');
    expect(useTravelTimeStore.getState().estimates[key(e)]).toMatchObject({ minutes: 20, mode: 'walking', walkUnder: 20 });
  });

  it('falls back to the Settings mode when the walk is longer', async () => {
    mockSettings.travelWalkUnderMinutes = 20;
    estimateMock.mockImplementation(async (_e, _d, mode) => (mode === 'walking' ? 35 : 12));
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock.mock.calls.map(c => c[2])).toEqual(['walking', 'driving']);
    expect(useTravelTimeStore.getState().estimates[key(e)]).toMatchObject({ minutes: 12, mode: 'driving', walkUnder: 20 });
  });

  it('falls back to the Settings mode when the walk cannot be estimated', async () => {
    mockSettings.travelWalkUnderMinutes = 20;
    estimateMock.mockImplementation(async (_e, _d, mode) => (mode === 'walking' ? null : 12));
    await useTravelTimeStore.getState().refresh();
    expect(useTravelTimeStore.getState().estimates[key(e)]).toMatchObject({ minutes: 12, mode: 'driving' });
  });

  it('does not ask again while fresh, but does once the threshold changes', async () => {
    mockSettings.travelWalkUnderMinutes = 20;
    estimateMock.mockResolvedValue(15);
    await useTravelTimeStore.getState().refresh();
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock).toHaveBeenCalledTimes(1);
    mockSettings.travelWalkUnderMinutes = 10;
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock.mock.calls.length).toBeGreaterThan(1);
    expect(useTravelTimeStore.getState().estimates[key(e)]).toMatchObject({ mode: 'driving', walkUnder: 10 });
  });

  it('leaves an event with a mode of its own alone', async () => {
    mockSettings.travelWalkUnderMinutes = 20;
    mockSettings.travelEventPrefs = { a: { mode: 'transit', arriveEarlyMinutes: 0 } };
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock).toHaveBeenCalledTimes(1);
    expect(estimateMock.mock.calls[0][2]).toBe('transit');
    expect(useTravelTimeStore.getState().estimates[key(e)].walkUnder).toBeUndefined();
  });

  it('asks nothing extra when the Settings mode is already walking', async () => {
    mockSettings.travelWalkUnderMinutes = 20;
    mockSettings.travelMode = 'walking';
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock).toHaveBeenCalledTimes(1);
  });
});

describe('refresh', () => {
  it('estimates an upcoming event, asked for the moment the typed lead says to leave', async () => {
    await useTravelTimeStore.getState().refresh();
    const e = event('a', 14);
    expect(estimateMock).toHaveBeenCalledWith(e, new Date(2026, 9, 5, 13, 30, 0), 'driving', null);
    expect(useTravelTimeStore.getState().estimates[key(e)]).toEqual({
      minutes: 18, location: '123 Main St', mode: 'driving', origin: 'current', at: NOW.getTime(),
    });
  });

  it('does not ask again while the estimate is fresh, but does once the mode changes', async () => {
    await useTravelTimeStore.getState().refresh();
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock).toHaveBeenCalledTimes(1);
    mockSettings.travelMode = 'transit' as never;
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock).toHaveBeenCalledTimes(2);
  });

  it('starts the trip from the saved place the setting names, and asks again when it changes', async () => {
    mockPlaces = [{ id: 'home', name: 'Home', text: '1 Home St', latitude: 40.7128, longitude: -74.006 }];
    mockSettings.travelOriginPlaceId = 'home';
    await useTravelTimeStore.getState().refresh();
    const e = event('a', 14);
    expect(estimateMock).toHaveBeenLastCalledWith(
      e, new Date(2026, 9, 5, 13, 30, 0), 'driving',
      { name: 'Home', latitude: 40.7128, longitude: -74.006 },
    );
    expect(useTravelTimeStore.getState().estimates[key(e)].origin).toBe('at:40.71280,-74.00600');

    // Back to where the phone is: the held trip started elsewhere, so it is asked again.
    mockSettings.travelOriginPlaceId = null;
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock).toHaveBeenCalledTimes(2);
    expect(estimateMock).toHaveBeenLastCalledWith(e, new Date(2026, 9, 5, 13, 30, 0), 'driving', null);
  });

  it('starts from where the phone is when the chosen place was removed', async () => {
    mockSettings.travelOriginPlaceId = 'gone';
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock).toHaveBeenCalledWith(event('a', 14), new Date(2026, 9, 5, 13, 30, 0), 'driving', null);
  });

  it('skips events with no location, all-day events and ones past the horizon', async () => {
    mockCalendar = {
      events: [
        event('a', 14, { location: '' }),
        event('b', 14, { allDay: true }),
        event('c', 14, { start: new Date(2026, 9, 9, 14).toISOString(), end: new Date(2026, 9, 9, 15).toISOString() }),
      ],
      loaded: true,
    };
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock).not.toHaveBeenCalled();
  });

  it('asks nothing in demo mode, with the switch off, or before the calendar is read', async () => {
    demoMock.mockReturnValue(true);
    await useTravelTimeStore.getState().refresh();
    demoMock.mockReturnValue(false);
    mockSettings.travelEstimates = false;
    await useTravelTimeStore.getState().refresh();
    mockSettings.travelEstimates = true;
    mockCalendar = { events: [event('a', 14)], loaded: false };
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock).not.toHaveBeenCalled();
  });

  it("asks by the event's own mode, and for the departure its arrival offset gives", async () => {
    mockSettings.travelEventPrefs = { a: { mode: 'walking', arriveEarlyMinutes: 10 } };
    await useTravelTimeStore.getState().refresh();
    const [, departAt, mode] = estimateMock.mock.calls[0];
    expect(mode).toBe('walking');
    // 14:00 start, 30 minute typed lead, 10 minutes early.
    expect(departAt).toEqual(new Date(2026, 9, 5, 13, 20));
  });

  it('keeps no estimate for a failed one, so it is asked again next time', async () => {
    estimateMock.mockResolvedValue(null);
    await useTravelTimeStore.getState().refresh();
    expect(useTravelTimeStore.getState().estimates).toEqual({});
  });

  it('drops estimates for events no longer coming up', async () => {
    await useTravelTimeStore.getState().refresh();
    mockCalendar = { events: [], loaded: true };
    await useTravelTimeStore.getState().refresh();
    expect(useTravelTimeStore.getState().estimates).toEqual({});
  });

  it('writes nothing back when cleared mid-request', async () => {
    let resolve: (n: number) => void = () => {};
    estimateMock.mockImplementation(() => new Promise<number>(r => { resolve = r; }));
    const pending = useTravelTimeStore.getState().refresh();
    useTravelTimeStore.getState().clear();
    resolve(18);
    await pending;
    expect(useTravelTimeStore.getState().estimates).toEqual({});
  });
});

describe('refresh with the comparison on', () => {
  const e = event('a', 14);

  it('also asks the other two modes and files them with the estimate', async () => {
    mockSettings.travelCompareModes = true;
    estimateMock.mockImplementation(async (_e, _d, mode) => ({ driving: 8, transit: 13, walking: 22 })[mode]);
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock.mock.calls.map(c => c[2]).sort()).toEqual(['driving', 'transit', 'walking']);
    expect(useTravelTimeStore.getState().estimates[key(e)]).toMatchObject({ minutes: 8, mode: 'driving', others: { transit: 13, walking: 22 } });
  });

  it('keeps a mode that cannot be routed out of the others, and does not ask again for it', async () => {
    mockSettings.travelCompareModes = true;
    estimateMock.mockImplementation(async (_e, _d, mode) => (mode === 'transit' ? null : 10));
    await useTravelTimeStore.getState().refresh();
    expect(useTravelTimeStore.getState().estimates[key(e)].others).toEqual({ walking: 10 });
    estimateMock.mockClear();
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock).not.toHaveBeenCalled();
  });

  it('reuses the walk it already asked for under Walk if close', async () => {
    mockSettings.travelCompareModes = true;
    mockSettings.travelWalkUnderMinutes = 20;
    estimateMock.mockImplementation(async (_e, _d, mode) => (mode === 'walking' ? 35 : 12));
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock.mock.calls.filter(c => c[2] === 'walking')).toHaveLength(1);
    expect(useTravelTimeStore.getState().estimates[key(e)]).toMatchObject({ mode: 'driving', others: { walking: 35, transit: 12 } });
  });

  it('asks nothing extra with the comparison off, and fills the others in once it is switched on', async () => {
    await useTravelTimeStore.getState().refresh();
    expect(estimateMock).toHaveBeenCalledTimes(1);
    expect(useTravelTimeStore.getState().estimates[key(e)].others).toBeUndefined();
    mockSettings.travelCompareModes = true;
    await useTravelTimeStore.getState().refresh();
    expect(useTravelTimeStore.getState().estimates[key(e)].others).toBeDefined();
  });

  it('switchMode re-files a held estimate under another mode it answered', async () => {
    mockSettings.travelCompareModes = true;
    estimateMock.mockImplementation(async (_e, _d, mode) => ({ driving: 8, transit: 13, walking: 22 })[mode]);
    await useTravelTimeStore.getState().refresh();
    useTravelTimeStore.getState().switchMode(key(e), 'walking');
    expect(useTravelTimeStore.getState().estimates[key(e)]).toMatchObject({ minutes: 22, mode: 'walking', others: { driving: 8, transit: 13 } });
  });
});
