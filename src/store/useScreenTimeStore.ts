import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import type { ScreenTimeCrossing } from 'todo-screentime-bridge';
import { screenTimeBridge } from '../utils/screenTimeBridge';
import { armableRules } from '../utils/screenTimeRules';
import { getCurrentDayStart, dayKeyOf } from '../utils/dateUtils';
import { useSettingsStore } from './useSettingsStore';

/**
 * What iOS has reported about app usage, held in memory — the screen-time
 * generator's equivalent of `useWeatherStore`'s snapshot, and for the identical
 * reason: it is the OS's answer about something outside this app, not the
 * app's own data, so there is no table and no migration.
 * `checkScreenTimeTasks` (`useTaskStore.ts`) only ever reads whatever is here;
 * this store owns getting it there and owns arming the monitor that produces it.
 *
 * **Crossings are drained destructively from the native side**, so one held
 * here and never turned into a task is lost if the app is killed first. That
 * is the same exposure `useWeatherStore` has with a snapshot it hasn't acted
 * on yet, and the same shrug applies: a rule that fires daily loses one day,
 * and the alternative is an acknowledgement protocol across a process boundary
 * for a reminder to go for a walk.
 */

interface ScreenTimeState {
  /** Thresholds reported crossed and not yet turned into tasks. */
  crossings: ScreenTimeCrossing[];
  refreshing: boolean;
  /** Drain whatever the monitor extension has recorded. */
  refresh: () => Promise<void>;
  /** Arm (or disarm) the OS monitor against the current rules. */
  armMonitor: () => Promise<void>;
  /** Drop crossings that have been acted on. */
  consume: (ruleIds: readonly string[]) => void;
  clear: () => void;
}

export const useScreenTimeStore = create<ScreenTimeState>((set, get) => ({
  crossings: [],
  refreshing: false,

  async refresh() {
    const bridge = screenTimeBridge();
    if (!bridge) return;
    if (get().refreshing) return;
    set({ refreshing: true });
    try {
      const drained = await bridge.drainCrossings();
      if (drained.length === 0) return;
      // Appended rather than replacing: a drain that happens between one sweep
      // and the next must not discard what the previous drain is still holding.
      set({ crossings: [...get().crossings, ...drained] });
    } finally {
      set({ refreshing: false });
    }
  },

  async armMonitor() {
    const bridge = screenTimeBridge();
    if (!bridge) return;
    const settings = useSettingsStore.getState();
    const rules = armableRules(settings.screenTimeRules);
    if (!settings.screenTimeTasks || rules.length === 0) {
      bridge.stopMonitoring();
      return;
    }
    // The day key is stamped here rather than in the extension, which has no
    // way to read the user's dayResetTime — a crossing filed under the wrong
    // day is a task on the wrong day.
    await bridge.startMonitoring(rules, dayKeyOf(getCurrentDayStart()));
  },

  consume(ruleIds) {
    const spent = new Set(ruleIds);
    set({ crossings: get().crossings.filter(c => !spent.has(c.ruleId)) });
  },

  clear() {
    set({ crossings: [] });
  },
}));

/**
 * Keeps the monitor armed and the crossings current, on the same three
 * triggers `useWeatherSync` uses.
 *
 * Re-arming on every foreground is deliberate and cheap: `startMonitoring`
 * replaces the schedule rather than stacking one, and the day key it carries
 * goes stale every midnight, so a phone left open across a day boundary would
 * otherwise file tomorrow's crossings under yesterday.
 */
export function useScreenTimeSync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const sync = () => {
      const settings = useSettingsStore.getState();
      if (!settings.initialized) return;
      void useScreenTimeStore.getState().armMonitor();
      if (settings.screenTimeTasks) void useScreenTimeStore.getState().refresh();
    };

    sync();

    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (
        state.initialized !== prev.initialized ||
        state.screenTimeTasks !== prev.screenTimeTasks ||
        state.screenTimeRules !== prev.screenTimeRules ||
        // Moving the reset moves which day "today" is, and the day key is
        // baked into the armed monitor — same reason useWeatherSync watches it.
        state.dayResetTime !== prev.dayResetTime
      ) {
        if (!state.screenTimeTasks) useScreenTimeStore.getState().clear();
        sync();
      }
    });

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') sync();
    });

    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);
}
