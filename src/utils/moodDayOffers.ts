import { addDays } from 'date-fns/addDays';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCalendarStore } from '../store/useCalendarStore';
import { useEventPeopleStore } from '../store/useEventPeopleStore';
import { usePersonStore } from '../store/usePersonStore';
import { useHealthStore } from '../store/useHealthStore';
import { dayKeyOf, getDayStart } from './dateUtils';
import { moodDayOffers as offersFor } from './moodDayContext';

/**
 * The context tags the person's enabled day facts offer for `day`, read off the
 * stores as they stand. The thin store-reading half of `moodDayContext.ts`, kept
 * out of the sheet so opening it and moving its Day row ask the same question.
 *
 * Read with `getState()` rather than subscribed to: the sheet seeds once per
 * open and must not reseed under a half-filled form when a calendar refresh
 * lands.
 */
export function moodDayOffersFor(day: Date, isToday: boolean): string[] {
  const { moodContextSources, holidaySet, customHolidays, dayResetTime } = useSettingsStore.getState();
  if (!Object.values(moodContextSources).some(Boolean)) return [];
  const dayStart = getDayStart(day, dayResetTime);
  const dayKey = dayKeyOf(dayStart);
  const calendar = useCalendarStore.getState();
  const health = useHealthStore.getState();
  return offersFor(moodContextSources, {
    dayKey,
    dayStart,
    dayEnd: getDayStart(addDays(dayStart, 1), dayResetTime),
    isToday,
    holidays: { set: holidaySet, custom: customHolidays },
    events: calendar.loaded ? calendar.events : null,
    eventPeople: useEventPeopleStore.getState().links,
    people: usePersonStore.getState().people,
    exerciseMinutesToday: health.today?.dayKey === dayKey ? health.today.exerciseMinutes : null,
    daylightMinutesToday: health.today?.dayKey === dayKey ? health.today.daylightMinutes : null,
  });
}
