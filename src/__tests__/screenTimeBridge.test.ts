/**
 * The one gate on iOS Screen Time — the shield written to a system store that
 * survives the app being killed, the monitor armed with the OS, and the
 * read-and-clear drain of crossed thresholds.
 *
 * Worth testing directly rather than through its callers, exactly as
 * widgetBridge.test.ts argues: they are hooks and store actions driving a
 * native module, none of which is reachable from a node test env.
 */
let mockPlatformOS = 'ios';
jest.mock('react-native', () => ({
  get Platform() {
    return { OS: mockPlatformOS };
  },
}));

let mockDemoMode = false;
jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => mockDemoMode }));

// Named `mock…` so jest allows the factory to close over it.
const mockNativeBridge = {
  isScreenTimeAvailable: jest.fn(() => true),
  screenTimeAuthorizationStatus: jest.fn(),
  requestScreenTimeAuthorization: jest.fn(),
  presentAppPicker: jest.fn(),
  screenTimeSelectionCount: jest.fn(),
  clearScreenTimeSelection: jest.fn(),
  applyShield: jest.fn(),
  clearShield: jest.fn(),
  startMonitoring: jest.fn(),
  stopMonitoring: jest.fn(),
  drainCrossings: jest.fn(),
};
let mockNativeMissing = false;
jest.mock('todo-screentime-bridge', () => {
  // What Expo Go and Android actually do: expo-modules-core's
  // requireNativeModule throws at the top of the package.
  if (mockNativeMissing) throw new Error('Cannot find native module');
  return mockNativeBridge;
});

import { isScreenTimeSupported, screenTimeBridge } from '../utils/screenTimeBridge';

beforeEach(() => {
  mockPlatformOS = 'ios';
  mockDemoMode = false;
  mockNativeMissing = false;
  mockNativeBridge.isScreenTimeAvailable.mockReturnValue(true);
});

describe('screenTimeBridge', () => {
  it('opens on iOS with the native module present', () => {
    expect(screenTimeBridge()).toBe(mockNativeBridge);
  });

  it('is closed off iOS, where none of these frameworks exist', () => {
    mockPlatformOS = 'android';
    expect(screenTimeBridge()).toBeNull();
  });

  it('is closed in demo mode, so seeded fiction cannot block real apps', () => {
    mockDemoMode = true;
    expect(screenTimeBridge()).toBeNull();
  });

  it('re-reads demo mode on every call rather than answering from launch', () => {
    expect(screenTimeBridge()).not.toBeNull();
    mockDemoMode = true;
    expect(screenTimeBridge()).toBeNull();
    mockDemoMode = false;
    expect(screenTimeBridge()).not.toBeNull();
  });

  it('closes the drain in demo mode too — it is the half that loses something', () => {
    // drainCrossings is read-and-clear, so calling it against a database about
    // to be thrown away destroys the crossing. Same reasoning as the widget's
    // two queues.
    mockDemoMode = true;
    expect(screenTimeBridge()?.drainCrossings).toBeUndefined();
  });
});

describe('isScreenTimeSupported', () => {
  it('is false when the gate is closed, without asking the native module', () => {
    mockDemoMode = true;
    expect(isScreenTimeSupported()).toBe(false);
    expect(mockNativeBridge.isScreenTimeAvailable).not.toHaveBeenCalled();
  });

  it('defers to the native answer when the gate is open', () => {
    mockNativeBridge.isScreenTimeAvailable.mockReturnValue(false);
    expect(isScreenTimeSupported()).toBe(false);

    mockNativeBridge.isScreenTimeAvailable.mockReturnValue(true);
    expect(isScreenTimeSupported()).toBe(true);
  });
});

describe('screenTimeBridge — no native half in the binary', () => {
  it('is closed rather than throwing, the way Expo Go needs', () => {
    mockNativeMissing = true;
    // The registry caches a module once it has resolved, so the factory only
    // throws again for a require that starts from nothing.
    jest.resetModules();
    const { screenTimeBridge: fresh } = require('../utils/screenTimeBridge');
    expect(fresh()).toBeNull();
  });

  it('reports unsupported rather than throwing out of a launch effect', () => {
    mockNativeMissing = true;
    jest.resetModules();
    const { isScreenTimeSupported: fresh } = require('../utils/screenTimeBridge');
    expect(fresh()).toBe(false);
  });
});
