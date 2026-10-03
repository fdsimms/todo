import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useCalendarStore } from '../store/useCalendarStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import {
  TRANSIT_SNAPSHOT_STALE_MS,
  transitReadWanted,
  useTransitStore,
} from '../store/useTransitStore';
import { travelEstimatesWanted, useTravelTimeStore } from '../store/useTravelTimeStore';

/** How often an open, foregrounded app asks the MTA again. Matches the stale threshold. */
const FOREGROUND_REFRESH_INTERVAL_MS = TRANSIT_SNAPSHOT_STALE_MS;

/**
 * Keeps the travel tasks current. Call once from the root component. It does
 * two jobs, and they share a file because both exist to keep the same row
 * true while somebody is getting ready to leave.
 *
 * **It keeps the MTA snapshot fresh.** The weather's three triggers (mount, a
 * relevant settings change, coming to the foreground), plus one the weather
 * deliberately goes without: an interval while the app is open and in front.
 * A forecast settled in the morning is still right in the afternoon; a delay
 * is not, and an app left open on the counter is exactly when the note
 * matters. The interval stops in the background, so nothing is read while the
 * app isn't on screen (see `backgroundRefresh.ts` for why nothing here runs
 * while it is closed).
 *
 * **It re-runs `checkTravelTasks` whenever something that check reads
 * changes**: the calendar window, the snapshot, or one of its settings. Every
 * other generator checks on the launch sequence and the Today foreground sweep
 * and reads whatever its data store holds at that moment, which races: the
 * sweep fires on the same AppState change that starts the calendar read, so it
 * usually runs before the window lands and the answer waits for the next
 * foreground. For a forecast that costs nothing. For a delay it is the whole
 * feature, since a note one foreground late can arrive after the time to go.
 *
 * **It keeps the trip estimates fresh too** (`useTravelTimeStore`), on the
 * same triggers plus a calendar change, since a new event is a new trip to
 * estimate. The store only asks for events with no estimate or a stale one,
 * so the extra triggers cost nothing once each trip is known.
 *
 * It lives here rather than in either store because it is the one place that
 * needs all of them, and `useTaskStore` already imports the calendar and
 * transit stores, so a subscription inside either reaching back into
 * `useTaskStore` would be an import cycle. Over-firing is cheap:
 * `checkTravelTasks` is idempotent, compares before every write, and returns
 * at once while the feature is off.
 */
export function useTravelTaskSync(): void {
  useEffect(() => {
    const check = () => useTaskStore.getState().checkTravelTasks();

    const refreshEstimates = () => {
      const s = useSettingsStore.getState();
      if (s.initialized && travelEstimatesWanted(s)) void useTravelTimeStore.getState().refresh();
    };

    const unsubscribeCalendar = useCalendarStore.subscribe((state, prev) => {
      if (state.events !== prev.events || state.loaded !== prev.loaded) {
        check();
        refreshEstimates();
      }
    });
    const unsubscribeEstimates = useTravelTimeStore.subscribe((state, prev) => {
      if (state.estimates !== prev.estimates) check();
    });
    const unsubscribeTransit = useTransitStore.subscribe((state, prev) => {
      if (state.snapshot !== prev.snapshot) check();
    });
    const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      if (
        state.travelTasks !== prev.travelTasks ||
        state.travelLeadMinutes !== prev.travelLeadMinutes ||
        state.travelLeadByCalendar !== prev.travelLeadByCalendar ||
        state.travelTaskCategory !== prev.travelTaskCategory ||
        state.transitAlerts !== prev.transitAlerts ||
        state.transitLines !== prev.transitLines ||
        state.travelEstimates !== prev.travelEstimates ||
        state.travelMode !== prev.travelMode ||
        state.travelOriginPlaceId !== prev.travelOriginPlaceId ||
        state.calendarReadEnabled !== prev.calendarReadEnabled
      ) {
        check();
      }
      if (
        state.initialized !== prev.initialized ||
        state.travelTasks !== prev.travelTasks ||
        state.travelEstimates !== prev.travelEstimates ||
        state.travelMode !== prev.travelMode ||
        state.travelOriginPlaceId !== prev.travelOriginPlaceId ||
        state.calendarReadEnabled !== prev.calendarReadEnabled
      ) {
        if (travelEstimatesWanted(state)) void useTravelTimeStore.getState().refresh();
        else useTravelTimeStore.getState().clear();
      }
      if (
        state.initialized !== prev.initialized ||
        state.travelTasks !== prev.travelTasks ||
        state.transitAlerts !== prev.transitAlerts ||
        state.transitLines !== prev.transitLines
      ) {
        if (transitReadWanted(state)) useTransitStore.getState().refresh();
        else useTransitStore.getState().clear();
      }
    });

    if (Platform.OS !== 'ios') {
      return () => {
        unsubscribeCalendar();
        unsubscribeTransit();
        unsubscribeEstimates();
        unsubscribeSettings();
      };
    }

    const refreshIfWanted = () => {
      const s = useSettingsStore.getState();
      if (s.initialized && transitReadWanted(s)) useTransitStore.getState().refresh();
      refreshEstimates();
    };
    refreshIfWanted();

    let interval: ReturnType<typeof setInterval> | null = null;
    const startInterval = () => {
      if (interval === null) interval = setInterval(refreshIfWanted, FOREGROUND_REFRESH_INTERVAL_MS);
    };
    const stopInterval = () => {
      if (interval !== null) clearInterval(interval);
      interval = null;
    };
    if (AppState.currentState === 'active') startInterval();

    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refreshIfWanted();
        startInterval();
      } else {
        stopInterval();
      }
    });

    return () => {
      unsubscribeCalendar();
      unsubscribeTransit();
      unsubscribeEstimates();
      unsubscribeSettings();
      subscription.remove();
      stopInterval();
    };
  }, []);
}
