/**
 * The store that holds today's weather reading.
 *
 * Scoped to the part with branching of its own: when a reading is asked for,
 * and whether one that arrives late is still allowed to be written. The
 * fetching itself belongs to `weatherLookup`/`weatherLocation`, which have
 * their own tests.
 */
import { useWeatherStore } from '../store/useWeatherStore';
import { getCurrentLocation } from '../utils/weatherLocation';
import { fetchWeatherSnapshot } from '../services/weatherLookup';
import { isDemoModeActive } from '../utils/demoState';

// Same reason every other store test stubs it: pulling in the real module
// drags expo-sqlite into the graph, and nothing here touches the database.
jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

jest.mock('../utils/weatherLocation', () => ({ getCurrentLocation: jest.fn() }));
jest.mock('../services/weatherLookup', () => ({ fetchWeatherSnapshot: jest.fn() }));
jest.mock('../utils/demoState', () => ({ isDemoModeActive: jest.fn(() => false) }));

const SNAPSHOT = {
  condition: 'clear',
  highC: 21,
  lowC: 11,
  precipitationChance: 0,
  readAt: '2026-01-01T09:00:00.000Z',
  // Just read, so the staleness rule below leaves it alone. Stamped at load
  // rather than written out, since what matters is that it is recent.
  fetchedAt: new Date().toISOString(),
} as never;

const reset = () =>
  useWeatherStore.setState({ snapshot: null, snapshotDayKey: null, refreshing: false });

beforeEach(() => {
  jest.clearAllMocks();
  reset();
  (isDemoModeActive as jest.Mock).mockReturnValue(false);
  (getCurrentLocation as jest.Mock).mockResolvedValue({ latitude: 51.5, longitude: -0.1 });
  (fetchWeatherSnapshot as jest.Mock).mockResolvedValue(SNAPSHOT);
});

describe('refresh', () => {
  it('stores the snapshot it read', async () => {
    await useWeatherStore.getState().refresh();
    expect(useWeatherStore.getState().snapshot).toEqual(SNAPSHOT);
    expect(useWeatherStore.getState().snapshotDayKey).not.toBeNull();
  });

  it('reads nothing in demo mode', async () => {
    (isDemoModeActive as jest.Mock).mockReturnValue(true);
    await useWeatherStore.getState().refresh();
    expect(getCurrentLocation).not.toHaveBeenCalled();
    expect(useWeatherStore.getState().snapshot).toBeNull();
  });

  it('leaves the day without a snapshot when location is refused', async () => {
    (getCurrentLocation as jest.Mock).mockResolvedValue(null);
    await useWeatherStore.getState().refresh();
    expect(fetchWeatherSnapshot).not.toHaveBeenCalled();
    expect(useWeatherStore.getState().snapshot).toBeNull();
  });

  it('does not read again while the snapshot it holds is fresh', async () => {
    await useWeatherStore.getState().refresh();
    await useWeatherStore.getState().refresh();
    expect(fetchWeatherSnapshot).toHaveBeenCalledTimes(1);
  });

  // A weather task names an hour now, so a forecast that moves has to be able
  // to correct one — see SNAPSHOT_STALE_MS. Still not a poll: this only
  // decides what a trigger that was happening anyway does.
  it('reads again on the next trigger once the snapshot has gone stale', async () => {
    await useWeatherStore.getState().refresh();
    useWeatherStore.setState({
      snapshot: { ...(SNAPSHOT as object), fetchedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() } as never,
    });

    await useWeatherStore.getState().refresh();

    expect(fetchWeatherSnapshot).toHaveBeenCalledTimes(2);
  });

  // Date.parse of something that isn't a date is NaN, which must read as "get
  // a fresh one" rather than stranding the day on an unreplaceable reading.
  it('treats a snapshot with an unreadable timestamp as stale', async () => {
    await useWeatherStore.getState().refresh();
    useWeatherStore.setState({ snapshot: { ...(SNAPSHOT as object), fetchedAt: 'not a date' } as never });

    await useWeatherStore.getState().refresh();

    expect(fetchWeatherSnapshot).toHaveBeenCalledTimes(2);
  });
});

// The switch being turned off mid-read. Without the guard the awaited fetch
// resolves after `clear` and writes the reading straight back, so the feature
// reads as on with data the user just asked it to drop.
describe('a read that lands after the feature was switched off', () => {
  it('is not written back', async () => {
    let release: (v: unknown) => void = () => {};
    (fetchWeatherSnapshot as jest.Mock).mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      })
    );

    const inFlight = useWeatherStore.getState().refresh();
    useWeatherStore.getState().clear();
    release(SNAPSHOT);
    await inFlight;

    expect(useWeatherStore.getState().snapshot).toBeNull();
    expect(useWeatherStore.getState().snapshotDayKey).toBeNull();
  });

  it('lets the next read write normally', async () => {
    useWeatherStore.getState().clear();
    await useWeatherStore.getState().refresh();
    expect(useWeatherStore.getState().snapshot).toEqual(SNAPSHOT);
  });
});
