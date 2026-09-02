import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { addDays } from 'date-fns/addDays';
import { dayKeyOf, getCurrentDayStart, getLogicalDayKey } from '../utils/dateUtils';
import type { HealthDayInput } from '../utils/moodInsights';
import { healthBridge } from '../utils/healthBridge';
import { useSettingsStore } from './useSettingsStore';

/**
 * What Apple Health says about today, held in memory.
 *
 * The `useWeatherStore` / `useCalendarStore` shape, and for the identical
 * reason: it is another app's answer about something outside this one, not this
 * app's own data, so there is **no table, no migration and no sync**. That last
 * one is worth stating rather than leaving to be inferred — Health already
 * syncs across a person's own devices through iCloud, so there is nothing for a
 * second device to disagree about and nothing a merge would resolve, which is
 * exactly the argument `SYNC_EXCLUDED_TABLES` makes for the barcode cache. A
 * copy in this app's SQLite would be half a health record in a backup file, put
 * there to answer a question the phone can already answer.
 *
 * Readers only ever take whatever snapshot is here; this store owns getting it
 * there, and nothing else calls the bridge.
 *
 * ## Why this refreshes more often than the weather does
 *
 * `useWeatherStore.refresh()` returns early once the day already has a
 * snapshot, because a forecast is one answer for a day. A step count is a
 * running total that is wrong the moment after it is read, so this re-reads on
 * every foreground and keeps the day key only to know which day the number is
 * *about*. It is a local read with no network and no location, so re-reading
 * costs approximately nothing — which is also what will make it the first
 * reading in this app that a background refresh can legitimately take (see
 * `backgroundRefresh.ts`, which refuses a weather read because the location
 * permission sheet promises otherwise).
 */

/** One logical day's readings. A field is null when there is no number for it. */
export interface HealthDay {
  /** The logical day these numbers are about, under the user's own reset time. */
  dayKey: string;
  /**
   * Steps so far today, or null.
   *
   * **Null is not zero and must never be rendered as one.** It covers a read
   * that was refused, a day with no samples and a device that has never
   * recorded any, and HealthKit does not distinguish them — a refusal is
   * deliberately made to look like an empty store. Same rule `moodInsights`
   * already holds ("a day you didn't log is not a zero"), except that here the
   * API forces it rather than the design choosing it.
   */
  steps: number | null;
  /** When this was read, for a caller that wants to say how fresh it is. */
  readAt: string;
}

/**
 * How far back the history read goes.
 *
 * Long enough to clear `MIN_PAIRED_DAYS` for somebody who logs their mood a
 * couple of times a week, which is the point of reading it at all, and short
 * enough to stay one quick query. It is a window on somebody else's data rather
 * than a retention setting: nothing here is stored, so making it longer costs a
 * slower read and nothing else, and making it a preference would be a knob over
 * a number nobody has an opinion about.
 */
export const HEALTH_HISTORY_DAYS = 90;

interface HealthState {
  today: HealthDay | null;
  refreshing: boolean;
  /**
   * The last `HEALTH_HISTORY_DAYS` of readings, oldest first, or null for
   * "not looked yet" — which is a third answer and must not render as an empty
   * window. Only days HealthKit answered for are present.
   */
  history: HealthDayInput[] | null;
  loadingHistory: boolean;
  /** Re-read today's numbers. A no-op when the gate is closed or a read is already running. */
  refresh: () => Promise<void>;
  /** Re-read the trailing window. Only the screens that show a trend call this. */
  refreshHistory: () => Promise<void>;
  clear: () => void;
}

