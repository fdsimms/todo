import { addDays } from 'date-fns/addDays';
import { useSettingsStore } from '../store/useSettingsStore';
import { useCalendarStore } from '../store/useCalendarStore';
import { useEventPeopleStore } from '../store/useEventPeopleStore';
import { useHealthStore } from '../store/useHealthStore';
import { useWeatherStore } from '../store/useWeatherStore';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { dayKeyOf, getDayStart } from './dateUtils';
import { moodDayOffers as offersFor, rainForDay } from './moodDayContext';
import { trainingDays } from './workoutRecords';

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
  const {
    moodContextSources, moodEventTags, holidaySet, customHolidays, dayResetTime, shortNightMinutes,
  } = useSettingsStore.getState();
  if (!Object.values(moodContextSources).some(Boolean) && !moodEventTags.some(r => r.enabled)) return [];
  const dayStart = getDayStart(day, dayResetTime);
  const dayKey = dayKeyOf(dayStart);
  const calendar = useCalendarStore.getState();
  const health = useHealthStore.getState();
  const weather = useWeatherStore.getState();
  // Today's reading first; the Sleep screen's history answers a backdated
  // entry when it has been loaded, and nothing does otherwise.
  const sleepMinutes = health.today?.dayKey === dayKey && health.today.sleepHours !== null
    ? health.today.sleepHours * 60
    : health.sleepNights?.find(n => n.dayKey === dayKey)?.minutes ?? null;
  const now = new Date();
  return offersFor(moodContextSources, {
    dayKey,
    now,
    dayStart,
    dayEnd: getDayStart(addDays(dayStart, 1), dayResetTime),
    isToday,
    holidays: { set: holidaySet, custom: customHolidays },
    events: calendar.loaded ? calendar.events : null,
    eventPeople: useEventPeopleStore.getState().links,
    exerciseMinutesToday: health.today?.dayKey === dayKey ? health.today.exerciseMinutes : null,
    daylightMinutesToday: health.today?.dayKey === dayKey ? health.today.daylightMinutes : null,
    eventTags: moodEventTags,
    trainingDays: moodContextSources.workout
      ? trainingDays(useWorkoutStore.getState().sessions, dayResetTime)
      : new Set(),
    sleepMinutes,
    shortNightMinutes,
    rain: rainForDay(dayKey, weather.snapshot, weather.snapshotDayKey, now.getHours()),
  });
}
