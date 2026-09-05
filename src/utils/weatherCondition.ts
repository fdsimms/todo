import type { WeatherCondition } from '../types';

/**
 * Turning Open-Meteo's raw answer into the closed set of conditions a
 * `WeatherRule` can match against.
 *
 * Pure and store-free, exactly like `calendarBusy.ts` beside `calendarSync.ts`:
 * the network half (`src/services/weatherLookup.ts`) only asks the question and
 * hands back a code and a temperature, and the rules about what those mean live
 * here, so they're the tested half.
 */

/**
 * WMO weather interpretation codes, as Open-Meteo's `current.weather_code`
 * reports them (https://open-meteo.com/en/docs — "WMO Weather interpretation
 * codes"). Grouped rather than matched one at a time, since a rule only ever
 * asks "was it sunny/rainy/snowy", never "was it exactly drizzling".
 */
const SUNNY_CODES = new Set([0, 1]);
const RAINY_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const SNOWY_CODES = new Set([71, 73, 75, 77, 85, 86]);

/**
 * Where "cold" and "hot" start, in Fahrenheit. Round numbers rather than a
 * measured threshold — the same "reasonable default, not a measured one" the
 * barcode source ordering in `productLookup.ts` admits to being. A rule's own
 * `title` is what says what the threshold is for ("Put on sunscreen" wants a
 * lower bar than "Bring a heavy coat"), not a second number this module would
 * have to expose per rule.
 */
const COLD_THRESHOLD_F = 45;
const HOT_THRESHOLD_F = 85;

/**
 * Every condition today's weather qualifies as — a list, not one answer,
 * because a rule for `sunny` and a rule for `cold` can both be true of the
 * same clear, chilly day. `weatherCode` outside every known group (fog,
 * overcast, an interpretation code Open-Meteo adds later) contributes nothing
 * to the sky half; a temperature past either threshold still contributes its
 * own condition regardless of what the sky is doing.
 */
export function classifyWeather(weatherCode: number, tempF: number): WeatherCondition[] {
  const conditions: WeatherCondition[] = [];
  if (SUNNY_CODES.has(weatherCode)) conditions.push('sunny');
  if (RAINY_CODES.has(weatherCode)) conditions.push('rainy');
  if (SNOWY_CODES.has(weatherCode)) conditions.push('snowy');
  if (tempF <= COLD_THRESHOLD_F) conditions.push('cold');
  if (tempF >= HOT_THRESHOLD_F) conditions.push('hot');
  return conditions;
}

/**
 * The glyph a forecast row draws for `weatherCode`, for `weatherContextRows`
 * (`dayContextRows.ts`). Sky only, in the same priority `classifyWeather`
 * checks in — cold/hot have no icon of their own, since a forecast row is
 * already stating the temperature as a number and a second, wordless way of
 * saying "cold" would just be a thermometer next to one.
 */
export function weatherIconFor(weatherCode: number): 'sunny-outline' | 'rainy-outline' | 'snow-outline' | 'cloud-outline' {
  if (SNOWY_CODES.has(weatherCode)) return 'snow-outline';
  if (RAINY_CODES.has(weatherCode)) return 'rainy-outline';
  if (SUNNY_CODES.has(weatherCode)) return 'sunny-outline';
  return 'cloud-outline';
}

/** "sunny", "rainy", "snowy", or "cloudy" for anything outside those three groups. */
export function weatherConditionAdjective(weatherCode: number): string {
  if (SNOWY_CODES.has(weatherCode)) return 'snowy';
  if (RAINY_CODES.has(weatherCode)) return 'rainy';
  if (SUNNY_CODES.has(weatherCode)) return 'sunny';
  return 'cloudy';
}

/** "Snow", "Rain", "Sun", or "Clouds" — the noun form, for a future day's row title. */
export function weatherConditionNoun(weatherCode: number): string {
  if (SNOWY_CODES.has(weatherCode)) return 'Snow';
  if (RAINY_CODES.has(weatherCode)) return 'Rain';
  if (SUNNY_CODES.has(weatherCode)) return 'Sun';
  return 'Clouds';
}
