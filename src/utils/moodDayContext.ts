import type { BusyEvent } from './calendarBusy';
import type { EventPeopleIndex } from './eventPeople';
import { peopleForEvent } from './eventPeople';
import { holidayOn, type HolidayConfig } from './holidays';
import { addDays } from 'date-fns/addDays';
import { parseISO } from 'date-fns/parseISO';
import type { WeatherSnapshot } from '../services/weatherLookup';
import { dayKeyOf } from './dateUtils';
import { ruleMatchesTitle } from './eventTasks';
import { classifyWeather } from './weatherCondition';
import {
  EXERCISED_MINUTES,
  OUTSIDE_MINUTES,
  RAIN_TAG_MM,
  type MoodContextSources,
  type MoodEventTag,
} from './moodContextSources';

/**
 * Context tags the mood sheet can offer from facts the app already holds about
 * a day, one switch per source (`moodContextSources.ts`). Pure: `moodDayOffers.ts`
 * reads the stores, and the sheet only ever *offers* the result (see
 * `seededContextTags` and docs/arch/mood-log.md).
 *
 * **Every source answers only with a positive.** A day with no holiday, no
 * linked event, no recorded exercise and no rain offers nothing, because
 * none of those is a claim about the day. A calendar that didn't load and a
 * day with no events look the same from here, so "no social event" is never an
 * answer, and neither is "didn't exercise" (a refused Health read and a day
 * with nothing recorded are one answer; see docs/arch/health-data.md).
 */

export interface MoodDayInputs {
  dayKey: string;
  /** The logical day's bounds: `[dayStart, dayEnd)`. */
  dayStart: Date;
  dayEnd: Date;
  isToday: boolean;
  holidays: HolidayConfig;
  /** Null when the calendar hasn't been read, which offers nothing. */
  events: readonly BusyEvent[] | null;
  eventPeople: EventPeopleIndex;
  /** Today's exercise so far, or null when Health has nothing. Read only for today. */
  exerciseMinutesToday: number | null;
  /** Today's Time in Daylight so far, or null. Read only for today. */
  daylightMinutesToday: number | null;
  /** The person's calendar keyword rules; only enabled ones are read. */
  eventTags: readonly MoodEventTag[];
  /** Logical days a workout was finished in the app (`trainingDays`). */
  trainingDays: ReadonlySet<string>;
  /** Sleep that ended on this day, in minutes, or null when Health has nothing. */
  sleepMinutes: number | null;
  /** The Short night threshold the person set under Sleep. */
  shortNightMinutes: number;
  /** This day's rain as the weather read has it (`rainForDay`), or null. */
  rain: DayRain | null;
}

/** Rain on one day, and whether any of it has actually been seen to fall. */
export interface DayRain {
  mm: number | null;
  /**
   * A past day's total is the model's record of it. Today's total is partly
   * forecast until the day is over, so it counts only once an hour already
   * gone today carried a rain code.
   */
  observed: boolean;
}

/**
 * `dayKey`'s rain from the weather read, which holds yesterday's record and
 * today's figure only. Null for any other day, and for no read at all, which
 * offers nothing: an unread day is not a dry one.
 */
export function rainForDay(
  dayKey: string,
  snapshot: Pick<WeatherSnapshot, 'yesterdayPrecipitationMm' | 'todayPrecipitationMm' | 'todayHours'> | null,
  snapshotDayKey: string | null,
  nowHour: number,
): DayRain | null {
  if (!snapshot || !snapshotDayKey) return null;
  if (dayKey === snapshotDayKey) {
    const observed = (snapshot.todayHours ?? []).some(h =>
      h.hour < nowHour && classifyWeather(h.weatherCode, h.tempF).includes('rainy'));
    return { mm: snapshot.todayPrecipitationMm, observed };
  }
  if (dayKey === dayKeyOf(addDays(parseISO(snapshotDayKey), -1))) {
    return { mm: snapshot.yesterdayPrecipitationMm, observed: true };
  }
  return null;
}

/** The tags the enabled sources offer for one day, in a stable order. */
export function moodDayOffers(sources: MoodContextSources, input: MoodDayInputs): string[] {
  const tags: string[] = [];

  if (sources.dayOff) {
    const holiday = holidayOn(input.dayKey, input.holidays);
    if (holiday) tags.push(holiday === 'Day off' ? 'Day off' : 'Holiday');
  }

  if (sources.social && input.events) {
    const social = input.events.some(e =>
      e.status !== 'canceled'
      && Date.parse(e.start) >= input.dayStart.getTime()
      && Date.parse(e.start) < input.dayEnd.getTime()
      && peopleForEvent(input.eventPeople, e).length > 0);
    if (social) tags.push('Social event');
  }

  // Two sources, one tag: a workout logged in the app and a Health reading say
  // the same thing, and two words for it would split one contrast in half.
  const exercised = sources.exercise && input.isToday
    && input.exerciseMinutesToday !== null && input.exerciseMinutesToday >= EXERCISED_MINUTES;
  if (exercised || (sources.workout && input.trainingDays.has(input.dayKey))) {
    tags.push('Worked out');
  }

  // Under the threshold the person set, never one the app picks. Zero is a
  // reading that failed rather than a night without sleep.
  if (sources.shortNight && input.sleepMinutes !== null && input.sleepMinutes > 0
    && input.sleepMinutes < input.shortNightMinutes) {
    tags.push('Short night');
  }

  if (sources.outside && input.isToday
    && input.daylightMinutesToday !== null && input.daylightMinutesToday >= OUTSIDE_MINUTES) {
    tags.push('Went outside');
  }

  if (sources.rain && input.rain && input.rain.observed
    && input.rain.mm !== null && input.rain.mm >= RAIN_TAG_MM) {
    tags.push('Rain');
  }

  // The person's own keywords last, in their order. A tag already offered
  // above, or by an earlier rule, isn't offered twice.
  if (input.events) {
    const onDay = input.events.filter(e =>
      e.status !== 'canceled'
      && Date.parse(e.start) >= input.dayStart.getTime()
      && Date.parse(e.start) < input.dayEnd.getTime());
    for (const rule of input.eventTags) {
      if (!rule.enabled || !rule.title.trim()) continue;
      const tag = rule.title.trim();
      if (tags.some(t => t.toLowerCase() === tag.toLowerCase())) continue;
      if (onDay.some(e => ruleMatchesTitle(rule, e.title))) tags.push(tag);
    }
  }

  return tags;
}
