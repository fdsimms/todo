import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { addDays } from 'date-fns/addDays';
import { dbGetSetting, dbSetSetting } from '../db/database';
import type { BusyEvent } from '../utils/calendarBusy';
import { fetchEvents, type CalendarInfo, type CalendarReadStatus } from '../utils/calendarSync';
import { isDemoModeActive } from '../utils/demoState';
import {
  shouldReadPastCalendar,
  pastWindowStart,
  parseHandledHistoryEvents,
  pruneHandledHistoryEvents,
  serializeHandledHistoryEvents,
  type HandledHistoryEvents,
} from '../utils/calendarHistory';
import { dayKeyOf, getDayStart } from '../utils/dateUtils';
import { useSettingsStore } from './useSettingsStore';

/**
 * A rolling window of the device calendar, held in memory.
 *
 * **No event here is persisted, and that's the design.** The calendar is not
 * this app's data — it's another app's, read on demand — so there is no table,
 * no migration and no reconcile. Caching it into SQLite would create a second
 * copy that goes stale silently and has to be invalidated by something, and
 * expo-calendar gives us no change notification to invalidate it with (there is
 * no `EKEventStoreChanged` bridge). A window in memory, refreshed on
 * foreground, has exactly one failure mode — being a few minutes old — and it
 * is the same one the Reminders import already lives with.
 *
 * The one thing that *is* persisted is `handledHistory`, and it is the other
 * side of that line rather than an exception to it: which history offers the
 * user has answered is the user's own data, not the calendar's, and losing it
 * on relaunch would mean re-offering everything they already turned down.
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

/**
 * Where the record of answered history offers lives.
 *
 * The settings table rather than a column or a store slice, beside
 * `remindersImportHandled` and for the same reasons: no screen renders it, and
 * a Zustand slice for it would be state nothing subscribes to. Read through
 * once and written through on change, so a screen never goes back to SQLite per
 * row. `calendarHistory.ts` owns its shape and its pruning.
 */
