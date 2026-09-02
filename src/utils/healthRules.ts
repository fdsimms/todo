import type { HealthRule, Task } from '../types';
import type { HealthMetric } from './moodInsights';
import { generateId } from './id';
import { generatedSourceOf } from './generatedTasks';

/**
 * Health rules — "under six hours of sleep, add a task".
 *
 * The rules module for the `health` generator (see `generatedTasks.ts` and
 * `docs/arch/generated-tasks.md`), store-free like `weatherTasks.ts` and
 * `screenTimeRules.ts` beside it: orchestration — reading settings, reading
 * the snapshot, calling `reconcileGeneratedTask` — lives in `useTaskStore.ts`'s
 * `checkHealthTasks`. What's here is the storage round-trip and the pure
 * predicates.
 *
 * It sits between its two neighbours, and both differences are worth stating.
 *
 * - **The app has the reading, so it decides.** Unlike `screenTime`, nothing
 *   here is decided in another process: `useHealthStore` holds today's numbers
 *   and this compares them against a threshold. That means the idempotency
 *   mark *can* be spent ahead of the decision, the way weather spends it — with
 *   one exception below.
 * - **The threshold is per rule**, unlike weather, whose own note explains why
 *   it refuses one: a weather rule's title carries the meaning ("Put on
 *   sunscreen" wants a different bar from "Bring a heavy coat"). That move
 *   isn't available here, because the number *is* the rule. Six hours and four
 *   hours are two different days, and this is `screenTime`'s position rather
 *   than weather's.
 *
 * **Only "under" is expressible, and that is deliberate.** Every rule worth
 * writing here is a shortfall: a short night, a day spent sitting down. The
 * mirror ("at least 10,000 steps → …") describes something that has already
 * happened and needs no task, and offering a comparator would put a control on
 * every row to serve a case nobody has.
 */

/** A rule can't be an empty task title — nothing to show on Today. */
export const HEALTH_RULE_TITLE_MAX_LENGTH = 80;

/**
 * What each metric's threshold may be set to, in the metric's own unit.
 *
 * Whole numbers throughout, so one `CountStepper` serves both. Sleep in whole
 * hours because "under 6 hours" is how anybody says it and half-hours are
 * fussier than the reading is accurate; steps in five-hundreds because the
 * useful range spans two orders of magnitude and stepping it by one would be
 * sixty presses to say 3,000.
 */
export const HEALTH_THRESHOLDS: Record<
  HealthMetric,
  { min: number; max: number; step: number; default: number }
> = {
  steps: { min: 500, max: 30000, step: 500, default: 3000 },
  sleepHours: { min: 3, max: 12, step: 1, default: 6 },
};

/**
 * The hour of the logical day before which a metric's shortfall means nothing.
 *
 * The one thing this generator needs that neither neighbour does. A weather
 * rule is about a fact that is true all morning; a screen-time rule is told by
 * the OS at the moment it becomes true. A *shortfall* is different: "under
 * 3,000 steps" is true at 7am for everybody who is not out running, so firing
 * on it then would be telling people off for not having had their day yet.
 *
 * It is a property of the metric rather than a per-rule setting, which is what
 * keeps a fourth control off every row. Sleep is recorded overnight and is
 * settled by the time anybody looks, so it has no floor. Steps accumulate all
 * day, so the number only means something once most of the day has gone.
 *
 * 18:00 is round rather than measured, the same admission `weatherCondition.ts`
 * makes about its temperature bands — early enough to leave an evening to act
 * in, late enough that the day has had its chance.
 */
export const HEALTH_METRIC_EARLIEST_HOUR: Record<HealthMetric, number> = {
  steps: 18,
  sleepHours: 0,
};

export const HEALTH_METRICS: readonly HealthMetric[] = ['steps', 'sleepHours'];

/** The reading a rule is judged against, as much of it as this needs. */
export interface HealthRuleReading {
  steps: number | null;
  sleepHours: number | null;
}

/** How a metric is named in the rule editor. */
export function healthMetricLabel(metric: HealthMetric): string {
  return metric === 'steps' ? 'Steps' : 'Hours asleep';
}

