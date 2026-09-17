import type { Task, WeatherCondition, WeatherRule } from '../types';
import type { WeatherHour } from '../services/weatherLookup';
import { classifyWeather, conditionNoun } from './weatherCondition';
import { generatedSourceOf } from './generatedTasks';
import { generateId } from './id';

/**
 * Weather rules — "on a sunny day, add a task to put on sunscreen".
 *
 * The rules module for the `weather` generator (see `generatedTasks.ts` and
 * `docs/arch/generated-tasks.md`), store-free like `calendarReviewTasks.ts`
 * beside it: orchestration — reading settings, computing today's key, calling
 * `reconcileGeneratedTask` — lives in `useTaskStore.ts`'s `checkWeatherTasks`,
 * exactly as it does for `calendarReview`. What's here is the storage
 * round-trip for the rule list itself (the same job `titleRules.ts` does for
 * `TitleRule[]`) and the pure predicate deciding whether a rule fires.
 */

/** A rule can't be an empty task title — nothing to show on Today. */
export const WEATHER_RULE_TITLE_MAX_LENGTH = 80;

export const WEATHER_CONDITIONS: readonly WeatherCondition[] = ['sunny', 'rainy', 'snowy', 'cold', 'hot'];

export function weatherConditionLabel(condition: WeatherCondition): string {
  switch (condition) {
    case 'sunny': return 'Sunny';
    case 'rainy': return 'Rainy';
    case 'snowy': return 'Snowy';
    case 'cold': return 'Cold';
    case 'hot': return 'Hot';
  }
}

/**
 * The three rules the feature ships with, pre-filled rather than starting
 * from an empty list — the app already knows the obvious answers, and typing
 * "sunny -> Put on sunscreen" from scratch is the trip a shipped default
 * saves. Each still has its own `enabled`, and the generator's own settings
 * toggle (`weatherEnabled`) ships off — see `GENERATED_KIND_SPECS.weather` —
 * so nobody sees a task from these until they turn the feature on.
 */
export function defaultWeatherRules(): WeatherRule[] {
  return [
    { id: generateId(), condition: 'sunny', title: 'Put on sunscreen', enabled: true, lastFiredDayKey: null },
    { id: generateId(), condition: 'rainy', title: 'Bring an umbrella', enabled: true, lastFiredDayKey: null },
    { id: generateId(), condition: 'cold', title: 'Wear a coat', enabled: true, lastFiredDayKey: null },
  ];
}

/**
 * `weatherRules` off `dbGetSetting`, defensively — same shape as
 * `parseTitleRules`: a malformed or missing stored value reads as "nothing
 * saved yet" rather than throwing, and a bad entry is dropped rather than
 * discarding the whole list.
 */
export function parseWeatherRules(raw: string | null | undefined): WeatherRule[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  const out: WeatherRule[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const r = entry as Partial<WeatherRule>;
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, WEATHER_RULE_TITLE_MAX_LENGTH) : '';
    if (!title) continue;
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : generateId(),
      condition: WEATHER_CONDITIONS.includes(r.condition as WeatherCondition) ? (r.condition as WeatherCondition) : 'sunny',
      title,
      enabled: r.enabled !== false,
      lastFiredDayKey: typeof r.lastFiredDayKey === 'string' ? r.lastFiredDayKey : null,
    });
  }
  return out;
}

/** `${dayKey}#${ruleId}` — a square on the calendar and the rule that named it. */
export function weatherSourceId(dayKey: string, ruleId: string): string {
  return `${dayKey}#${ruleId}`;
}

/** The reverse of `weatherSourceId`, or null for anything that isn't one. */
export function parseWeatherSourceId(sourceId: string | null): { dayKey: string; ruleId: string } | null {
  if (!sourceId) return null;
  const i = sourceId.indexOf('#');
  if (i < 0) return null;
  const dayKey = sourceId.slice(0, i);
  const ruleId = sourceId.slice(i + 1);
  if (!dayKey || !ruleId) return null;
  return { dayKey, ruleId };
}

/** The rule id a weather task was generated from, or null for any other task. */
export function weatherRuleIdOf(task: Pick<Task, 'generatedKind' | 'generatedSourceId'>): string | null {
  return parseWeatherSourceId(generatedSourceOf(task, 'weather'))?.ruleId ?? null;
}

