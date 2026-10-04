import type { Task, WeatherCondition } from '../types';
import type { ForecastDay } from '../services/weatherLookup';
import { addDays } from 'date-fns/addDays';
import { classifyWeather } from './weatherCondition';
import { dayKeyOf, dayKeyToDate } from './dateUtils';

/**
 * A one-off task that waits for a kind of day ("leave books on the curb on the
 * next sunny day"). Store-free, like `weatherTasks.ts` beside it: this is the
 * decision, and `applyWeatherWaits` in `useTaskStore.ts` is what writes it.
 *
 * **The task's own `deferUntil` is the hold, and this module only chooses the
 * date.** Hiding a task until a day is exactly what a defer already is, so
 * nothing in the visibility rules knows about weather. While `weatherWait` is
 * set the pass owns `deferUntil`, and it clears `weatherWait` once the matched
 * day arrives, so a forecast that turns on the day itself can't push a task
 * back off Today.
 */

/** How far ahead the forecast is read: Open-Meteo's own limit is about a fortnight. */
export const WEATHER_WAIT_HORIZON_DAYS = 14;

/**
 * Whether a forecast day is the condition. `highF` stands in for the day's
 * temperature, so "cold" means even the high is cold and "hot" means the high
 * is hot, which is what a person waiting on either is asking about.
 */
export function dayMatchesCondition(day: ForecastDay, condition: WeatherCondition): boolean {
  return classifyWeather(day.weatherCode, day.highF).includes(condition);
}

/** What a task waiting on weather should do on this pass. */
export type WeatherWaitDecision =
  /** Nothing to change. */
  | { kind: 'none' }
  /** The matched day is here: stop waiting and let it show. */
  | { kind: 'release' }
  /** Hold until this day, which is `dayKey` (`matched`) or the end of the forecast (not matched). */
  | { kind: 'defer'; dayKey: string; matched: boolean };

/**
 * Whether a task is one this feature may act on: a plain one-off. A repeating
 * task, a chain step or a member of a series has a schedule of its own, and a
 * second thing moving its date is the conflict the editor refuses to offer.
 */
export function canWaitForWeather(
  task: Pick<Task, 'recurrenceType' | 'chainEnabled' | 'seriesId' | 'parentId'>,
): boolean {
  return task.recurrenceType === 'none' && !task.chainEnabled && !task.seriesId && !task.parentId;
}

/**
 * Decides one task against a forecast.
 *
 * `todayKey` is the logical day (`getCurrentDayStart`), never the wall-clock
 * date. The search starts at the later of today and the task's own date, so a
 * task dated next week waits for a matching day on or after that.
 *
 * - A held task whose `deferUntil` has arrived is released: it was the pass's
 *   own defer, and the day it picked is here.
 * - Otherwise the first matching forecast day from the start day is the answer.
 *   The start day itself matching means no hold at all.
 * - With no match the task stays hidden until the day after the forecast ends,
 *   so it is looked at again on every refresh and never surfaces by accident.
 *   An empty forecast decides nothing, since a task held on no information
 *   would just vanish.
 */
export function decideWeatherWait(
  task: Pick<Task, 'weatherWait' | 'dueDate' | 'deferUntil' | 'completed' | 'archived'> &
    Parameters<typeof canWaitForWeather>[0],
  forecast: readonly ForecastDay[],
  todayKey: string,
): WeatherWaitDecision {
  if (!task.weatherWait || task.completed || task.archived) return { kind: 'none' };
  if (!canWaitForWeather(task)) return { kind: 'none' };

  if (task.deferUntil && dayKeyOf(new Date(task.deferUntil)) <= todayKey) return { kind: 'release' };

  if (forecast.length === 0) return { kind: 'none' };

  const dueKey = task.dueDate ? dayKeyOf(new Date(task.dueDate)) : null;
  const startKey = dueKey && dueKey > todayKey ? dueKey : todayKey;
  const match = forecast
    .filter(day => day.dayKey >= startKey)
    .find(day => dayMatchesCondition(day, task.weatherWait!));

  if (match) {
    return match.dayKey <= todayKey ? { kind: 'release' } : { kind: 'defer', dayKey: match.dayKey, matched: true };
  }
  const last = forecast.reduce((a, d) => (d.dayKey > a ? d.dayKey : a), forecast[0].dayKey);
  const after = dayKeyOf(addDays(dayKeyToDate(last), 1));
  return { kind: 'defer', dayKey: after, matched: false };
}

/** "Waiting for a sunny day", for the row chip. */
export function weatherWaitLabel(condition: WeatherCondition): string {
  return `Waiting for a ${condition} day`;
}

/**
 * The row chip's text, or null when the task isn't waiting.
 *
 * A hold that landed on the day after the forecast ends means nothing matched:
 * a real match is at most the horizon's last day, so a `deferUntil` that far
 * out is the "look again later" hold, and showing its date as though it were a
 * forecast would promise a day nobody has predicted.
 */
export function weatherWaitChipText(
  task: Pick<Task, 'weatherWait' | 'deferUntil' | 'completed'>,
  todayKey: string,
): string | null {
  if (!task.weatherWait || task.completed) return null;
  const label = weatherWaitLabel(task.weatherWait);
  if (!task.deferUntil) return label;
  const days = Math.round(
    (dayKeyToDate(dayKeyOf(new Date(task.deferUntil))).getTime() - dayKeyToDate(todayKey).getTime()) / 86_400_000,
  );
  return days >= WEATHER_WAIT_HORIZON_DAYS ? `${label} (none in the next ${WEATHER_WAIT_HORIZON_DAYS} days)` : label;
}
