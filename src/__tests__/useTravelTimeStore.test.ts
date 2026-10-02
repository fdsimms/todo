import { useTravelTimeStore, travelEstimatesWanted } from '../store/useTravelTimeStore';
import { estimateTravelMinutes } from '../services/travelTime';
import { isDemoModeActive } from '../utils/demoState';

const mockSettings = {
  dayResetTime: '00:00',
  travelTasks: true,
  travelEstimates: true,
  calendarReadEnabled: true,
  travelMode: 'driving' as const,
  travelLeadMinutes: 30,
  travelLeadByCalendar: {} as Record<string, number>,
};
jest.mock('../store/useSettingsStore', () => ({
  useSettingsStore: { getState: () => mockSettings },
}));
let mockCalendar: { events: unknown[]; loaded: boolean } = { events: [], loaded: true };
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

describe('refresh', () => {
  it('estimates an upcoming event, asked for the moment the typed lead says to leave', async () => {
    await useTravelTimeStore.getState().refresh();
    const e = event('a', 14);
    expect(estimateMock).toHaveBeenCalledWith(e, new Date(2026, 9, 5, 13, 30, 0), 'driving');
    expect(useTravelTimeStore.getState().estimates[key(e)]).toEqual({
      minutes: 18, location: '123 Main St', mode: 'driving', at: NOW.getTime(),
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