/**
 * Whether `rule` should produce a task today, given what the weather turned
 * out to be. Doesn't look at `lastFiredDayKey` — that's the idempotency mark,
 * spent by the caller before this is even asked (see `checkCalendarReviewTasks`
 * for the pattern: the mark is written unconditionally, ahead of the
 * qualifying check, so it covers "created" and "found not to apply" alike).
 */
export function ruleMatchesToday(rule: WeatherRule, conditions: readonly WeatherCondition[]): boolean {
  return rule.enabled && conditions.includes(rule.condition);
}

/**
 * The stretch of today a condition occupies. `startHour` is the first hour it
 * holds for and `endHour` the first hour it no longer does, so rain through
 * 5:59pm ends at 18 and a condition running to midnight ends at 24.
 */
export interface WeatherWindow {
  startHour: number;
  endHour: number;
}

/**
 * When today `condition` actually happens — the run of hours it holds for that
 * is either under way at `fromHour` or the next one after it, or null if the
 * hourly forecast doesn't have it (or doesn't exist).
 *
 * **Why a run rather than the whole day's matching hours.** A rule fires off
 * the day-level code (see `checkWeatherTasks`), which is a single summary for
 * all of today, so "rainy" is already established by the time this is asked;
 * what's left is where in the day to point. Showers at 4am and again at 3pm
 * are two answers, and the useful one is the one still ahead of you — which is
 * also why `fromHour` is a parameter rather than read from the clock in here:
 * the caller knows what "now" means under the day reset, and a pure function
 * that reads the clock can't be tested against one.
 */
export function weatherWindowFor(
  hours: readonly WeatherHour[] | null | undefined,
  condition: WeatherCondition,
  fromHour: number,
): WeatherWindow | null {
  if (!hours || hours.length === 0) return null;
  const matching = hours
    .filter(h => classifyWeather(h.weatherCode, h.tempF).includes(condition))
    .map(h => h.hour)
    .sort((a, b) => a - b);
  if (matching.length === 0) return null;

  // A gap ends a run — the hours in between are hours this condition doesn't
  // hold for, since Open-Meteo reports every hour of the day.
  const runs: WeatherWindow[] = [];
  for (const hour of matching) {
    const open = runs[runs.length - 1];
    if (open && hour === open.endHour) open.endHour = hour + 1;
    else runs.push({ startHour: hour, endHour: hour + 1 });
  }
  return runs.find(run => run.endHour > fromHour) ?? null;
}

/** "2pm", "12am", "9am" — an hour of the day, as a title would say it. */
function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'am' : 'pm';
  const clockHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${clockHour}${suffix}`;
}

/**
 * The window in words: "rain from 2pm", "rain until 10am", "rain 2pm to 6pm",
 * "rain all day".
 *
 * **It never says "now", "later" or "in two hours", and that is the point.**
 * The phrase is written into the task's title once (the rule's idempotency
 * mark means the generator won't revisit it that day, see `checkWeatherTasks`),
 * so anything relative to the moment of writing would be quietly wrong by the
 * afternoon. A clock time stays true all day whenever it's read.
 */
export function describeWeatherWindow(condition: WeatherCondition, window: WeatherWindow): string {
  const noun = conditionNoun(condition);
  const openEnded = window.endHour >= 24;
  const fromMidnight = window.startHour <= 0;
  if (openEnded && fromMidnight) return `${noun} all day`;
  if (openEnded) return `${noun} from ${hourLabel(window.startHour)}`;
  if (fromMidnight) return `${noun} until ${hourLabel(window.endHour)}`;
  return `${noun} ${hourLabel(window.startHour)} to ${hourLabel(window.endHour)}`;
}

/**
 * A weather task's title: the rule's own words, plus when the weather it's
 * about actually happens.
 *
 * The rule's title leads and is never rewritten — it's what the user typed,
 * and the window is the app's footnote to it. `phrase` is null whenever the
 * hourly forecast couldn't say (it didn't parse, or the condition is a
 * day-level summary no hour matched), and the title is then exactly what it
 * has always been rather than carrying an empty pair of brackets.
 */
export function weatherTaskTitle(ruleTitle: string, phrase: string | null): string {
  return phrase ? `${ruleTitle} (${phrase})` : ruleTitle;
}
