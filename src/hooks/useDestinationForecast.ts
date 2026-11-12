import { useEffect, useRef, useState } from 'react';
import { geocodePlace, type GeocodedPlace } from '../services/geocode';
import { fetchDestinationForecast } from '../services/weatherLookup';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  describeForecastGap,
  describeTripForecast,
  summarizeTripForecast,
  type TripForecast,
} from '../utils/tripForecast';

export interface DestinationForecastLines {
  /** "Lisbon, 48 to 66°F, rain on 2 of 7 days", or null when there is nothing to say. */
  line: string | null;
  /** The caveat for a forecast that stops short of the span, or null. */
  gap: string | null;
  /** The reading behind the line, for a caller that decides something from it (`weatherGearVerdict`). Null whenever `line` is. */
  summary: TripForecast | null;
  /** A request is in flight. False once it has answered, or when nothing is being asked. */
  loading: boolean;
}

const NO_FORECAST: DestinationForecastLines = { line: null, gap: null, summary: null, loading: false };

/**
 * The destination forecast sentence for a span of days, fetched on mount and
 * never stored.
 *
 * A read with no store, the shape `useWeatherStore`'s own daily snapshot takes:
 * a forecast written anywhere durable would go stale and then be believed, so
 * it lives in component state for exactly as long as its caller does. Used by
 * the project page and by a template's apply sheet, which is why it is a hook
 * rather than an effect in one of them.
 *
 * Every refusal upstream (the switch off, demo mode, no network, a place no
 * gazetteer knows, a trip further out than the forecast reaches) comes back as
 * null lines. There is no error state, deliberately: a line that could not be
 * fetched has nothing to say, and saying so would be a second row about the app
 * rather than about the trip. What the line may claim is `tripForecast.ts`.
 *
 * `startKey`/`endKey` are local `YYYY-MM-DD` day keys, the last day inclusive.
 * `spanDays` is only what the gap caveat compares the forecast's reach against.
 * `onPlace` hears the geocoded place along with the destination text it was
 * asked for, so a caller can keep the coordinates (the project page pins them
 * for sunrise and sunset; see `destinationPinUpdate`). Read through a ref, so a
 * fresh callback doesn't refetch.
 */
export function useDestinationForecast(
  destination: string | null,
  startKey: string | null,
  endKey: string | null,
  spanDays: number | null,
  onPlace?: (place: GeocodedPlace, askedFor: string) => void,
): DestinationForecastLines {
  const onPlaceRef = useRef(onPlace);
  onPlaceRef.current = onPlace;
  const [lines, setLines] = useState<DestinationForecastLines>(NO_FORECAST);
  const enabled = useSettingsStore(s => s.destinationForecastEnabled);
  const unitSystem = useSettingsStore(s => s.unitSystem);

  useEffect(() => {
    const place = destination?.trim();
    if (!enabled || !place || !startKey || !endKey) {
      setLines(NO_FORECAST);
      return;
    }
    setLines({ ...NO_FORECAST, loading: true });
    let live = true;
    void (async () => {
      // Every way out of a request that is still wanted ends the loading state,
      // so a caller waiting on it never waits on an answer that is not coming.
      const settle = (next: DestinationForecastLines) => { if (live) setLines(next); };
      try {
        const found = await geocodePlace(place);
        if (!live || !found) return settle(NO_FORECAST);
        if (destination) onPlaceRef.current?.(found, destination);
        const days = await fetchDestinationForecast(found, startKey, endKey);
        if (!live || !days) return settle(NO_FORECAST);
        const summary = summarizeTripForecast(days);
        settle({
          line: describeTripForecast(summary, found.name, unitSystem === 'metric'),
          gap: describeForecastGap(summary, spanDays),
          summary,
          loading: false,
        });
      } catch {
        settle(NO_FORECAST);
      }
    })();
    return () => { live = false; };
  }, [enabled, destination, startKey, endKey, spanDays, unitSystem]);

  return lines;
}
