import { useSettingsStore } from '../store/useSettingsStore';
import { useTravelTimeStore } from '../store/useTravelTimeStore';
import { TRAVEL_SKIP_KEY, type TravelEventPref, type TravelMode } from './travelTasks';

const NO_PREF: TravelEventPref = { mode: null, arriveEarlyMinutes: null, originPlaceId: null, skip: false };

/**
 * Writes one event's way of getting there from a "Leave for X" row: the same
 * preference the event card's "Getting there" chip writes, so the row can
 * change it without a trip through the Calendar screen. `key` is the picker's
 * (`'default'`, a mode, or `TRAVEL_SKIP_KEY`). The other fields of the
 * preference stay as they were, as they do on the card, and choosing a mode
 * again after skipping brings the task back.
 */
export function setTravelModeForEvent(eventId: string, sourceId: string | null, key: string): void {
  const settings = useSettingsStore.getState();
  const pref = settings.travelEventPrefs[eventId] ?? NO_PREF;
  const skip = key === TRAVEL_SKIP_KEY;
  const mode = skip ? pref.mode : key === 'default' ? null : (key as TravelMode);
  // The held estimate is re-filed first: the preference write wakes the sweep,
  // which would otherwise find none for the new mode and ask Apple Maps again.
  if (!skip && mode && sourceId) useTravelTimeStore.getState().switchMode(sourceId, mode);
  settings.setTravelEventPref(eventId, { ...pref, mode, skip });
}
