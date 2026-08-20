import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { addDays } from 'date-fns/addDays';
import type { BusyEvent } from '../utils/calendarBusy';
import { fetchEvents, type CalendarReadStatus } from '../utils/calendarSync';
import { getDayStart } from '../utils/dateUtils';
import { useSettingsStore } from './useSettingsStore';

/**
 * A rolling window of the device calendar, held in memory.
 *
 * **Nothing here is persisted, and that's the design.** The calendar is not
 * this app's data — it's another app's, read on demand — so there is no table,
 * no migration and no reconcile. Caching it into SQLite would create a second
 * copy that goes stale silently and has to be invalidated by something, and
 * expo-calendar gives us no change notification to invalidate it with (there is
 * no `EKEventStoreChanged` bridge). A window in memory, refreshed on
 * foreground, has exactly one failure mode — being a few minutes old — and it
 * is the same one the Reminders import already lives with.
 */

/**
 * How far ahead to read.
 *
 * Two weeks, because that's the horizon of the questions being asked: what's
 * on today, and which of the next several days has room for a task that's being
 * pushed. Reading a year to answer those means paying for a year of events on
 * every foreground and holding them for a screen that shows one day.
 */
export const CALENDAR_WINDOW_DAYS = 14;

interface CalendarState {
  /** Every event in the window, unfiltered — `calendarBusy` owns what counts. */
  events: BusyEvent[];
  /**
   * How the last read went, per calendar (#1744) — keyed by calendar id, one
   * entry per calendar `fetchEvents` actually attempted. See
   * `CalendarReadStatus` for what each entry says; a calendar with no entry
   * here was never asked about this pass (not chosen, or gone from the
   * device — `loaded`/the missing-calendar check in Settings cover that).
   */
  perCalendar: Record<string, CalendarReadStatus>;
  /** Start of the window the events were read for; null before the first read. */
  windowStart: string | null;
  windowEnd: string | null;
  /**
   * Whether the last read succeeded. **Not the same as `events` being empty**:
   * an empty day and a calendar we couldn't open both look like `[]`, and only
   * one of them means the day is free. Anything that would tell the user
   * something about their day has to check this first.
   *
   * This is the *whole-read* outcome (permission gone, `getCalendarsAsync`
   * itself failing) — a read that reaches individual calendars but fails on
   * one of them still sets this true, since every other calendar's events are
   * genuinely current; `perCalendar` is where that partial failure shows up.
   */
  loaded: boolean;
  refresh: () => Promise<void>;
  /** Drops everything — used when the feature is switched off. */
  clear: () => void;
}

export const useCalendarStore = create<CalendarState>((set) => ({
  events: [],
  perCalendar: {},
  windowStart: null,
  windowEnd: null,
  loaded: false,

  async refresh() {
    const { calendarReadEnabled, calendarIds, dayResetTime } = useSettingsStore.getState();
    if (!calendarReadEnabled || calendarIds.length === 0 || Platform.OS !== 'ios') {
      set({ events: [], perCalendar: {}, windowStart: null, windowEnd: null, loaded: false });
      return;
    }
    // Anchored on the logical day rather than midnight, so a 2 AM day reset
    // reads "today" the way every other list in the app does.
    const start = getDayStart(new Date(), dayResetTime);
    const end = addDays(start, CALENDAR_WINDOW_DAYS);
    const result = await fetchEvents(calendarIds, start, end);
    if (result === null) {
      // A failed read leaves the previous window (and per-calendar status) in
      // place rather than blanking it: yesterday's answer is better than a
      // confident "nothing on", and `loaded` already says whether to trust it.
      set({ loaded: false });
      return;
    }
    set({
      events: result.events,
      perCalendar: result.perCalendar,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      loaded: true,
    });
  },

  clear() {
    set({ events: [], perCalendar: {}, windowStart: null, windowEnd: null, loaded: false });
  },
}));

/**
 * Keeps the window current. Call once from the root component.
 *
 * Three triggers, none of which is a poll — the same set `useRemindersImportSync`
 * settled on, and for the same reason: there is no OS-side change notification
 * to subscribe to.
 *
 * The window also goes stale by *sitting there* — it's anchored on the day it
 * was read, so an app left open overnight would answer questions about
 * yesterday. The foreground refresh covers that in practice (a phone that
 * hasn't been backgrounded since yesterday is not the case worth engineering
 * for), and `windowStart` is on the state for a reader that wants to check.
 */
export function useCalendarSync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    // Guarded on `initialized` because settings load in an effect of their own
    // and this one can win the race — the same guard the reminders drain has.
    if (useSettingsStore.getState().initialized) {
      if (useSettingsStore.getState().calendarReadEnabled) useCalendarStore.getState().refresh();
    }

    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (
        state.initialized !== prev.initialized ||
        state.calendarReadEnabled !== prev.calendarReadEnabled ||
        state.calendarIds !== prev.calendarIds ||
        // The window is anchored on the logical day, so moving the reset moves
        // which day "today" is.
        state.dayResetTime !== prev.dayResetTime
      ) {
        if (state.calendarReadEnabled) useCalendarStore.getState().refresh();
        else useCalendarStore.getState().clear();
      }
    });

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active' && useSettingsStore.getState().calendarReadEnabled) {
        useCalendarStore.getState().refresh();
      }
    });

    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, []);
}