export const useHealthStore = create<HealthState>((set, get) => ({
  today: null,
  refreshing: false,
  history: null,
  loadingHistory: false,

  async refresh() {
    // One gate, which is also the demo-mode refusal — see healthBridge.ts.
    const bridge = healthBridge();
    if (!bridge) return;
    if (get().refreshing) return;

    // The window is the user's *logical* day, computed here rather than
    // natively: at 1am with a 02:00 reset the day that is running is still
    // yesterday's, and a native `startOfDay` would file the reading against a
    // day the user hasn't reached yet. Same reason the Screen Time extension is
    // handed a day key rather than working one out.
    const dayStart = getCurrentDayStart();
    const dayKey = dayKeyOf(dayStart);
    const now = new Date();

    set({ refreshing: true });
    try {
      const steps = await bridge.readSteps(dayStart.toISOString(), now.toISOString());
      // Written even when `steps` is null. A null answer is the current truth
      // rather than a failed read to paper over, and holding the last good
      // number instead would keep reporting a figure after access was revoked —
      // which is the one state this feature must not misreport.
      set({ today: { dayKey, steps, readAt: now.toISOString() } });
    } finally {
      set({ refreshing: false });
    }
  },

  /**
   * Read the trailing window, on demand.
   *
   * Deliberately not part of `refresh` and not on the foreground triggers: it
   * is a wider read that only the Mood screen's insights want, and running it
   * on every foreground would be paying for a chart nobody has open. Same split
   * `useMealPlanStore` draws by letting the screen own which week is loaded.
   *
   * Nothing is persisted, here or anywhere: `docs/arch/health-data.md` explains
   * why this app never keeps a copy of somebody's health record, and a
   * historical query is cheap enough that the copy would buy only a backup file
   * with their sleep in it.
   */
  async refreshHistory() {
    const bridge = healthBridge();
    if (!bridge) return;
    if (get().loadingHistory) return;

    // The window ends with today and runs back HEALTH_HISTORY_DAYS - 1 days, so
    // today is the last bucket rather than a partial one hanging off the end.
    const anchor = addDays(getCurrentDayStart(), -(HEALTH_HISTORY_DAYS - 1));

    set({ loadingHistory: true });
    try {
      const readings = await bridge.readDailyHealth(anchor.toISOString(), HEALTH_HISTORY_DAYS);
      const history: HealthDayInput[] = [];
      for (const reading of readings) {
        const at = new Date(reading.start);
        if (Number.isNaN(at.getTime())) continue;
        history.push({
          // The day key is derived here rather than natively, so there is one
          // implementation of "which day is this" and it is the one holding
          // `dayResetTime`. The native side hands back the instant it bucketed
          // from and says nothing about which day that is.
          dayKey: getLogicalDayKey(at),
          steps: reading.steps,
          // Hours, because that is the unit the insight speaks in; minutes are
          // what HealthKit's samples measure. Kept unrounded — the screen
          // decides how many decimals a person should read, and rounding at
          // the source would quietly change a correlation.
          sleepHours: reading.sleepMinutes === null ? null : reading.sleepMinutes / 60,
        });
      }
      set({ history });
    } finally {
      set({ loadingHistory: false });
    }
  },

  clear() {
    set({ today: null, history: null });
  },
}));

/**
 * Keeps today's reading current. Call once from the root component — the same
 * three triggers `useWeatherSync` and `useScreenTimeSync` settled on, for the
 * same reason: there is no OS-side "your step count changed" notification to
 * subscribe to either.
 *
 * Nothing here asks for authorization. A sweep never raises a permission sheet;
 * a person does, from the row in Settings — the line `weatherLocation.ts` draws
 * for the location prompt, and the reason `refresh` simply finds no number when
 * access was never granted rather than trying to work out why.
 */
export function useHealthSync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const settings = useSettingsStore.getState();
    if (settings.initialized && settings.healthReadEnabled) {
      void useHealthStore.getState().refresh();
    }

    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (
        state.initialized !== prev.initialized ||
        state.healthReadEnabled !== prev.healthReadEnabled ||
        // The reading is anchored to the logical day, so moving the reset moves
        // which day "today" is — same reason useWeatherSync watches it.
        state.dayResetTime !== prev.dayResetTime
      ) {
        if (state.healthReadEnabled) void useHealthStore.getState().refresh();
        else useHealthStore.getState().clear();
      }
    });

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && useSettingsStore.getState().healthReadEnabled) {
        void useHealthStore.getState().refresh();
      }
    });

    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);
}
