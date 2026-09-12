/**
 * The store holding what Apple Health says.
 *
 * Scoped to the branching it owns: what a read writes, and whether a read that
 * lands after access was dropped is still allowed to write it. The bridge and
 * its refusals are `healthBridge`'s, and the rule they enforce is written up in
 * `docs/arch/health-data.md`.
 */
import { useHealthStore } from '../store/useHealthStore';
import { healthBridge } from '../utils/healthBridge';

// Same reason every other store test stubs it: the real module drags
// expo-sqlite into the graph, and nothing here touches the database.
jest.mock('../db/database', () => ({
  dbGetSetting: jest.fn().mockReturnValue(null),
  dbSetSetting: jest.fn(),
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
}));

jest.mock('../utils/healthBridge', () => ({ healthBridge: jest.fn() }));

let bridge: { readDailyHealth: jest.Mock; readWeightSeries: jest.Mock };

const reading = (over: Record<string, unknown> = {}) =>
  ({
    start: '2026-01-01T00:00:00.000Z',
    steps: 4200,
    sleepMinutes: 450,
    ...over,
  } as never);

beforeEach(() => {
  jest.clearAllMocks();
  bridge = {
    readDailyHealth: jest.fn().mockResolvedValue([reading()]),
    readWeightSeries: jest
      .fn()
      .mockResolvedValue([{ start: '2026-01-01T00:00:00.000Z', kilograms: 70 }]),
  };
  (healthBridge as jest.Mock).mockReturnValue(bridge);
  useHealthStore.setState({
    today: null,
    refreshing: false,
    history: null,
    loadingHistory: false,
    weightSeries: null,
    loadingWeight: false,
  });
});

describe('refresh', () => {
  it("writes today's reading", async () => {
    await useHealthStore.getState().refresh();
    expect(useHealthStore.getState().today?.steps).toBe(4200);
    // Minutes are what HealthKit measures; hours are what the insight speaks in.
    expect(useHealthStore.getState().today?.sleepHours).toBe(7.5);
  });

  // A null answer is the current truth rather than a failed read to paper over.
  it('writes a day with nothing recorded as nulls, not as a gap', async () => {
    bridge.readDailyHealth.mockResolvedValue([]);
    await useHealthStore.getState().refresh();
    expect(useHealthStore.getState().today).not.toBeNull();
    expect(useHealthStore.getState().today?.steps).toBeNull();
  });

  it('does nothing without the bridge, which is also the demo-mode refusal', async () => {
    (healthBridge as jest.Mock).mockReturnValue(null);
    await useHealthStore.getState().refresh();
    expect(bridge.readDailyHealth).not.toHaveBeenCalled();
    expect(useHealthStore.getState().today).toBeNull();
  });
});

describe('refreshHistory and refreshWeight', () => {
  it('fills the trailing windows', async () => {
    await useHealthStore.getState().refreshHistory();
    await useHealthStore.getState().refreshWeight();
    expect(useHealthStore.getState().history).toHaveLength(1);
    expect(useHealthStore.getState().weightSeries).toEqual([
      { dayKey: expect.any(String), kilograms: 70 },
    ]);
  });

  it('skips a reading whose instant cannot be read', async () => {
    bridge.readDailyHealth.mockResolvedValue([reading({ start: 'not a date' })]);
    await useHealthStore.getState().refreshHistory();
    expect(useHealthStore.getState().history).toEqual([]);
  });
});

/**
 * Access being revoked, or the feature switched off, while a read is in flight.
 *
 * This is the rule the whole feature rests on: holding the last good numbers
 * would keep reporting a figure after access was withdrawn. `clear` drops them,
 * and without the guard the awaited read resolves afterwards and puts them
 * straight back.
 */
describe('a read that lands after access was dropped', () => {
  const raceOn = async (
    call: () => Promise<void>,
    mock: jest.Mock,
    resolveWith: unknown
  ) => {
    let release: (v: unknown) => void = () => {};
    mock.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      })
    );
    const inFlight = call();
    useHealthStore.getState().clear();
    release(resolveWith);
    await inFlight;
  };

  it("does not write today's reading back", async () => {
    await raceOn(() => useHealthStore.getState().refresh(), bridge.readDailyHealth, [reading()]);
    expect(useHealthStore.getState().today).toBeNull();
  });

  it('does not write the history window back', async () => {
    await raceOn(
      () => useHealthStore.getState().refreshHistory(),
      bridge.readDailyHealth,
      [reading()]
    );
    expect(useHealthStore.getState().history).toBeNull();
  });

  it('does not draw the weight chart back', async () => {
    await raceOn(() => useHealthStore.getState().refreshWeight(), bridge.readWeightSeries, [
      { start: '2026-01-01T00:00:00.000Z', kilograms: 70 },
    ]);
    expect(useHealthStore.getState().weightSeries).toBeNull();
  });

  // One guard per read, not one per store: dropping the weight chart must not
  // cancel a reading of today that is legitimately in flight beside it.
  it('leaves an unrelated read in flight alone', async () => {
    let release: (v: unknown) => void = () => {};
    bridge.readDailyHealth.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      })
    );
    const inFlight = useHealthStore.getState().refresh();
    await useHealthStore.getState().refreshWeight();
    release([reading()]);
    await inFlight;
    expect(useHealthStore.getState().today?.steps).toBe(4200);
  });
});