const HANDLED_HISTORY_KEY = 'calendarHistoryHandled';

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
  /**
   * Title and color for every calendar the last read actually touched, keyed
   * by id — what an event row needs to name and color its source.
   * Same lifetime as `perCalendar`: filled by `refresh`, dropped by `clear`.
   */
  calendarsById: Record<string, CalendarInfo>;
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
  /**
   * The past window, and it is a **separate window on purpose** rather than a
   * widening of the one above. That one is refreshed on every foreground to
   * answer questions Today asks; nothing on Today asks about last month, so
   * paying for a quarter of events on every foreground would be a cost with no
   * reader. This one is fetched only when somebody opens a person's screen —
   * see `docs/arch/people.md`, where the whole feature is a pull surface.
   */
  pastEvents: BusyEvent[];
  /** Same distinction `loaded` draws: an empty quarter and a failed read differ. */
  pastLoaded: boolean;
  /** ISO of when the past window was last read; null before the first one. */
  pastReadAt: string | null;
  /**
   * Which history offers have been answered — accepted or dismissed, since both
   * mean "don't ask again". Hydrated from the settings table on first use.
   */
  handledHistory: HandledHistoryEvents;
  /** Whether the record has been read back off the settings table yet. */
  handledLoaded: boolean;
  refreshPast: () => Promise<void>;
  /** Records one answer, and persists the pruned record. */
  markHistoryHandled: (key: string, dayKey: string) => void;
  /** Drops everything — used when the feature is switched off. */
  clear: () => void;
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  events: [],
  perCalendar: {},
  calendarsById: {},
  windowStart: null,
  windowEnd: null,
  loaded: false,
  pastEvents: [],
  pastLoaded: false,
  pastReadAt: null,
  handledHistory: {},
  handledLoaded: false,

  async refresh() {
    const { calendarReadEnabled, calendarIds, vacationMode, vacationHiddenCalendarIds, dayResetTime } =
      useSettingsStore.getState();
    // While on vacation, a calendar picked here can still be left out of the
    // read — a work calendar you want gone for the trip without un-picking
    // it for good. Off vacation, every picked calendar reads exactly as
    // before; vacationHiddenCalendarIds is never consulted at all.
    const readIds = vacationMode
      ? calendarIds.filter(id => !vacationHiddenCalendarIds.includes(id))
      : calendarIds;
    if (!calendarReadEnabled || readIds.length === 0 || Platform.OS !== 'ios') {
      set({
        events: [], perCalendar: {}, calendarsById: {},
        windowStart: null, windowEnd: null, loaded: false,
      });
      return;
    }
    // Anchored on the logical day rather than midnight, so a 2 AM day reset
    // reads "today" the way every other list in the app does.
    const start = getDayStart(new Date(), dayResetTime);
    const end = addDays(start, CALENDAR_WINDOW_DAYS);
    const result = await fetchEvents(readIds, start, end);
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
      calendarsById: result.calendarsById,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      loaded: true,
    });
  },

  async refreshPast() {
    const { calendarReadEnabled, calendarPeopleHistory, calendarIds } = useSettingsStore.getState();
    // Demo mode is in the gate, not beside it — see `shouldReadPastCalendar`
    // for why this reader is gated where the other four aren't. `enterDemoMode`
    // deliberately doesn't re-initialize the settings store, so the real
    // calendar settings are still in memory inside a demo.
    if (!shouldReadPastCalendar({
      calendarReadEnabled,
      calendarPeopleHistory,
      calendarCount: calendarIds.length,
      demoActive: isDemoModeActive(),
      ios: Platform.OS === 'ios',
    })) {
      set({ pastEvents: [], pastLoaded: false, pastReadAt: null });
      return;
    }

    // Hydrated here rather than at store creation: the settings table is not
    // open until the app has initialized, and this is the first moment anything
    // wants the record. Pruned on the way in, so a record only ever shrinks
    // while the app sits idle.
    const now = new Date();
    hydrateHandled(set, get, dayKeyOf(pastWindowStart(now)));

    // Deliberately to `now` rather than to the end of the day: an event later
    // today has not happened, and history is only ever about what has.
    const result = await fetchEvents(calendarIds, pastWindowStart(now), now);
    if (result === null) {
      set({ pastLoaded: false });
      return;
    }
    set({ pastEvents: result.events, pastLoaded: true, pastReadAt: now.toISOString() });
  },

  markHistoryHandled(key, dayKey) {
    const floorDayKey = dayKeyOf(pastWindowStart(new Date()));
    // Guarded rather than assumed: a mark can only follow a successful
    // `refreshPast`, but hydrating an already-hydrated record costs nothing
    // and reading a stale empty one would drop every earlier answer.
    hydrateHandled(set, get, floorDayKey);
    const next = pruneHandledHistoryEvents(
      { ...get().handledHistory, [key]: dayKey },
      floorDayKey
    );
    set({ handledHistory: next });
    try {
      dbSetSetting(HANDLED_HISTORY_KEY, serializeHandledHistoryEvents(next));
    } catch {
      // The in-memory copy still holds, so this session behaves; only
      // durability is lost, and the cost of losing it is being asked once more.
    }
  },

  // `handledHistory` (and `handledLoaded` with it) is deliberately **not** cleared. Switching calendar
  // reading off and back on must not hand back every offer the user already
  // turned down; the answers are theirs, where the events are the calendar's.
  clear() {
    set({
      events: [], perCalendar: {}, calendarsById: {}, windowStart: null, windowEnd: null, loaded: false,
      pastEvents: [], pastLoaded: false, pastReadAt: null,
    });
  },
}));

/**
 * Reads the answered-offers record back off the settings table, once.
 *
 * A record we can't read is a record we don't have — the same call
 * `remindersImportSync` makes about its own, and for the same reason: the cost
 * is being asked once more about events already answered, where throwing would
 * mean a person's screen that renders nothing ever again.
 */
function hydrateHandled(
  set: (partial: Partial<CalendarState>) => void,
  get: () => CalendarState,
  floorDayKey: string
): void {
  if (get().handledLoaded) return;
  let raw: string | null = null;
  try {
    raw = dbGetSetting(HANDLED_HISTORY_KEY);
  } catch {
    raw = null;
  }
  set({
    handledHistory: pruneHandledHistoryEvents(parseHandledHistoryEvents(raw), floorDayKey),
    handledLoaded: true,
  });
}

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
