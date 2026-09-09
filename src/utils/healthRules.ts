import { format } from 'date-fns/format';
import type { HealthRule, Task } from '../types';
import { generateId } from './id';
import { generatedSourceOf } from './generatedTasks';

/**
 * The metrics a health rule can watch — a superset of `HealthMetric`
 * (`moodInsights.ts`'s steps/sleep axis) plus the three nutrients, none of
 * which have a mood axis of their own since `MoodDay` carries no nutrient
 * fields. Kept as its own type rather than widening `HealthMetric` itself, so
 * `moodInsights.ts`'s axis functions — written against `MoodDay`'s actual
 * fields — don't gain a case they can't answer.
 */
export type HealthRuleMetric = 'steps' | 'sleepHours' | 'sodiumMg' | 'proteinG' | 'satFatG';

/**
 * Which way a metric's reading is compared against its threshold.
 *
 * Every metric but saturated fat is a floor: the reading has to reach the
 * number, and falling short is what fires the task. Saturated fat alone is a
 * ceiling, because that is the only shape a "don't go above X" request can
 * take — nobody asks this app to make sure they eat *enough* saturated fat.
 * Both directions are still a shortfall against a number the user picked
 * (see the file-level note on why a general greater/less toggle isn't
 * offered): 'over' doesn't mean "any comparator you like", it means this one
 * metric's shortfall is measured the other way.
 */
export const HEALTH_METRIC_DIRECTION: Record<HealthRuleMetric, 'under' | 'over'> = {
  steps: 'under',
  sleepHours: 'under',
  sodiumMg: 'under',
  proteinG: 'under',
  satFatG: 'over',
};

/** Which way `metric` is compared — see `HEALTH_METRIC_DIRECTION`. */
export function healthRuleDirection(metric: HealthRuleMetric): 'under' | 'over' {
  return HEALTH_METRIC_DIRECTION[metric];
}

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
 * **The comparator is a property of the metric, not a control on the row, and
 * that is still deliberate even now that both directions exist.** Every rule
 * here is a shortfall against a number the user picked; what changed is that
 * one metric's shortfall (saturated fat) is measured as *too much* rather
 * than *too little*. A rule that let you flip "under 3,000 steps" to "over
 * 3,000 steps" would describe something that has already happened and needs
 * no task, so that comparator is never offered — the mirror this file used to
 * rule out entirely is still ruled out, only saturated fat's own, opposite,
 * direction now exists because a nutrient ceiling is a real request the
 * mirror argument never covered. See `HEALTH_METRIC_DIRECTION`.
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
  HealthRuleMetric,
  { min: number; max: number; step: number; default: number }
