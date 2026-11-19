import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { addDays } from 'date-fns/addDays';
import { fetchEvents } from '../utils/calendarSync';
import { createCoalescedTrigger, onEventStoreChanged } from '../utils/eventStoreChanges';
import { isDemoModeActive } from '../utils/demoState';
import { getDayStart } from '../utils/dateUtils';
import { createRefreshGuard } from '../utils/refreshGuard';
import { ON_CALL_WINDOW_DAYS, onCallConfigured, onCallSpans, type OnCallSpan } from '../utils/onCall';
import { CALENDAR_CHANGE_COALESCE_MS } from './useCalendarStore';
import { useSettingsStore } from './useSettingsStore';

/**
 * The user's on-call stretches for the next `ON_CALL_WINDOW_DAYS`, held in memory.
 *
 * Its own read rather than a use of `useCalendarStore.events`, for two reasons. That
 * window is a fortnight and a trip, or a task dated next month, is planned
 * further out, so a warning built on it would stay silent exactly when it matters
 * least to have forgotten. And the rules for what counts (`onCall.ts`) are not
 * the rules for what is busy, so there is nothing to share but the EventKit read,
 * which is `fetchEvents`.
 *
 * Like the calendar store nothing here is persisted: the calendar is the record,
 * and a copy would be one more thing to disagree with it. Only the spans are
 * kept, not the events, since nothing shows an on-call event's title.
 *
 * **Off, and empty, until something marks an event as on call**, and in demo mode,
 * which would otherwise read the real calendar into a seeded fiction (the gate
 * every device reader here carries).
 */
interface OnCallState {
  spans: OnCallSpan[];
  /** Whether a read has landed. A reader that must tell "nothing" from "not read yet" checks it. */
  loaded: boolean;
  refresh: () => Promise<void>;
  clear: () => void;
}

const guard = createRefreshGuard();

export const useOnCallStore = create<OnCallState>((set, get) => ({
  spans: [],
  loaded: false,

  async refresh() {
    const settings = useSettingsStore.getState();
    const config = { calendarIds: settings.onCallCalendarIds, words: settings.onCallWords };
    // The calendars the read covers, vacation's hidden ones left out: a work
    // calendar hidden for the trip hides its on-call shifts with it.
    const picked = settings.vacationMode
      ? settings.calendarIds.filter(id => !settings.vacationHiddenCalendarIds.includes(id))
      : settings.calendarIds;
    // With no word set, only the on-call calendars can hold an on-call event, so
    // only those are read; a word has to look through every calendar that is.
    const readIds = config.words.length > 0
      ? picked
      : picked.filter(id => config.calendarIds.includes(id));
    if (
      !settings.calendarReadEnabled || !onCallConfigured(config) || readIds.length === 0
      || Platform.OS !== 'ios' || isDemoModeActive()
    ) {
      guard.invalidate();
      if (get().loaded || get().spans.length > 0) set({ spans: [], loaded: false });
      return;
    }
    const start = getDayStart(new Date(), settings.dayResetTime);
    const token = guard.begin();
    const result = await fetchEvents(readIds, start, addDays(start, ON_CALL_WINDOW_DAYS));
    if (!guard.isCurrent(token)) return;
    // A failed read keeps what is held: a stale on-call strip beats none when
    // the whole point is not missing it.
    if (result === null) return;
    const spans = onCallSpans(result.events, config);
    const held = get();
    if (held.loaded && JSON.stringify(held.spans) === JSON.stringify(spans)) return;
    set({ spans, loaded: true });
  },

  clear() {
    guard.invalidate();
    set({ spans: [], loaded: false });
  },
}));

/**
 * Keeps `useOnCallStore` current: on launch, on coming back to the app, when the
 * Calendar database changes and when a setting it reads is changed. Call once from
 * the root component, beside `useCalendarSync`, which it follows.
 *
 * Lives in an app-level hook because a screen's effects stop while its tab is
 * frozen, and the strip and the warnings read this from several of them.
 */
export function useOnCallSync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const refresh = () => {
      void useOnCallStore.getState().refresh();
    };
    if (useSettingsStore.getState().initialized) refresh();

    const unsubscribe = useSettingsStore.subscribe((state, prev) => {
      if (
        state.initialized !== prev.initialized
        || state.calendarReadEnabled !== prev.calendarReadEnabled
        || state.calendarIds !== prev.calendarIds
        || state.onCallCalendarIds !== prev.onCallCalendarIds
        || state.onCallWords !== prev.onCallWords
        || state.vacationMode !== prev.vacationMode
        || state.vacationHiddenCalendarIds !== prev.vacationHiddenCalendarIds
        || state.dayResetTime !== prev.dayResetTime
      ) {
        refresh();
      }
    });
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    const changed = createCoalescedTrigger(() => {
      if (AppState.currentState === 'active') refresh();
    }, CALENDAR_CHANGE_COALESCE_MS);
    const stopListening = onEventStoreChanged(() => changed.fire());

    return () => {
      unsubscribe();
      subscription.remove();
      stopListening();
      changed.cancel();
    };
  }, []);
}
