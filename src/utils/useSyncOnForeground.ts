import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useSyncStore } from '../store/useSyncStore';

/**
 * Runs a sync when the app comes to the front, and once at launch.
 *
 * Foreground is the only trigger, and that's a limitation worth stating rather
 * than working around. iOS doesn't let a backgrounded app poll on a timer, and
 * the iPhone build running in a window on the Mac is suspended the same way
 * when it isn't focused — so "sync on an interval" would quietly mean "sync
 * whenever iOS felt like it", which is worse than a rule you can predict.
 *
 * The honest consequence: changes arrive when you look at the app, not before.
 * A silent push could improve on that later (CloudKit subscriptions can wake
 * the app), but silent pushes are throttled at the system's discretion, so it
 * would be a "usually sooner", never a guarantee — and the UI should keep
 * saying "last synced", which is a fact, rather than "up to date", which
 * wouldn't be.
 *
 * `syncNow` is its own guard: it returns immediately if sync is off or a run
 * is already in flight, so a burst of state changes can't stack up runs.
 */
export function useSyncOnForeground(): void {
  const enabled = useSyncStore(s => s.enabled);
  const syncNow = useSyncStore(s => s.syncNow);

  useEffect(() => {
    if (!enabled) return;

    void syncNow();

    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') void syncNow();
    });
    return () => sub.remove();
  }, [enabled, syncNow]);
}
