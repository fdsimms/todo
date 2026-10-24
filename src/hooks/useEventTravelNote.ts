import { useCallback, useMemo } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTravelTimeStore } from '../store/useTravelTimeStore';
import type { BusyEvent } from '../utils/calendarBusy';
import { readSavedPlaces } from '../utils/savedPlaces';
import { describeTravelEstimate, estimateFor, travelModeFor, travelOriginForEvent, travelOriginKey, travelWalkUnderFor } from '../utils/travelTasks';

/**
 * "18 min drive" for an event with a location, read from the estimates the
 * Leave-by reminders already hold (nothing here asks Apple Maps for anything),
 * or null when the estimates switch is off or none is held. The same read the
 * events sheet shows under an event's location. The callback changes identity
 * only when something it reads does, so it is safe in a memo's dependencies.
 */
export function useEventTravelNote(): (event: BusyEvent) => string | null {
  const travelEstimates = useSettingsStore(s => s.travelEstimates);
  const travelMode = useSettingsStore(s => s.travelMode);
  const travelWalkUnder = useSettingsStore(s => s.travelWalkUnderMinutes);
  const travelEventPrefs = useSettingsStore(s => s.travelEventPrefs);
  const travelOriginPlaceId = useSettingsStore(s => s.travelOriginPlaceId);
  const estimates = useTravelTimeStore(s => s.estimates);
  const savedPlaces = useMemo(() => readSavedPlaces(), [travelOriginPlaceId, travelEventPrefs]);
  return useCallback((event: BusyEvent) => {
    if (!travelEstimates || !event.location) return null;
    const estimate = estimateFor(
      event,
      estimates,
      travelModeFor(event.id, travelEventPrefs, travelMode),
      travelOriginKey(travelOriginForEvent(event.id, travelEventPrefs, travelOriginPlaceId, savedPlaces)),
      travelWalkUnderFor(event.id, travelEventPrefs, travelMode, travelWalkUnder),
    );
    return estimate ? describeTravelEstimate(estimate.minutes, estimate.mode) : null;
  }, [travelEstimates, estimates, travelMode, travelWalkUnder, travelEventPrefs, travelOriginPlaceId, savedPlaces]);
}
