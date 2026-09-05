import { isDemoModeActive } from '../utils/demoState';
import { useSettingsStore } from '../store/useSettingsStore';
import type { DeviceLocation } from '../utils/weatherLocation';

/**
 * Today's weather at a location, over the network, once a day.
 *
 * **Open-Meteo, and no key.** The third network call in the app after the
 * user's own Anthropic key and `productLookup.ts`'s barcode sources — but
 * unlike either of those, this one needs no key at all: Open-Meteo's forecast
 * API is free and open, the same "no key, no traffic" shape Open Food Facts
 * plays in the barcode chain, made the *only* source rather than the keyless
 * fallback among paid ones. A weather feature that shipped needing an API key
 * pasted into Settings would be inert for everyone who never does that, the
 * same failure `aiSuggestions.ts` accepts on purpose for a feature that's
 * genuinely Anthropic-specific — nothing about checking the weather is.
 *
 * Everything decidable offline is decided elsewhere: this module only asks
 * the question and hands back a code and a temperature. `weatherCondition.ts`
 * turns that into the conditions a rule can match; this half can't be tested
 * and the other half must be — same split `productLookup.ts` and
 * `scanResolve.ts` make.
 */

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * Shorter than the Anthropic calls' 15s, matching `productLookup.ts`'s own
 * barcode timeout: this runs in the background, unattended, so a slow answer
 * just means no weather task today rather than someone standing around
 * waiting on it.
 */
const REQUEST_TIMEOUT_MS = 8_000;

/** Today's reading, reduced to what a rule can be matched against. */
export interface WeatherSnapshot {
  weatherCode: number;
  tempF: number;
  /** ISO, when this reading was taken. */
  fetchedAt: string;
}

/**
 * Today's weather at `location`, or null for every reason it might not be
 * available — demo mode, no network, a bad response, or a request that timed
 * out. `useWeatherStore.refresh()` treats all of them the same way: try again
 * on the next foreground.
 *
 * **Demo mode asks nothing.** The seed invents a snapshot directly (see
 * `demoSeed.ts`) rather than reading the real network, the same refusal
 * `mealCalendarSync.syncMealEvent` makes for the real calendar.
 */
export async function fetchWeatherSnapshot(location: DeviceLocation): Promise<WeatherSnapshot | null> {
  if (isDemoModeActive()) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${FORECAST_URL}?latitude=${location.latitude}&longitude=${location.longitude}` +
      '&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=auto';
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json();
    const weatherCode = body?.current?.weather_code;
    const tempF = body?.current?.temperature_2m;
    if (typeof weatherCode !== 'number' || typeof tempF !== 'number') return null;
    return { weatherCode, tempF, fetchedAt: new Date().toISOString() };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** One day of a forecast, reduced the way `WeatherSnapshot` reduces today. */
export interface ForecastDay {
  /** The day, as Open-Meteo's own `YYYY-MM-DD`. */
  dayKey: string;
  weatherCode: number;
  lowF: number;
  highF: number;
}

/**
 * The daily forecast for a place across a span of days, or null for every
 * reason there might not be one.
 *
 * Same endpoint and same terms as `fetchWeatherSnapshot` above — this asks for
 * `daily` where that asks for `current`, and takes coordinates from
 * `geocodePlace` rather than from the device. It answers the one thing packing
 * actually turns on: what the weather will be where you are going.
 *
 * **It carries the destination switch too**, not just the demo refusal. The
 * coordinates only ever reach here via `geocodePlace`, which already checks it,
 * but a second reader that skipped the check would be a second way to make the
 * call — and this is the half that would keep working if the geocode were ever
 * cached.
 *
 * **Open-Meteo only forecasts about a fortnight out**, so a trip further away
 * than that comes back with fewer days than were asked for, or none. That is
 * not an error and is not reported as one: the line simply says less. Nothing
 * here pads, extrapolates or explains the gap.
 */
export async function fetchDestinationForecast(
  location: { latitude: number; longitude: number },
  startDayKey: string,
  endDayKey: string,
): Promise<ForecastDay[] | null> {
  if (isDemoModeActive()) return null;
  if (!useSettingsStore.getState().destinationForecastEnabled) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${FORECAST_URL}?latitude=${location.latitude}&longitude=${location.longitude}` +
      '&daily=weather_code,temperature_2m_min,temperature_2m_max' +
      '&temperature_unit=fahrenheit&timezone=auto' +
      `&start_date=${startDayKey}&end_date=${endDayKey}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const daily = (await response.json())?.daily;
    const days: unknown[] = daily?.time ?? [];
    const codes: unknown[] = daily?.weather_code ?? [];
    const lows: unknown[] = daily?.temperature_2m_min ?? [];
    const highs: unknown[] = daily?.temperature_2m_max ?? [];
    const out: ForecastDay[] = [];
    for (let i = 0; i < days.length; i++) {
      const dayKey = days[i];
      const weatherCode = codes[i];
      const lowF = lows[i];
      const highF = highs[i];
      // A day missing any of the three is dropped rather than guessed at, the
      // same refusal the snapshot above makes on a malformed `current`.
      if (typeof dayKey !== 'string') continue;
      if (typeof weatherCode !== 'number' || typeof lowF !== 'number' || typeof highF !== 'number') continue;
      out.push({ dayKey, weatherCode, lowF, highF });
    }
    return out.length > 0 ? out : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
