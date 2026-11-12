import type { ForecastDay } from '../services/weatherLookup';
import type { WeatherCondition } from '../types';

/**
 * What a trip's forecast is allowed to say.
 *
 * The pure half of the destination forecast: the network half
 * (`services/geocode.ts` and `fetchDestinationForecast`) only asks the
 * question, and every rule about what the answer may *claim* lives here, so it
 * is the tested half. Same split `weatherCondition.ts` makes beside
 * `weatherLookup.ts`, and for the same reason.
 *
 * **The forecast line is a sentence, and a sentence may only state.**
 * `lookAhead`'s own rule, one feature over. `describeTripForecast` never ticks
 * anything and never becomes a rule a task can match: a ten-day-out forecast is
 * not something to stake "pack a coat" on, and the reader drawing their own
 * conclusion from a plain range is both more useful and more honest than the
 * app drawing it for them.
 *
 * **The one exception is `weatherGearVerdict`, and it is built so the cost of
 * being wrong stays small.** A template item marked for a kind of weather (an
 * umbrella for rain, a warm coat for cold) starts ticked in the apply sheet when
 * the forecast has that weather, and also whenever the forecast cannot say (off,
 * no place, no dates, too far out, only part of the trip). It starts unticked
 * only when the forecast covers every day and none has that weather. It only
 * sets where the item *starts*, the row always says why, and the person can tick
 * it either way. It still never claims a trip is clear.
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
  /** Days whose high stays at or under the cold threshold. */
  coldDays: number;
  /** Days whose high reaches the hot threshold. */
  hotDays: number;
  /** Days with a clear or mainly clear sky. */
  sunnyDays: number;
}

const SUNNY_CODES = new Set([0, 1]);

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
  let coldDays = 0;
  let hotDays = 0;
  let sunnyDays = 0;
  for (const day of days) {
    lowF = Math.min(lowF, day.lowF);
    highF = Math.max(highF, day.highF);
    if (RAINY_CODES.has(day.weatherCode)) rainDays += 1;
    if (SNOWY_CODES.has(day.weatherCode)) snowDays += 1;
    if (day.highF <= COLD_THRESHOLD_F) coldDays += 1;
    if (day.highF >= HOT_THRESHOLD_F) hotDays += 1;
    if (SUNNY_CODES.has(day.weatherCode)) sunnyDays += 1;
  }
  return { lowF, highF, dayCount: days.length, rainDays, snowDays, coldDays, hotDays, sunnyDays };
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

/** What `weatherGearVerdict` is told about the forecast it was able (or unable) to get. */
export interface WeatherGearInputs {
  /** The Destination forecast setting. */
  enabled: boolean;
  /** A destination to ask about: the project's, or the run's `{destination}`. */
  hasPlace: boolean;
  /** At least a start date to ask for. */
  hasDates: boolean;
  /** A request is still in flight. */
  loading: boolean;
  forecast: TripForecast | null;
  /** Days the run covers with both ends counted, or null with no dates. */
  spanDays: number | null;
  /** Temperatures in Celsius, as the forecast line does. */
  metric?: boolean;
}

export interface WeatherGearVerdict {
  /** Whether the item starts ticked. */
  tick: boolean;
  /** Why, in a sentence the row shows under the item. */
  note: string;
}

/** How many of the forecast's days have this kind of weather. Rain counts snow too, so a snowy forecast is never read as dry. */
function matchingDays(condition: WeatherCondition, f: TripForecast): number {
  switch (condition) {
    case 'rainy': return f.rainDays + f.snowDays;
    case 'snowy': return f.snowDays;
    case 'cold': return f.coldDays;
    case 'hot': return f.hotDays;
    case 'sunny': return f.sunnyDays;
  }
}

/** The weather as a sentence's subject, and what "none of it" says. */
function describeCondition(condition: WeatherCondition, f: TripForecast, metric: boolean) {
  const temp = (fahrenheit: number) => `${metric ? toC(fahrenheit) : fahrenheit}${metric ? '°C' : '°F'}`;
  switch (condition) {
    case 'rainy': {
      const what = f.rainDays > 0 && f.snowDays > 0 ? 'rain or snow' : f.snowDays > 0 ? 'snow' : 'rain';
      return { subject: `${what} is`, none: 'no rain or snow is' };
    }
    case 'snowy': return { subject: 'snow is', none: 'no snow is' };
    case 'cold': return { subject: `highs of ${temp(COLD_THRESHOLD_F)} or below are`, none: `no highs of ${temp(COLD_THRESHOLD_F)} or below are` };
    case 'hot': return { subject: `highs of ${temp(HOT_THRESHOLD_F)} or above are`, none: `no highs of ${temp(HOT_THRESHOLD_F)} or above are` };
    case 'sunny': return { subject: 'sunny weather is', none: 'no sunny weather is' };
  }
}

/**
 * Whether an item marked for a kind of weather starts ticked, and the sentence
 * that says why. One function for both, so the tick and the line under it
 * cannot disagree.
 *
 * Ticked unless the forecast reached every day of the run and none has that
 * weather. Anything it could not check leaves the item ticked: forgetting a coat
 * costs more than carrying one. The wording follows `describeTripForecast`: it
 * counts the days the forecast reached and does not describe the ones it could
 * not see. Cold and hot go by each day's high, the same thresholds that line uses.
 */
export function weatherGearVerdict(condition: WeatherCondition, input: WeatherGearInputs): WeatherGearVerdict {
  if (input.loading) return { tick: true, note: 'Checking the forecast.' };

  const f = input.forecast;
  if (!f) {
    const inCase = `Ticked in case ${describeConditionBare(condition)}.`;
    if (!input.enabled) return { tick: true, note: `${inCase} Turn on Destination forecast in Settings to check.` };
    if (!input.hasPlace) return { tick: true, note: `${inCase} Add a destination to check the forecast.` };
    if (!input.hasDates) return { tick: true, note: `${inCase} Pick dates to check the forecast.` };
    return { tick: true, note: `${inCase} No forecast was found for these dates.` };
  }

  const metric = input.metric === true;
  const words = describeCondition(condition, f, metric);
  const reachedAll = input.spanDays !== null && f.dayCount >= input.spanDays;
  const matching = matchingDays(condition, f);
  if (matching > 0) {
    // The count is of days the forecast reached, so a partial answer says "the first N".
    const days = reachedAll || input.spanDays === null ? `${f.dayCount}` : `the first ${f.dayCount}`;
    const spoken = reachedAll && matching >= f.dayCount
      ? `${words.subject} forecast every day.`
      : `${words.subject} forecast on ${matching} of ${days} day${f.dayCount === 1 ? '' : 's'}.`;
    return { tick: true, note: `Ticked because ${spoken}` };
  }

  if (reachedAll) return { tick: false, note: `Not ticked because ${words.none} forecast for these dates.` };
  const of = input.spanDays === null ? '' : ` of ${input.spanDays}`;
  return { tick: true, note: `Ticked in case ${describeConditionBare(condition)}. The forecast covers only the first ${f.dayCount}${of} days.` };
}

/** "it rains", for a sentence that has no forecast to read the weather from. */
function describeConditionBare(condition: WeatherCondition): string {
  switch (condition) {
    case 'rainy': return 'it rains';
    case 'snowy': return 'it snows';
    case 'cold': return 'it is cold';
    case 'hot': return 'it is hot';
    case 'sunny': return 'it is sunny';
  }
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
