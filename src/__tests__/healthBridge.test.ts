/**
 * The one gate on reading Apple Health.
 *
 * Worth testing directly rather than through its callers, exactly as
 * `screenTimeBridge.test.ts` and `widgetBridge.test.ts` argue: they are hooks
 * and store actions driving a native module, none of which is reachable from a
 * node test env. What is reachable, and what actually decides whether a real
 * person's health data is read at all, is these few lines.
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
  isHealthAvailable: jest.fn(() => true),
  healthRequestStatus: jest.fn(),
  requestHealthAuthorization: jest.fn(),
  readSteps: jest.fn(),
};
let mockNativeMissing = false;
jest.mock('todo-health-bridge', () => {
  // What Expo Go and Android actually do: expo-modules-core's
  // requireNativeModule throws at the top of the package.
  if (mockNativeMissing) throw new Error('Cannot find native module');
  return mockNativeBridge;
});

import { healthBridge, isHealthSupported } from '../utils/healthBridge';

beforeEach(() => {
  mockPlatformOS = 'ios';
  mockDemoMode = false;
  mockNativeMissing = false;
  mockNativeBridge.isHealthAvailable.mockReturnValue(true);
});

describe('healthBridge', () => {
  it('opens on iOS with the native module present', () => {
    expect(healthBridge()).toBe(mockNativeBridge);
  });

  it('is closed off iOS, where HealthKit does not exist', () => {
    mockPlatformOS = 'android';
    expect(healthBridge()).toBeNull();
  });

  it('is closed in demo mode, so a demo never reads a real body', () => {
    // Demo mode swaps the database for a throwaway one. A reading taken here
    // would be the real person's, shown beside seeded fiction, in a database
    // about to be discarded — and the permission sheet raised to get it would
    // be raised by a demo.
    mockDemoMode = true;
    expect(healthBridge()).toBeNull();
  });

  it('re-reads demo mode on every call rather than answering from launch', () => {
    expect(healthBridge()).not.toBeNull();
    mockDemoMode = true;
    expect(healthBridge()).toBeNull();
    mockDemoMode = false;
    expect(healthBridge()).not.toBeNull();
  });

  it('closes the authorization request in demo mode, not just the reads', () => {
    // The visible half: nothing in a demo may put a system permission sheet on
    // screen, whatever it would then do with the answer.
    mockDemoMode = true;
    expect(healthBridge()?.requestHealthAuthorization).toBeUndefined();
  });
});

describe('isHealthSupported', () => {
  it('is false when the gate is closed, without asking the native module', () => {
    mockDemoMode = true;
    expect(isHealthSupported()).toBe(false);
    expect(mockNativeBridge.isHealthAvailable).not.toHaveBeenCalled();
  });

  it('defers to the native answer when the gate is open', () => {
    // False is iPad and anything else without health data — a different state
    // from "you have not been asked yet", which is the one this must not be
    // conflated with.
    mockNativeBridge.isHealthAvailable.mockReturnValue(false);
    expect(isHealthSupported()).toBe(false);

    mockNativeBridge.isHealthAvailable.mockReturnValue(true);
    expect(isHealthSupported()).toBe(true);
  });
});

describe('healthBridge — no native half in the binary', () => {
  it('is closed rather than throwing, the way Expo Go needs', () => {
    mockNativeMissing = true;
    // The registry caches a module once it has resolved, so the factory only
    // throws again for a require that starts from nothing.
    jest.resetModules();
    const { healthBridge: fresh } = require('../utils/healthBridge');
    expect(fresh()).toBeNull();
  });

  it('reports unsupported rather than throwing out of a launch effect', () => {
    mockNativeMissing = true;
    jest.resetModules();
    const { isHealthSupported: fresh } = require('../utils/healthBridge');
    expect(fresh()).toBe(false);
  });
});
