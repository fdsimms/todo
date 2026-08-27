import { isDemoModeActive } from '../utils/demoState';
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
