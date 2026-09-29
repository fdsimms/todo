// react-native and the grocery/settings stores aren't loadable under the node
// test env, and this suite only exercises the pure request-building logic
// (buildTripRun takes tripShopId/tripStartedAt/shops/enabled as explicit
// params), so stub them out — mirrors liveActivity.test.ts's own react-native
// and store mocks.
jest.mock('react-native', () => ({
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })) },
  Platform: { OS: 'ios' },
}));
jest.mock('../store/useGroceryStore', () => ({ useGroceryStore: { subscribe: jest.fn(), getState: jest.fn() } }));
jest.mock('../store/useSettingsStore', () => ({ useSettingsStore: { subscribe: jest.fn(), getState: jest.fn() } }));

import { buildTripRun } from '../utils/tripLiveActivity';
import { isTripLive, TRIP_MAX_MS } from '../utils/activeTrip';
import type { Shop } from '../types';

const NOW = new Date(2026, 7, 11, 12, 0, 0).getTime();
const startedAgo = (secondsAgo: number) => new Date(NOW - secondsAgo * 1000).toISOString();

function makeShop(overrides: Partial<Shop> = {}): Shop {
  return {
    id: 'shop-1',
    name: 'Trader Joe\'s',
    nameKey: 'trader joes',
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    excludeFromSuggestions: false,
    receiptStyle: 'itemized' as const,
    aisles: null,
    aisleOrder: null,
    ...overrides,
  };
}

describe('buildTripRun', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns nothing when disabled, even with a trip in flight', () => {
    const shops = [makeShop()];
    expect(buildTripRun('shop-1', startedAgo(10), shops, { enabled: false })).toBeNull();
  });

  it('returns nothing when no trip is running', () => {
    expect(buildTripRun(null, null, [makeShop()], { enabled: true })).toBeNull();
  });

  it('returns nothing when the trip has aged out (TRIP_MAX_MS)', () => {
    const shops = [makeShop()];
    expect(buildTripRun('shop-1', startedAgo(7 * 60 * 60), shops, { enabled: true })).toBeNull();
  });

  it('returns nothing when the shop no longer exists', () => {
    expect(buildTripRun('gone', startedAgo(5), [makeShop()], { enabled: true })).toBeNull();
  });

  it('builds a run for a live trip', () => {
    const shops = [makeShop({ id: 'shop-1', name: 'Costco' })];
    const run = buildTripRun('shop-1', startedAgo(30), shops, { enabled: true });
    expect(run).toEqual({ shopName: 'Costco', startedAtMs: NOW - 30_000, staleAtMs: NOW - 30_000 + TRIP_MAX_MS });
  });

  it('goes stale on the Lock Screen when the app stops counting the trip as live', () => {
    // #2937: nothing ends the activity while the app is closed, so the stale
    // date is what stops it claiming a trip the app has already let go of.
    const shops = [makeShop({ id: 'shop-1' })];
    const run = buildTripRun('shop-1', startedAgo(60), shops, { enabled: true })!;
    expect(run.staleAtMs - run.startedAtMs).toBe(TRIP_MAX_MS);
    expect(isTripLive(new Date(run.staleAtMs - 1).toISOString(), new Date(run.staleAtMs - 2))).toBe(true);
    expect(isTripLive(new Date(run.startedAtMs).toISOString(), new Date(run.staleAtMs))).toBe(false);
  });

  it('truncates a long store name', () => {
    const shops = [makeShop({ name: 'x'.repeat(80) })];
    const run = buildTripRun('shop-1', startedAgo(1), shops, { enabled: true });
    expect(run!.shopName.length).toBe(60);
    expect(run!.shopName.endsWith('…')).toBe(true);
  });
});
