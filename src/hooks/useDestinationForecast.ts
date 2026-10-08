import { useEffect, useState } from 'react';
import { geocodePlace } from '../services/geocode';
import { fetchDestinationForecast } from '../services/weatherLookup';
import { useSettingsStore } from '../store/useSettingsStore';
import {
  describeForecastGap,
  describeTripForecast,
  summarizeTripForecast,
} from '../utils/tripForecast';

export interface DestinationForecastLines {
  /** "Lisbon, 48 to 66°F, rain on 2 of 7 days", or null when there is nothing to say. */
  line: string | null;
  /** The caveat for a forecast that stops short of the span, or null. */
  gap: string | null;
}

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
 */
export function useDestinationForecast(
  destination: string | null,
  startKey: string | null,
  endKey: string | null,
  spanDays: number | null,
): DestinationForecastLines {
  const [lines, setLines] = useState<DestinationForecastLines>({ line: null, gap: null });
  const enabled = useSettingsStore(s => s.destinationForecastEnabled);
  const unitSystem = useSettingsStore(s => s.unitSystem);

  useEffect(() => {
    setLines({ line: null, gap: null });
    const place = destination?.trim();
    if (!enabled || !place || !startKey || !endKey) return;
    let live = true;
    void (async () => {
      const found = await geocodePlace(place);
      if (!live || !found) return;
      const days = await fetchDestinationForecast(found, startKey, endKey);
      if (!live || !days) return;
      const summary = summarizeTripForecast(days);
      setLines({
        line: describeTripForecast(summary, found.name, unitSystem === 'metric'),
        gap: describeForecastGap(summary, spanDays),
      });
    })();
    return () => { live = false; };
  }, [enabled, destination, startKey, endKey, spanDays, unitSystem]);

  return lines;
}
