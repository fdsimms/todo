import type { ForecastDay } from '../services/weatherLookup';

/**
 * What a trip's forecast is allowed to say.
 *
 * The pure half of the destination forecast: the network half
 * (`services/geocode.ts` and `fetchDestinationForecast`) only asks the
 * question, and every rule about what the answer may *claim* lives here, so it
 * is the tested half. Same split `weatherCondition.ts` makes beside
 * `weatherLookup.ts`, and for the same reason.
 *
 * **It is a sentence, and a sentence may only state.** `lookAhead`'s own rule,
 * one feature over. This never conditions a packing item, never ticks anything,
 * and never becomes a rule a task can match: a ten-day-out forecast is not
 * something to stake "pack a coat" on, and the reader drawing their own
 * conclusion from a plain range is both more useful and more honest than the
 * app drawing it for them.
 *
 * **It never says a trip will be fine.** A span the forecast does not reach
 * says nothing about those days rather than implying they are unremarkable,
 * the same silence `dayLoad` keeps about a day it knows nothing about. Being
 * wrong about rain costs a line; being wrong about "no rain expected" costs
 * the coat you left at home.
 */

/** Where "cold" and "hot" start. Restated from `weatherCondition.ts` rather than imported, matching that module's own note about why its constants are not shared: this one is about what to say, that one about what a rule matches, and they are free to drift apart. */
const COLD_THRESHOLD_F = 45;
const HOT_THRESHOLD_F = 85;

/** Codes that are worth naming in a sentence about what to pack. */
const RAINY_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
const SNOWY_CODES = new Set([71, 73, 75, 77, 85, 86]);

export interface TripForecast {
  lowF: number;
  highF: number;
  /** How many of the span's days the forecast actually reached. */
  dayCount: number;
  rainDays: number;
  snowDays: number;
}

/** Fahrenheit to Celsius, rounded, for a reader who has explicitly asked for metric. */
const toC = (f: number) => Math.round((f - 32) * (5 / 9));

/**
 * Reduce a span's daily rows to the one reading a line can state, or null when
 * there is nothing to say.
 */
export function summarizeTripForecast(days: readonly ForecastDay[]): TripForecast | null {
  if (days.length === 0) return null;
  let lowF = Infinity;
  let highF = -Infinity;
  let rainDays = 0;
  let snowDays = 0;
  for (const day of days) {
    lowF = Math.min(lowF, day.lowF);
    highF = Math.max(highF, day.highF);
    if (RAINY_CODES.has(day.weatherCode)) rainDays += 1;
    if (SNOWY_CODES.has(day.weatherCode)) snowDays += 1;
  }
  return { lowF, highF, dayCount: days.length, rainDays, snowDays };
}

/**
 * The line itself: "Lisbon, 48 to 66°F, rain on 2 of 7 days".
 *
 * Three things it will not do, each the reason a line like this usually goes
 * wrong:
 *
 * - **Claim the days it could not see.** The count is of days the forecast
 *   reached, never of the trip's own length, and a partial answer says so
 *   ("the next 5 days") rather than quietly describing a week from five days.
 * - **Say a trip is clear.** No rain in the rows means the clause is dropped,
 *   not replaced with a reassurance the forecast cannot support.
 * - **Round a range into a single number.** A trip is a span and its weather is
 *   a span; one "average" temperature is the one figure that would actually
 *   mislead somebody packing.
 */
export function describeTripForecast(
  forecast: TripForecast | null,
  placeName: string | null,
  metric = false,
): string | null {
  if (!forecast) return null;
  const unit = metric ? '°C' : '°F';
  const low = metric ? toC(forecast.lowF) : Math.round(forecast.lowF);
  const high = metric ? toC(forecast.highF) : Math.round(forecast.highF);

  const parts: string[] = [];
  if (placeName) parts.push(placeName);
  parts.push(`${low} to ${high}${unit}`);

  // Snow first when both: it is the more consequential of the two to pack for,
  // and a line naming both reads as a list rather than as a warning.
  if (forecast.snowDays > 0) parts.push(spellDays('snow', forecast.snowDays, forecast.dayCount));
  else if (forecast.rainDays > 0) parts.push(spellDays('rain', forecast.rainDays, forecast.dayCount));
  else if (high <= (metric ? toC(COLD_THRESHOLD_F) : COLD_THRESHOLD_F)) parts.push('cold throughout');
  else if (low >= (metric ? toC(HOT_THRESHOLD_F) : HOT_THRESHOLD_F)) parts.push('hot throughout');

  return parts.join(', ');
}

/** "rain on 2 of 7 days", or "rain every day" when it is all of them. */
function spellDays(kind: string, count: number, total: number): string {
  if (count >= total) return `${kind} every day`;
  return `${kind} on ${count} of ${total} day${total === 1 ? '' : 's'}`;
}

/**
 * The caveat that goes under the line when the forecast could not reach the
 * whole trip, or null when it did.
 *
 * Its own string rather than a clause inside the line, because it is about the
 * *answer* rather than about the weather: Open-Meteo forecasts about a
 * fortnight out, so a trip further away than that is answered in part and the
 * reader has to be told which part.
 */
export function describeForecastGap(
  forecast: TripForecast | null,
  spanDays: number | null,
): string | null {
  if (!forecast || spanDays === null) return null;
  if (forecast.dayCount >= spanDays) return null;
  return `Forecast reaches the first ${forecast.dayCount} of ${spanDays} days.`;
}
