import { useEffect } from 'react';
import { AppState } from 'react-native';
import { hasUnsentChanges, useSyncStore } from '../store/useSyncStore';

/**
 * How often the app syncs while it is on screen. Short, because the case it is
 * for is somebody watching the grocery list while Claude adds to it through the
 * MCP server, and cheap, because a run with nothing new is one small pull per
 * destination and reloads nothing (see `syncOnce`).
 */
export const FOREGROUND_SYNC_INTERVAL_MS = 15_000;

/**
 * How often the app checks for an edit of its own that hasn't been sent. The
 * check is one indexed query (`hasUnsentChanges`), and a sync starts only when
 * it finds something, so an edit reaches the other device within a couple of
 * seconds rather than waiting up to a full `FOREGROUND_SYNC_INTERVAL_MS`.
 */
export const LOCAL_CHANGE_PROBE_MS = 2_000;

/**
 * Runs a sync when the app comes to the front, once at launch, and every
 * `FOREGROUND_SYNC_INTERVAL_MS` while it stays there.
 *
 * The interval runs only while the app is active, and that's a limitation worth
 * stating rather than working around. iOS doesn't let a backgrounded app poll on
 * a timer, and the iPhone build running in a window on the Mac is suspended the
 * same way when it isn't focused, so "sync on an interval" in the background
 * would quietly mean "sync whenever iOS felt like it", which is worse than a
 * rule you can predict. In the foreground there is no such problem.
 *
 * The honest consequence: changes arrive when you look at the app, not before.
 * A silent push could improve on that later (CloudKit subscriptions can wake
 * the app), but silent pushes are throttled at the system's discretion, so it
 * would be a "usually sooner", never a guarantee — and the UI should keep
 * saying "last synced", which is a fact, rather than "up to date", which
 * wouldn't be.
 *
 * `syncNow` is its own guard: a call that lands mid-run never starts a second
 * run stacked on the first. It asks the running one to go round once more
 * when it finishes, since that run may have read its push window before the
 * edit that prompted the call.
 */
export function useSyncOnForeground(): void {
  // Either destination, not iCloud's switch alone: `enabled` is iCloud's, and
  // a device syncing only with a payload store was never synced on foreground,
  // so a task written by the MCP server waited for a manual Sync now. Same
  // test SyncSettings uses for whether there is anywhere to sync to.
  const enabled = useSyncStore(s => s.enabled || (!!s.serverUrl && s.hasServerToken));
  const syncNow = useSyncStore(s => s.syncNow);

  useEffect(() => {
    if (!enabled) return;

    void syncNow();

    let timer: ReturnType<typeof setInterval> | null = null;
    let probe: ReturnType<typeof setInterval> | null = null;
    const startTimer = () => {
      if (timer === null) timer = setInterval(() => void syncNow(), FOREGROUND_SYNC_INTERVAL_MS);
      // Not while the last sync is reporting a problem: its cursor hasn't
      // moved, so every probe would say yes and retry a failing sync every
      // couple of seconds. The slower timer above keeps retrying meanwhile.
      if (probe === null) {
        probe = setInterval(() => {
          if (useSyncStore.getState().problem !== null) return;
          if (hasUnsentChanges()) void syncNow();
        }, LOCAL_CHANGE_PROBE_MS);
      }
    };
    const stopTimer = () => {
      if (timer !== null) clearInterval(timer);
      if (probe !== null) clearInterval(probe);
      timer = null;
      probe = null;
    };
    if (AppState.currentState === 'active') startTimer();

    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') {
        void syncNow();
        startTimer();
      } else {
        stopTimer();
        // On the way out too, so an edit made just before the phone is locked
        // or the app switched away goes now rather than at the next launch:
        // iOS allows a few seconds after backgrounding, which a push fits in.
        if (next === 'background') void syncNow();
      }
    });
    return () => {
      sub.remove();
      stopTimer();
    };
  }, [enabled, syncNow]);
}
