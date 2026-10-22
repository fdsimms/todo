import type { BusyEvent } from './calendarBusy';
import type { EventPeopleIndex } from './eventPeople';
import { peopleForEvent } from './eventPeople';
import { holidayOn, type HolidayConfig } from './holidays';
import { EXERCISED_MINUTES, OUTSIDE_MINUTES, type MoodContextSources } from './moodContextSources';

/**
 * Context tags the mood sheet can offer from facts the app already holds about
 * a day, one switch per source (`moodContextSources.ts`). Pure: `moodDayOffers.ts`
 * reads the stores, and the sheet only ever *offers* the result (see
 * `seededContextTags` and docs/arch/mood-log.md).
 *
 * **Every source answers only with a positive.** A day with no holiday, no
 * linked event and no recorded exercise offers nothing, because
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

  if (sources.exercise && input.isToday
    && input.exerciseMinutesToday !== null && input.exerciseMinutesToday >= EXERCISED_MINUTES) {
    tags.push('Exercised');
  }

  if (sources.outside && input.isToday
    && input.daylightMinutesToday !== null && input.daylightMinutesToday >= OUTSIDE_MINUTES) {
    tags.push('Went outside');
  }

  return tags;
}
