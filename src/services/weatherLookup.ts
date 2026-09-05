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
  /**
   * Today's own high/low, and tomorrow's forecast — null when the daily
   * fields didn't parse, which the current-only fields above never depended
   * on and still don't: a rule matches on `weatherCode`/`tempF` alone, so a
   * forecast that failed to parse costs the Today row `weatherContextRows`
   * draws and nothing else.
   */
  todayHighF: number | null;
  todayLowF: number | null;
  tomorrow: { weatherCode: number; highF: number; lowF: number } | null;
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
      '&current=temperature_2m,weather_code' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
      '&forecast_days=2&temperature_unit=fahrenheit&timezone=auto';
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json();
    const weatherCode = body?.current?.weather_code;
    const tempF = body?.current?.temperature_2m;
    if (typeof weatherCode !== 'number' || typeof tempF !== 'number') return null;

    // The forecast is a bonus on top of the reading above — a rule only ever
    // matches on that, so a daily block that's missing or short (Open-Meteo
    // declining `forecast_days`, an older cached response) degrades to no
    // forecast rather than no snapshot.
    const daily = body?.daily;
    const dailyCodes = daily?.weather_code;
    const dailyHighs = daily?.temperature_2m_max;
    const dailyLows = daily?.temperature_2m_min;
    const hasDailyDay = (i: number) =>
      typeof dailyCodes?.[i] === 'number' && typeof dailyHighs?.[i] === 'number' && typeof dailyLows?.[i] === 'number';

    const todayHighF = hasDailyDay(0) ? dailyHighs[0] : null;
    const todayLowF = hasDailyDay(0) ? dailyLows[0] : null;
    const tomorrow = hasDailyDay(1)
      ? { weatherCode: dailyCodes[1], highF: dailyHighs[1], lowF: dailyLows[1] }
      : null;

    return { weatherCode, tempF, fetchedAt: new Date().toISOString(), todayHighF, todayLowF, tomorrow };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
