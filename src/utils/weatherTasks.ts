import type { Task, WeatherCondition, WeatherRule } from '../types';
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
