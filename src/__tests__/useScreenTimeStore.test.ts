/**
 * The store holding what the Screen Time extension has reported.
 *
 * Scoped to the branching it owns: draining, arming, consuming, and whether a
 * drain that lands late is still allowed to be kept. `screenTimeRules` owns
 * which rules are armable and has its own tests.
 */
import { useScreenTimeStore } from '../store/useScreenTimeStore';
import { screenTimeBridge } from '../utils/screenTimeBridge';

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

jest.mock('../utils/screenTimeBridge', () => ({ screenTimeBridge: jest.fn() }));

const crossing = (ruleId: string) =>
  ({ ruleId, crossedAt: '2026-01-01T10:00:00.000Z' } as never);

let bridge: {
  drainCrossings: jest.Mock;
  startMonitoring: jest.Mock;
  stopMonitoring: jest.Mock;
};

beforeEach(() => {
  jest.clearAllMocks();
  bridge = {
    drainCrossings: jest.fn().mockResolvedValue([]),
    startMonitoring: jest.fn().mockResolvedValue(undefined),
    stopMonitoring: jest.fn(),
  };
  (screenTimeBridge as jest.Mock).mockReturnValue(bridge);
  useScreenTimeStore.setState({ crossings: [], refreshing: false });
});

describe('refresh', () => {
  it('keeps what the extension reported', async () => {
    bridge.drainCrossings.mockResolvedValue([crossing('a')]);
    await useScreenTimeStore.getState().refresh();
    expect(useScreenTimeStore.getState().crossings).toHaveLength(1);
  });

  // Appended rather than replacing: a drain between one sweep and the next
  // must not discard what the previous drain is still holding.
  it('appends to what is already held', async () => {
    bridge.drainCrossings.mockResolvedValue([crossing('a')]);
    await useScreenTimeStore.getState().refresh();
    bridge.drainCrossings.mockResolvedValue([crossing('b')]);
    await useScreenTimeStore.getState().refresh();
    expect(useScreenTimeStore.getState().crossings.map(c => c.ruleId)).toEqual(['a', 'b']);
  });

  it('does nothing without the bridge', async () => {
    (screenTimeBridge as jest.Mock).mockReturnValue(null);
    await useScreenTimeStore.getState().refresh();
    expect(bridge.drainCrossings).not.toHaveBeenCalled();
  });
});

describe('consume', () => {
  it('drops only the rules that were acted on', async () => {
    bridge.drainCrossings.mockResolvedValue([crossing('a'), crossing('b')]);
    await useScreenTimeStore.getState().refresh();
    useScreenTimeStore.getState().consume(['a']);
    expect(useScreenTimeStore.getState().crossings.map(c => c.ruleId)).toEqual(['b']);
  });
});

// The switch being turned off mid-drain. Without the guard the awaited drain
// resolves after `clear` and appends crossings for rules that are no longer
// armed, which then raise a task nobody asked for.
describe('a drain that lands after the feature was switched off', () => {
  it('is dropped rather than appended', async () => {
    let release: (v: unknown) => void = () => {};
    bridge.drainCrossings.mockReturnValue(
      new Promise(resolve => {
        release = resolve;
      })
    );

    const inFlight = useScreenTimeStore.getState().refresh();
    useScreenTimeStore.getState().clear();
    release([crossing('a')]);
    await inFlight;

    expect(useScreenTimeStore.getState().crossings).toEqual([]);
  });

  it('lets the next drain keep what it finds', async () => {
    useScreenTimeStore.getState().clear();
    bridge.drainCrossings.mockResolvedValue([crossing('a')]);
    await useScreenTimeStore.getState().refresh();
    expect(useScreenTimeStore.getState().crossings).toHaveLength(1);
  });
});
