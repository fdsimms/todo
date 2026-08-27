/**
 * The one gate on everything this app writes outside its own database — the
 * App Group the widget reads, the two queues written from other processes, and
 * the Live Activities on the lock screen. Worth testing directly rather than
 * through its six callers, none of which is reachable from a node test env:
 * they're all React hooks driving native modules.
 */
let mockPlatformOS = 'ios';
jest.mock('react-native', () => ({
  get Platform() {
    return { OS: mockPlatformOS };
  },
}));

let mockDemoMode = false;
jest.mock('../utils/demoState', () => ({ isDemoModeActive: () => mockDemoMode }));

// Named `mock…` so jest allows the factory to close over it, the same rule
// remindersImportSync.test.ts works around for its own expo-calendar mock.
const mockNativeBridge = {
  writeWidgetSnapshot: jest.fn(),
  drainPendingWidgetCompletions: jest.fn(),
  drainPendingAddTasks: jest.fn(),
  drainSharedLinks: jest.fn(),
  syncTimerLiveActivities: jest.fn(),
  syncTripLiveActivity: jest.fn(),
  syncFocusLiveActivity: jest.fn(),
};
let mockNativeMissing = false;
jest.mock('todo-widget-bridge', () => {
  // What Expo Go and Android actually do: expo-modules-core's
  // requireNativeModule throws at the top of the package.
  if (mockNativeMissing) throw new Error('Cannot find native module');
  return mockNativeBridge;
});

import { widgetBridge } from '../utils/widgetBridge';

beforeEach(() => {
  mockPlatformOS = 'ios';
  mockDemoMode = false;
  mockNativeMissing = false;
});

describe('widgetBridge', () => {
  it('hands back the native module when there is nothing in the way', () => {
    expect(widgetBridge()).toBe(mockNativeBridge);
  });

  // Demo mode swaps the whole database for a throwaway, so every store reloads
  // with seeded fiction and every subscription behind this bridge fires. Left
  // open it puts fake tasks on the real widget and a fake shop on the real lock
  // screen, and the two drains consume real queued work into a database that is
  // about to be discarded.
  it('is closed in demo mode', () => {
    mockDemoMode = true;
    expect(widgetBridge()).toBeNull();
  });

  // Asked at the call, not at import: demo mode is entered and left while the
  // app is running, so a module-scope answer would be the one from launch.
  it('reopens when demo mode ends, without a reload', () => {
    mockDemoMode = true;
    expect(widgetBridge()).toBeNull();
    mockDemoMode = false;
    expect(widgetBridge()).toBe(mockNativeBridge);
  });

  it('is closed off iOS, where none of this exists', () => {
    mockPlatformOS = 'android';
    expect(widgetBridge()).toBeNull();
  });

  it('covers every function its callers reach for', () => {
    // A caller that reads a name this interface doesn't carry would compile
    // against `undefined` and fail at the call, which is exactly the shape of
    // the six hand-rolled requires this replaced.
    const bridge = widgetBridge()!;
    for (const name of [
      'writeWidgetSnapshot',
      'drainPendingWidgetCompletions',
      'drainPendingAddTasks',
      'drainSharedLinks',
      'syncTimerLiveActivities',
      'syncTripLiveActivity',
      'syncFocusLiveActivity',
    ] as const) {
      expect(typeof bridge[name]).toBe('function');
    }
  });
});

describe('widgetBridge — no native half in the binary', () => {
  it('is closed rather than throwing, the way Expo Go needs', () => {
    mockNativeMissing = true;
    // The registry caches a module once it has resolved, so the factory only
    // throws again for a require that starts from nothing.
    jest.resetModules();
    const { widgetBridge: fresh } = require('../utils/widgetBridge');
    expect(fresh()).toBeNull();
  });
});