/** "under 3,000 steps" / "under 6 hours asleep" — the rule's secondary line. */
export function describeHealthRule(rule: HealthRule): string {
  return rule.metric === 'steps'
    ? `Under ${rule.threshold.toLocaleString()} steps, from 6 PM`
    : `Under ${rule.threshold} ${rule.threshold === 1 ? 'hour' : 'hours'} asleep`;
}

export function clampHealthThreshold(metric: HealthMetric, value: number): number {
  const range = HEALTH_THRESHOLDS[metric];
  if (!Number.isFinite(value)) return range.default;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/**
 * The two rules the feature ships with, pre-filled rather than starting from an
 * empty list — the call `defaultWeatherRules` and `defaultScreenTimeRules` both
 * make, for the reason they give: the obvious rules are obvious, and typing one
 * from scratch is the trip a shipped default saves.
 *
 * Nothing is written from them until three separate switches are on (the read,
 * the generator, and the rule's own), so a pre-filled list costs nobody a task
 * they didn't ask for. Both titles are things to *do* rather than things to
 * conclude: "Keep today light" is a plan, where "You slept badly" would be the
 * app telling somebody about their own night. See `docs/arch/mood-log.md` for
 * the rule that comes from.
 */
export function defaultHealthRules(): HealthRule[] {
  return [
    {
      id: generateId(),
      metric: 'sleepHours',
      threshold: 6,
      title: 'Keep today light',
      enabled: true,
      lastFiredDayKey: null,
    },
    {
      id: generateId(),
      metric: 'steps',
      threshold: 3000,
      title: 'Go for a walk',
      enabled: true,
      lastFiredDayKey: null,
    },
  ];
}

/**
 * Read the stored list back, tolerantly.
 *
 * A malformed value reads as "nothing saved" and a bad entry is dropped rather
 * than discarding the list — `parseWeatherRules`' rules exactly.
 */
export function parseHealthRules(raw: string | null | undefined): HealthRule[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed.flatMap((entry): HealthRule[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const rule = entry as Partial<HealthRule>;
    if (typeof rule.id !== 'string' || rule.id === '') return [];
    if (typeof rule.title !== 'string' || rule.title.trim() === '') return [];
    if (typeof rule.threshold !== 'number') return [];
    // An unknown metric falls back rather than dropping the rule, the way an
    // unknown weather condition does: the title is the part somebody wrote.
    const metric: HealthMetric = rule.metric === 'steps' ? 'steps' : 'sleepHours';
    return [{
      id: rule.id,
      metric,
      threshold: clampHealthThreshold(metric, rule.threshold),
      title: rule.title.slice(0, HEALTH_RULE_TITLE_MAX_LENGTH),
      enabled: rule.enabled !== false,
      lastFiredDayKey: typeof rule.lastFiredDayKey === 'string' ? rule.lastFiredDayKey : null,
    }];
  });
}

export function serializeHealthRules(rules: readonly HealthRule[]): string {
  return JSON.stringify(rules);
}

/** `${dayKey}#${ruleId}` — a square on the calendar and the rule that named it. */
export function healthSourceId(dayKey: string, ruleId: string): string {
  return `${dayKey}#${ruleId}`;
}

export function parseHealthSourceId(
  sourceId: string | null | undefined,
): { dayKey: string; ruleId: string } | null {
  if (!sourceId) return null;
  const index = sourceId.indexOf('#');
  if (index <= 0 || index === sourceId.length - 1) return null;
  return { dayKey: sourceId.slice(0, index), ruleId: sourceId.slice(index + 1) };
}

/** The rule id a health task came from, or null for any other task. */
export function healthRuleIdOf(
  task: Pick<Task, 'generatedKind' | 'generatedSourceId'>,
): string | null {
  return parseHealthSourceId(generatedSourceOf(task, 'health'))?.ruleId ?? null;
}


/**
 * Whether the day has gone far enough for this rule's metric to mean anything.
 *
 * Separate from `ruleMatchesToday` because the caller has to know the
 * difference: a rule that hasn't reached its hour yet is **not** the same as a
 * rule that didn't match, and the idempotency mark must not be spent on it.
 * Spend it at 8am and a step rule can never fire that day.
 *
 * `hour` is the hour of the *logical* day, which the caller computes — this
 * module stays store-free, and `dayResetTime` lives in the settings store.
 */
export function ruleCanBeJudgedYet(
  rule: HealthRule,
  hour: number,
  reading: HealthRuleReading,
): boolean {
  if (hour < HEALTH_METRIC_EARLIEST_HOUR[rule.metric]) return false;
  // A reading that hasn't arrived is not a decision either, and this half is
  // the one that is easy to miss. A sleep rule has no hour to wait for — sleep
  // is settled by the time anybody looks — so without this the pass would judge
  // it at 00:05, find nothing recorded for the new day yet (because the night
  // has not happened), mark the day considered, and never fire again that day.
  // The rule would work for anybody who opens the app at eight and silently
  // never work for anybody whose phone is awake at midnight.
  const value = rule.metric === 'steps' ? reading.steps : reading.sleepHours;
  return value !== null;
}

/**
 * Whether today's reading falls short of what this rule asks for.
 *
 * **A missing reading never matches**, and that is the rule the whole feature
 * rests on rather than a null guard: HealthKit serves a refused read as an
 * empty store, so null covers "you said no" as well as "nothing recorded".
 * Reading it as zero would fire "Go for a walk" at everybody who declined to
 * share their steps, every single evening. See `docs/arch/health-data.md`.
 *
 * Doesn't consult `lastFiredDayKey`; the caller spends that mark itself, the
 * way `weatherTasks.ts`'s `ruleMatchesToday` leaves it to `checkWeatherTasks`.
 * Named for the shortfall rather than for matching, because weather's function
 * of that name is imported into the same file and two `ruleMatchesToday`s
 * behind an alias is a rename waiting to go to the wrong one.
 */
export function ruleShortfallToday(rule: HealthRule, reading: HealthRuleReading): boolean {
  if (!rule.enabled) return false;
  const value = rule.metric === 'steps' ? reading.steps : reading.sleepHours;
  if (value === null) return false;
  return value < rule.threshold;
}

/**
 * Under this many hours, a night is short enough to mention under "Lighten
 * today".
 *
 * Round rather than measured, like `HEALTH_METRIC_EARLIEST_HOUR` above and the
 * weather module's temperature bands. Deliberately a constant rather than the
 * user's own sleep rule: the note is a line in a menu somebody opened and shows
 * whether or not the generator is on, so reading a rule would make it appear
 * and disappear with a switch that is about tasks.
 */
export const SHORT_SLEEP_HOURS = 6;

/** "5h 20m". */
function formatSleep(hours: number): string {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  // 59.6 minutes rounding to 60 would render "5h 60m".
  if (minutes === 60) return `${whole + 1}h`;
  return minutes === 0 ? `${whole}h` : `${whole}h ${minutes}m`;
}

/**
 * One line saying Health recorded a short night, or null.
 *
 * The health twin of `lowMoodDeloadNote`, under the three rules that one lives
 * by: not a banner, not a second task, and **not a change to what
 * `buildDeloadPlan` pre-checks**. Offering the sheet is help; deciding what
 * comes off the day is not the app's call, and a bad night must not break a
 * twelve-day streak.
 *
 * The one place it departs from its twin is the wording, and it matters. The
 * mood note can say "You've logged a low mood three days running" because the
 * person logged it. Nobody logged this: it is a watch's guess, and it may be a
 * nap, or a phone left on the nightstand. So the sentence **attributes the
 * source rather than asserting the fact**, and says "for today" rather than
 * "last night", since a nap counts toward its own day. See
 * `docs/arch/health-data.md`.
 */
export function shortSleepDeloadNote(sleepHours: number | null): string | null {
  // Null is a refused read as much as an unrecorded night, so it says nothing
  // at all — the rule the whole feature rests on.
  if (sleepHours === null) return null;
  if (sleepHours >= SHORT_SLEEP_HOURS) return null;
  return `Apple Health recorded ${formatSleep(sleepHours)} of sleep for today.`;
}
