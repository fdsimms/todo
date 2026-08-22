import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import type { Shop } from '../types';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { isTripLive } from './activeTrip';

/**
 * Drives the "shopping trip" Live Activity (Lock Screen + Dynamic Island) —
 * see docs/native-targets.md and targets/todo-widget/TripLiveActivity.swift.
 * Companion to useTimerLiveActivitySync in liveActivity.ts: same idea, but
 * for a single trip rather than a set of concurrent timer runs — at most one
 * trip is ever active (src/utils/activeTrip.ts), so the native side
 * reconciles against zero-or-one activities instead of a keyed set.
 *
 * A trip is fully described by its store name and start time, both fixed the
 * moment it starts — same reasoning liveActivity.ts's header gives for a
 * timer run: SwiftUI's `Text(_:style:.timer)` ticks the elapsed time on its
 * own from there, so the only JS-side job is telling the native side whether
 * a trip is currently wanted. Starting a new trip while the native side still
 * has one live ends that one and starts fresh, rather than updating it in
 * place — there's never a live activity whose start time needs to change
 * under it.
 */

const SHOP_NAME_MAX = 60;

export interface TripRun {
  shopName: string;
  startedAtMs: number;
}

/**
 * Pure. The active trip's Live Activity payload, or null when there's
 * nothing to show — resolved the same way activeShop()/resolveActiveTrip is
 * (a stamp compared against the clock, no separate "is it dead" flag), so a
 * trip that's aged out ends its activity exactly as it disappears from the
 * kitchen screens' own trip banner.
 */
export function buildTripRun(
  tripShopId: string | null,
  tripStartedAt: string | null,
  shops: readonly Shop[],
  opts: { enabled: boolean },
): TripRun | null {
  if (!opts.enabled || !tripShopId || !tripStartedAt || !isTripLive(tripStartedAt, new Date())) return null;
  const shop = shops.find(s => s.id === tripShopId);
  if (!shop) return null;
  const shopName = shop.name.length > SHOP_NAME_MAX
    ? `${shop.name.slice(0, SHOP_NAME_MAX - 1)}…`
    : shop.name;
  return { shopName, startedAtMs: Date.parse(tripStartedAt) };
}

// Lazily required, same shape as syncNativeTimerActivities in liveActivity.ts,
// so importing this module never crashes in Expo Go or on Android, where the
// local `todo-widget-bridge` native module doesn't exist.
function syncNativeTripActivity(run: TripRun | null): void {
  if (Platform.OS !== 'ios') return;
  try {
    const { syncTripLiveActivity } = require('todo-widget-bridge') as {
      syncTripLiveActivity: (jsonString: string) => Promise<boolean>;
    };
    // Fire-and-forget: nothing here needs to block on the native reconcile
    // completing, and a failure must never surface anywhere in the app UI.
    syncTripLiveActivity(run ? JSON.stringify(run) : '').catch(() => {});
  } catch {
    // No dev client build with the native module present (e.g. Expo Go) — no-op.
  }
}

// Keeps the shopping-trip Live Activity in sync with tripShopId/tripStartedAt.
// Subscribed rather than threaded through startTrip/endTrip directly, same
// rationale useTimerLiveActivitySync gives for the task/recipe stores.
export function useTripLiveActivitySync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const sync = () => {
      const { tripShopId, tripStartedAt, shops } = useGroceryStore.getState();
      const enabled = useSettingsStore.getState().tripLiveActivity;
      syncNativeTripActivity(buildTripRun(tripShopId, tripStartedAt, shops, { enabled }));
    };

    sync();

    const unsubGrocery = useGroceryStore.subscribe((state, prevState) => {
      if (state.tripShopId !== prevState.tripShopId || state.tripStartedAt !== prevState.tripStartedAt) sync();
    });
    const unsubSettings = useSettingsStore.subscribe((state, prevState) => {
      if (state.tripLiveActivity !== prevState.tripLiveActivity) sync();
    });

    // A trip that aged out (TRIP_MAX_MS) while the app was backgrounded has
    // to be re-checked on its own — nothing about tripShopId/tripStartedAt
    // changes on a timer, so a resync only happens at a natural trigger
    // point. Same "no timer running to notice" reasoning checkTripExpiry
    // (useGroceryStore.ts) gives for resyncing only at natural trigger points.
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') sync();
    });

    return () => {
      unsubGrocery();
      unsubSettings();
      subscription.remove();
    };
  }, []);
}