> = {
  steps: { min: 500, max: 30000, step: 500, default: 3000 },
  sleepHours: { min: 3, max: 12, step: 1, default: 6 },
  // Hundreds, not the 500s steps uses: a sodium target is picked with a doctor
  // or a food label in hand, and 2,000/4,000mg-shaped numbers want a finer
  // step than steps' order-of-magnitude range does.
  sodiumMg: { min: 0, max: 6000, step: 100, default: 2000 },
  // Grams, in fives: a protein target is usually said as "50g" or "100g", not
  // to the gram, and a 5g step reaches the common targets in a handful of
  // presses without the hundred-plus presses a step of 1 would cost.
  proteinG: { min: 0, max: 400, step: 5, default: 50 },
  // A ceiling is usually phrased in single grams ("under 20g"), which is
  // small enough a range that the finer step doesn't cost many presses.
  satFatG: { min: 0, max: 100, step: 1, default: 20 },
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
 * It is a property of the metric rather than a per-rule setting for steps and
 * sleep, which is what keeps a fourth control off either row. Sleep is
 * recorded overnight and is settled by the time anybody looks, so it has no
 * floor. Steps accumulate all day, so the number only means something once
 * most of the day has gone — and one evening floor is enough, because nobody
 * asked this app for a mid-afternoon step checkpoint.
 *
 * 18:00 is round rather than measured, the same admission `weatherCondition.ts`
 * makes about its temperature bands — early enough to leave an evening to act
 * in, late enough that the day has had its chance.
 *
 * **The three nutrients are what this doesn't hold for**, and the reason is
 * the feature itself rather than a change of mind about the argument above.
 * A sodium or protein target is routinely checked several times over a day on
 * purpose ("2,000mg by lunch, 4,000mg by dinner"), not once at a single
 * evening floor, so there is no one hour to hang off this map for either.
 * Saturated fat is the mirror case for the opposite reason: a *ceiling* wants
 * catching as early in the day as it's crossed, not held back until evening
 * the way a floor is — so its fallback here is 0, not 18. `HealthRule.
 * checkpointHour` carries the real hour per rule for all three, and the
 * entries here are only the value a freshly created rule starts from.
 */
export const HEALTH_METRIC_EARLIEST_HOUR: Record<HealthRuleMetric, number> = {
  steps: 18,
  sleepHours: 0,
  sodiumMg: 12,
  proteinG: 18,
  satFatG: 0,
};

export const HEALTH_METRICS: readonly HealthRuleMetric[] =
  ['steps', 'sleepHours', 'sodiumMg', 'proteinG', 'satFatG'];

/** The hour of the day a rule is judged from — its own, or the metric's fallback. */
export function healthRuleCheckpointHour(rule: Pick<HealthRule, 'metric' | 'checkpointHour'>): number {
  return rule.checkpointHour ?? HEALTH_METRIC_EARLIEST_HOUR[rule.metric];
}

/** The reading a rule is judged against, as much of it as this needs. */
export interface HealthRuleReading {
  steps: number | null;
  sleepHours: number | null;
  sodiumMg: number | null;
  proteinG: number | null;
  satFatG: number | null;
}

function readingValue(rule: Pick<HealthRule, 'metric'>, reading: HealthRuleReading): number | null {
  switch (rule.metric) {
    case 'steps': return reading.steps;
    case 'sodiumMg': return reading.sodiumMg;
    case 'proteinG': return reading.proteinG;
    case 'satFatG': return reading.satFatG;
    default: return reading.sleepHours;
  }
}

/** How a metric is named in the rule editor. */
export function healthMetricLabel(metric: HealthRuleMetric): string {
  switch (metric) {
    case 'steps': return 'Steps';
    case 'sodiumMg': return 'Sodium';
    case 'proteinG': return 'Protein';
    case 'satFatG': return 'Saturated fat';
    default: return 'Hours asleep';
  }
}

/** "12 PM" / "6 PM" — round-hour only, the same granularity the map above uses. */
export function formatCheckpointHour(hour: number): string {
  return format(new Date(2000, 0, 1, hour, 0, 0, 0), 'h a');
}

/**
 * "under 3,000 steps" / "under 6 hours asleep" / "under 2,000mg sodium" /
 * "over 20g saturated fat" — the rule's secondary line.
 */
export function describeHealthRule(rule: HealthRule): string {
  if (rule.metric === 'steps') return `Under ${rule.threshold.toLocaleString()} steps, from 6 PM`;
  if (rule.metric === 'sleepHours') {
    return `Under ${rule.threshold} ${rule.threshold === 1 ? 'hour' : 'hours'} asleep`;
  }
  const comparator = healthRuleDirection(rule.metric) === 'over' ? 'Over' : 'Under';
  const checkpoint = formatCheckpointHour(healthRuleCheckpointHour(rule));
  if (rule.metric === 'sodiumMg') {
    return `${comparator} ${rule.threshold.toLocaleString()}mg sodium, from ${checkpoint}`;
  }
  if (rule.metric === 'proteinG') return `${comparator} ${rule.threshold}g protein, from ${checkpoint}`;
  return `${comparator} ${rule.threshold}g saturated fat, from ${checkpoint}`; // satFatG
}

export function clampHealthThreshold(metric: HealthRuleMetric, value: number): number {
  const range = HEALTH_THRESHOLDS[metric];
  if (!Number.isFinite(value)) return range.default;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** Holds an hour inside the 0–23 a checkpoint may be set to. */
export function clampCheckpointHour(value: number): number {
  if (!Number.isFinite(value)) return HEALTH_METRIC_EARLIEST_HOUR.sodiumMg;
  return Math.min(23, Math.max(0, Math.round(value)));
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
    const metric: HealthRuleMetric =
      rule.metric === 'steps' || rule.metric === 'sodiumMg'
        || rule.metric === 'proteinG' || rule.metric === 'satFatG'
        ? rule.metric
        : 'sleepHours';
    return [{
      id: rule.id,
      metric,
      threshold: clampHealthThreshold(metric, rule.threshold),
      // Only the three nutrients read this back; steps/sleep ignore it (see
      // HEALTH_METRIC_EARLIEST_HOUR's comment), so there's nothing to lose by
      // keeping it for any metric a stored rule happens to carry it under.
      checkpointHour: typeof rule.checkpointHour === 'number'
        ? clampCheckpointHour(rule.checkpointHour)
        : undefined,
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
 * This gate is symmetric across both directions — it only asks whether the
 * checkpoint hour has arrived and the reading exists, not which way the rule
 * compares. What differs by direction is what the *caller* does once this
 * says yes: `checkHealthTasks` spends the idempotency mark unconditionally
 * for an 'under' rule (a floor can only get easier to clear as the day goes
 * on, so one look past the checkpoint is final), but only when it actually
 * matches for an 'over' rule (a ceiling can only get easier to *cross* as the
 * day goes on, so an early "still under" is not a day-long answer — the rule
 * has to keep being reconsidered until it either fires or the day ends).
 *
 * `hour` is the hour of the *logical* day, which the caller computes — this
 * module stays store-free, and `dayResetTime` lives in the settings store.
 */
export function ruleCanBeJudgedYet(
  rule: HealthRule,
  hour: number,
  reading: HealthRuleReading,
): boolean {
  if (hour < healthRuleCheckpointHour(rule)) return false;
  // A reading that hasn't arrived is not a decision either, and this half is
  // the one that is easy to miss. A sleep rule has no hour to wait for — sleep
  // is settled by the time anybody looks — so without this the pass would judge
  // it at 00:05, find nothing recorded for the new day yet (because the night
  // has not happened), mark the day considered, and never fire again that day.
  // The rule would work for anybody who opens the app at eight and silently
  // never work for anybody whose phone is awake at midnight.
  return readingValue(rule, reading) !== null;
}

/**
 * Whether today's reading fails what this rule asks for — under its floor,
 * or (saturated fat only) over its ceiling. See `HEALTH_METRIC_DIRECTION`.
 *
 * **A missing reading never matches**, and that is the rule the whole feature
 * rests on rather than a null guard: HealthKit serves a refused read as an
 * empty store, so null covers "you said no" as well as "nothing recorded".
 * Reading it as zero would fire "Go for a walk" at everybody who declined to
 * share their steps, every single evening — and, on the 'over' side, would
 * fire a saturated-fat warning at everybody who declined to share that
 * reading too, which is the identical failure in the other direction. See
 * `docs/arch/health-data.md`.
 *
 * Doesn't consult `lastFiredDayKey`; the caller spends that mark itself, the
 * way `weatherTasks.ts`'s `ruleMatchesToday` leaves it to `checkWeatherTasks`
 * — and, for an 'over' rule, spends it only when this returns true; see
 * `ruleCanBeJudgedYet`'s comment for why the two directions can't share one
 * spending rule. Named for the shortfall rather than for matching, because
 * weather's function of that name is imported into the same file and two
 * `ruleMatchesToday`s behind an alias is a rename waiting to go to the wrong
 * one.
 */
export function ruleShortfallToday(rule: HealthRule, reading: HealthRuleReading): boolean {
  if (!rule.enabled) return false;
  const value = readingValue(rule, reading);
  if (value === null) return false;
  return healthRuleDirection(rule.metric) === 'over' ? value > rule.threshold : value < rule.threshold;
}

/** "1,850mg of sodium" / "42g of protein" / "28g of saturated fat". */
function nutrientAmount(metric: 'sodiumMg' | 'proteinG' | 'satFatG', value: number): string {
  if (metric === 'sodiumMg') return `${value.toLocaleString()}mg of sodium`;
  if (metric === 'proteinG') return `${value}g of protein`;
  return `${value}g of saturated fat`;
}

/**
 * One line saying what Health has recorded for a nutrient so far today, for
 * the row's own `notes` — the nutrient twin of `shortSleepDeloadNote`, minus
 * the standalone menu line: nothing elsewhere in the app wants to say this
 * outside the task it already caused.
 *
 * Same attribution rule for all three: nobody logged this figure by hand, so
 * the sentence names the source rather than passing the number off as a fact
 * the user stated, and it never advises or diagnoses (see
 * `docs/arch/health-data.md` and `docs/arch/mood-log.md`'s rule this whole
 * generator lives by) — true of the ceiling as much as the floors: the note
 * reports what was recorded, never that it's "too much".
 */
export function sodiumShortfallNote(sodiumMg: number): string {
  return `Apple Health has recorded ${nutrientAmount('sodiumMg', sodiumMg)} today.`;
}

/** The protein twin of `sodiumShortfallNote`. */
export function proteinShortfallNote(proteinG: number): string {
  return `Apple Health has recorded ${nutrientAmount('proteinG', proteinG)} today.`;
}

/** The saturated-fat twin of `sodiumShortfallNote` — a ceiling crossed, reported the same way a floor missed is. */
export function satFatOverageNote(satFatG: number): string {
  return `Apple Health has recorded ${nutrientAmount('satFatG', satFatG)} today.`;
}

/**
 * The row's own `notes`, for whichever metric a rule watches — the one place
 * `checkHealthTasks` reaches to decide, so it stays a single `draft()` line
 * rather than a five-way ternary living in the store.
 *
 * Steps carries none, for `healthTaskLinkUrl`'s reason: "Go for a walk"
 * already names its own action. The other four are the app's own inference
 * from a reading nobody stated, so each attributes its source — see the note
 * on `sodiumShortfallNote` above for why that matters as much for the
 * ceiling as for a floor.
 */
export function healthTaskNote(rule: HealthRule, reading: HealthRuleReading): string | undefined {
  switch (rule.metric) {
    case 'sleepHours': return shortSleepDeloadNote(reading.sleepHours) ?? undefined;
    case 'sodiumMg': return reading.sodiumMg === null ? undefined : sodiumShortfallNote(reading.sodiumMg);
    case 'proteinG': return reading.proteinG === null ? undefined : proteinShortfallNote(reading.proteinG);
    case 'satFatG': return reading.satFatG === null ? undefined : satFatOverageNote(reading.satFatG);
    default: return undefined; // steps
  }
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

// `dundundun://deload` — opens DeloadSheet on Today (see resetToDeload in
// navigationRef.ts). This is the sleep rule's own row saying why it's there,
// same argument `shortSleepDeloadNote` makes for the menu line beside it: not
// asserting a fact nobody logged, just carrying the one action that follows
// from it.
const DELOAD_LINK_URL = 'dundundun://deload';

/**
 * The row's own action, for a sleep-shortfall rule only.
 *
 * A short night wants to open the sheet that actually lightens the day; a
 * step-shortfall rule ("Go for a walk") already names its own action in the
 * title, so it carries no link — same split `shortSleepDeloadNote` draws
 * against a steps note that doesn't exist.
 */
export function healthTaskLinkUrl(metric: HealthRuleMetric): string | null {
  return metric === 'sleepHours' ? DELOAD_LINK_URL : null;
}
