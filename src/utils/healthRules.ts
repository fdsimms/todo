import { format } from 'date-fns/format';
import type { HealthNutrientMetric, HealthRule, HealthRuleMetric, Task } from '../types';
import { generateId } from './id';
import { generatedSourceOf } from './generatedTasks';

/**
 * Every metric but steps and sleep — the ones with a per-rule checkpoint hour
 * and direction. See `HEALTH_METRIC_EARLIEST_HOUR`'s comment.
 *
 * Typed as `HealthNutrientMetric` rather than `HealthRuleMetric` so the list
 * carries that type's constraint: a ninth entry here with no home in
 * `NutrientKey` fails the build, because a rule watching a nutrient this app
 * cannot record is one it could never satisfy from its own food data.
 */
export const HEALTH_NUTRIENT_METRICS: readonly HealthNutrientMetric[] =
  ['sodiumMg', 'proteinG', 'satFatG', 'fiberG', 'sugarG', 'caffeineMg', 'waterMl', 'calorieKcal'];

/** Whether `metric` uses a per-rule checkpoint hour and direction, rather than steps/sleep's fixed pair. */
export function usesCheckpoint(metric: HealthRuleMetric): boolean {
  return metric !== 'steps' && metric !== 'sleepHours';
}

/**
 * One row of everything a nutrient metric needs, so adding a ninth doesn't
 * mean finding and extending eight separate switch statements. Steps and
 * sleep are deliberately *not* in this table — they render their threshold
 * differently (no unit suffix, singular/plural hours) and never take a
 * checkpoint or a direction, so folding them in would make every reader
 * handle two shapes instead of one. `describeHealthRule` and
 * `HealthRulesSheet`'s stepper keep their own two-line special case for
 * those two; everything past this table is nutrient-only.
 */
interface HealthMetricInfo {
  /** "Sodium" — the metric picker's label, and the noun `describeHealthRule` appends after the number. */
  label: string;
  /** Which way a freshly created rule for this metric starts — see `HEALTH_METRIC_DIRECTION`. */
  defaultDirection: 'under' | 'over';
  /** The hour a freshly created rule starts from — see `HEALTH_METRIC_EARLIEST_HOUR`. */
  defaultCheckpointHour: number;
  threshold: { min: number; max: number; step: number; default: number };
  /**
   * The number with its unit, nothing else — "2,000mg" / "50g" / "2,000mL".
   * Calories return the bare number, because `label` ("calories") is already
   * the unit word and "2,000kcal calories" would say it twice.
   */
  amount: (n: number) => string;
}

const HEALTH_METRIC_INFO: Record<Exclude<HealthRuleMetric, 'steps' | 'sleepHours'>, HealthMetricInfo> = {
  sodiumMg: {
    label: 'Sodium',
    defaultDirection: 'under',
    defaultCheckpointHour: 12,
    // Hundreds, not the 500s steps uses: a sodium target is picked with a
    // doctor or a food label in hand, and 2,000/4,000mg-shaped numbers want a
    // finer step than steps' order-of-magnitude range does.
    threshold: { min: 0, max: 6000, step: 100, default: 2000 },
    amount: n => `${n.toLocaleString()}mg`,
  },
  proteinG: {
    label: 'Protein',
    defaultDirection: 'under',
    defaultCheckpointHour: 18,
    // Grams, in fives: a protein target is usually said as "50g" or "100g",
    // not to the gram, and a 5g step reaches the common targets in a handful
    // of presses without the hundred-plus presses a step of 1 would cost.
    threshold: { min: 0, max: 400, step: 5, default: 50 },
    amount: n => `${n}g`,
  },
  satFatG: {
    label: 'Saturated fat',
    defaultDirection: 'over',
    defaultCheckpointHour: 0,
    // A ceiling is usually phrased in single grams ("under 20g"), which is
    // small enough a range that the finer step doesn't cost many presses.
    threshold: { min: 0, max: 100, step: 1, default: 20 },
    amount: n => `${n}g`,
  },
  fiberG: {
    label: 'Fiber',
    defaultDirection: 'under',
    defaultCheckpointHour: 18,
    // A fiber target is a single-gram number too ("25g", "38g"), same
    // reasoning as saturated fat's step even though the direction differs.
    threshold: { min: 0, max: 100, step: 1, default: 25 },
    amount: n => `${n}g`,
  },
  sugarG: {
    label: 'Sugar',
    defaultDirection: 'over',
    defaultCheckpointHour: 0,
    // Fives, like protein: a sugar ceiling is usually a round number ("50g")
    // rather than a single-gram figure.
    threshold: { min: 0, max: 200, step: 5, default: 50 },
    amount: n => `${n}g`,
  },
  caffeineMg: {
    label: 'Caffeine',
    defaultDirection: 'over',
    defaultCheckpointHour: 0,
    // 25s: a caffeine ceiling is commonly stated as "400mg", and single
    // milligrams would be false precision for a reading nobody measures that
    // finely to begin with.
    threshold: { min: 0, max: 1000, step: 25, default: 400 },
    amount: n => `${n.toLocaleString()}mg`,
  },
  waterMl: {
    label: 'Water',
    defaultDirection: 'under',
    defaultCheckpointHour: 18,
    // Quarter-litres: close to a cup, which is how most people actually
    // measure a refill, and a coarser step than sodium's needs to be since a
    // water goal is a much smaller number of "servings" than a sodium target
    // is milligrams.
    threshold: { min: 0, max: 5000, step: 250, default: 2000 },
    amount: n => `${n.toLocaleString()}mL`,
  },
  calorieKcal: {
    label: 'Calories',
    defaultDirection: 'under',
    defaultCheckpointHour: 18,
    threshold: { min: 500, max: 6000, step: 50, default: 2000 },
    // No unit suffix — see the table's own doc comment on `amount`.
    amount: n => n.toLocaleString(),
  },
};

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
 * **The comparator is a per-rule choice for the eight nutrients, and a fixed
 * one for steps and sleep.** Every rule here is a shortfall against a number
 * the user picked; what a nutrient adds is that its shortfall can be measured
 * either way, because a diet goal genuinely can point either direction — a
 * sodium ceiling for blood pressure is as real a want as a sodium floor for
 * POTS, a calorie floor for bulking as real as a calorie ceiling for cutting.
 * Steps and sleep don't get the same toggle: "over 3,000 steps" or "over 6
 * hours asleep" describes something that has already happened and needs no
 * task, the mirror this file used to rule out for every metric before
 * saturated fat's ceiling showed the argument wasn't universal. The
 * nutrients are the one place a comparator earns its control; the two clock-
 * bound metrics still don't have a case for one. See `HealthRule.direction`
 * and `HEALTH_METRIC_DIRECTION`.
 */

/** A rule can't be an empty task title — nothing to show on Today. */
export const HEALTH_RULE_TITLE_MAX_LENGTH = 80;

/**
 * What each metric's threshold may be set to, in the metric's own unit.
 *
 * Whole numbers throughout, so one `CountStepper` serves every metric. Sleep
 * in whole hours because "under 6 hours" is how anybody says it and
 * half-hours are fussier than the reading is accurate; steps in five-hundreds
 * because the useful range spans two orders of magnitude and stepping it by
 * one would be sixty presses to say 3,000. The eight nutrients' own ranges
 * and steps are explained beside each in `HEALTH_METRIC_INFO`.
 */
export const HEALTH_THRESHOLDS: Record<
  HealthRuleMetric,
  { min: number; max: number; step: number; default: number }
> = {
  steps: { min: 500, max: 30000, step: 500, default: 3000 },
  sleepHours: { min: 3, max: 12, step: 1, default: 6 },
  sodiumMg: HEALTH_METRIC_INFO.sodiumMg.threshold,
  proteinG: HEALTH_METRIC_INFO.proteinG.threshold,
  satFatG: HEALTH_METRIC_INFO.satFatG.threshold,
  fiberG: HEALTH_METRIC_INFO.fiberG.threshold,
  sugarG: HEALTH_METRIC_INFO.sugarG.threshold,
  caffeineMg: HEALTH_METRIC_INFO.caffeineMg.threshold,
  waterMl: HEALTH_METRIC_INFO.waterMl.threshold,
  calorieKcal: HEALTH_METRIC_INFO.calorieKcal.threshold,
};

/**
 * Which way a metric's reading is compared against its threshold, by default.
 *
 * A floor ("under") for most metrics, since that is what a person usually
 * wants from steps, sleep, protein, fiber, water or calories — except
 * saturated fat, sugar and caffeine, which start as a ceiling ("over")
 * because "don't go above X" is the far more common ask for those three.
 * Either is a real want for a nutrient depending on the diet behind it (a
 * sodium ceiling for someone managing blood pressure is as legitimate as a
 * sodium floor for POTS), so this is only ever the value a freshly created
 * rule starts from — `HealthRule.direction` can override it per rule for any
 * of the eight nutrients. See `healthRuleDirection`. Steps and sleep have no
 * override and stay fixed at `'under'`.
 */
export const HEALTH_METRIC_DIRECTION: Record<HealthRuleMetric, 'under' | 'over'> = {
  steps: 'under',
  sleepHours: 'under',
  sodiumMg: HEALTH_METRIC_INFO.sodiumMg.defaultDirection,
  proteinG: HEALTH_METRIC_INFO.proteinG.defaultDirection,
  satFatG: HEALTH_METRIC_INFO.satFatG.defaultDirection,
  fiberG: HEALTH_METRIC_INFO.fiberG.defaultDirection,
  sugarG: HEALTH_METRIC_INFO.sugarG.defaultDirection,
  caffeineMg: HEALTH_METRIC_INFO.caffeineMg.defaultDirection,
  waterMl: HEALTH_METRIC_INFO.waterMl.defaultDirection,
  calorieKcal: HEALTH_METRIC_INFO.calorieKcal.defaultDirection,
};

/**
 * Which way `rule` is compared — its own choice, or the metric's default.
 *
 * Both directions are still a shortfall against a number the user picked
 * (see the file-level note on why a general greater/less toggle isn't
 * offered on steps or sleep): 'over' doesn't mean "any comparator you like"
 * on every row, it means *this* rule's shortfall is measured the other way,
 * chosen the same way its checkpoint hour is.
 */
export function healthRuleDirection(rule: Pick<HealthRule, 'metric' | 'direction'>): 'under' | 'over' {
  return rule.direction ?? HEALTH_METRIC_DIRECTION[rule.metric];
}

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
 * **The eight nutrients are what this doesn't hold for**, and the reason is
 * the feature itself rather than a change of mind about the argument above.
 * A sodium or protein target is routinely checked several times over a day on
 * purpose ("2,000mg by lunch, 4,000mg by dinner"), not once at a single
 * evening floor, so there is no one hour to hang off this map for any of
 * them. A ceiling reading wants catching as early in the day as it's crossed,
 * not held back until evening the way a floor is — so a nutrient whose
 * default direction is a ceiling (saturated fat, sugar, caffeine) defaults to
 * 0 here rather than 18. `HealthRule.checkpointHour` carries the real hour
 * per rule for all eight, and the entries here are only the value a
 * freshly-created rule starts from.
 */
export const HEALTH_METRIC_EARLIEST_HOUR: Record<HealthRuleMetric, number> = {
  steps: 18,
  sleepHours: 0,
  sodiumMg: HEALTH_METRIC_INFO.sodiumMg.defaultCheckpointHour,
  proteinG: HEALTH_METRIC_INFO.proteinG.defaultCheckpointHour,
  satFatG: HEALTH_METRIC_INFO.satFatG.defaultCheckpointHour,
  fiberG: HEALTH_METRIC_INFO.fiberG.defaultCheckpointHour,
  sugarG: HEALTH_METRIC_INFO.sugarG.defaultCheckpointHour,
  caffeineMg: HEALTH_METRIC_INFO.caffeineMg.defaultCheckpointHour,
  waterMl: HEALTH_METRIC_INFO.waterMl.defaultCheckpointHour,
  calorieKcal: HEALTH_METRIC_INFO.calorieKcal.defaultCheckpointHour,
};

export const HEALTH_METRICS: readonly HealthRuleMetric[] =
  ['steps', 'sleepHours', ...HEALTH_NUTRIENT_METRICS];

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
  fiberG: number | null;
  sugarG: number | null;
  caffeineMg: number | null;
  waterMl: number | null;
  calorieKcal: number | null;
}

function readingValue(rule: Pick<HealthRule, 'metric'>, reading: HealthRuleReading): number | null {
  return reading[rule.metric];
}

/** How a metric is named in the rule editor. */
export function healthMetricLabel(metric: HealthRuleMetric): string {
  if (metric === 'steps') return 'Steps';
  if (metric === 'sleepHours') return 'Hours asleep';
  return HEALTH_METRIC_INFO[metric].label;
}

/** "12 PM" / "6 PM" — round-hour only, the same granularity the map above uses. */
export function formatCheckpointHour(hour: number): string {
  return format(new Date(2000, 0, 1, hour, 0, 0, 0), 'h a');
}

/**
 * "3,000 steps" / "6 hours asleep" / "2,000mg sodium" / "2,000 calories" — a
 * number with its unit and noun together, shared by `describeHealthRule`'s
 * secondary line and the rule editor's own stepper (`format`/`describeValue`
 * in `HealthRulesSheet`), so the two never drift on how a given metric's
 * number reads.
 */
export function healthMetricAmount(metric: HealthRuleMetric, n: number): string {
  if (metric === 'steps') return `${n.toLocaleString()} steps`;
  if (metric === 'sleepHours') return `${n} ${n === 1 ? 'hour' : 'hours'} asleep`;
  const info = HEALTH_METRIC_INFO[metric];
  return `${info.amount(n)} ${info.label.toLowerCase()}`;
}

/**
 * "under 3,000 steps" / "under 6 hours asleep" / "under 2,000mg sodium" /
 * "over 20g saturated fat" — the rule's secondary line.
 */
export function describeHealthRule(rule: HealthRule): string {
  const comparator = healthRuleDirection(rule) === 'over' ? 'Over' : 'Under';
  const amount = healthMetricAmount(rule.metric, rule.threshold);
  // Sleep is the one metric with no checkpoint phrase at all — it has no
  // hour to wait for (see `HEALTH_METRIC_EARLIEST_HOUR`'s comment), and
  // "from 12 AM" would be a strange thing to say about a night's sleep.
  // Every other metric, steps included, always has one: steps' own hour is
  // fixed rather than per-rule, but `healthRuleCheckpointHour` already
  // resolves that the same way it resolves a nutrient's.
  if (rule.metric === 'sleepHours') return `${comparator} ${amount}`;
  const checkpoint = formatCheckpointHour(healthRuleCheckpointHour(rule));
  return `${comparator} ${amount}, from ${checkpoint}`;
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

/** A stored value read back as a direction, or undefined for anything else — the metric's own default then applies. */
function parseDirection(value: unknown): 'under' | 'over' | undefined {
  return value === 'under' || value === 'over' ? value : undefined;
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

const KNOWN_METRICS: ReadonlySet<string> = new Set<HealthRuleMetric>(HEALTH_METRICS);

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
      typeof rule.metric === 'string' && KNOWN_METRICS.has(rule.metric)
        ? (rule.metric as HealthRuleMetric)
        : 'sleepHours';
    return [{
      id: rule.id,
      metric,
      threshold: clampHealthThreshold(metric, rule.threshold),
      // Only the eight nutrients read these back; steps/sleep ignore them
      // (see HEALTH_METRIC_EARLIEST_HOUR's comment), so there's nothing to
      // lose by keeping either for any metric a stored rule happens to carry
      // it under.
      checkpointHour: typeof rule.checkpointHour === 'number'
        ? clampCheckpointHour(rule.checkpointHour)
        : undefined,
      direction: parseDirection(rule.direction),
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
 * or over its ceiling. See `HEALTH_METRIC_DIRECTION`/`HealthRule.direction`.
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
  return healthRuleDirection(rule) === 'over' ? value > rule.threshold : value < rule.threshold;
}

/**
 * One line saying what Health has recorded for a nutrient so far today, for
 * the row's own `notes` — the nutrient twin of `shortSleepDeloadNote`, minus
 * the standalone menu line: nothing elsewhere in the app wants to say this
 * outside the task it already caused.
 *
 * Same attribution rule for all eight: nobody logged this figure by hand, so
 * the sentence names the source rather than passing the number off as a fact
 * the user stated, and it never advises or diagnoses (see
 * `docs/arch/health-data.md` and `docs/arch/mood-log.md`'s rule this whole
 * generator lives by) — true of a ceiling as much as a floor: the note
 * reports what was recorded, never that it's "too much" or "not enough".
 *
 * One function rather than eight near-copies (an earlier version of this file
 * had three, one per nutrient that existed then, and it was already the
 * wrong shape to keep growing one function per metric).
 */
export function nutrientReadingNote(metric: Exclude<HealthRuleMetric, 'steps' | 'sleepHours'>, value: number): string {
  const info = HEALTH_METRIC_INFO[metric];
  // Calories reads "2,000 calories today", not "2,000 of calories today" —
  // every other nutrient wants the "of" because its amount is a bare
  // number-plus-unit ("1,850mg") that needs the noun to follow, but
  // calories' own label already reads as a complete noun phrase.
  const phrase = metric === 'calorieKcal'
    ? `${info.amount(value)} ${info.label.toLowerCase()}`
    : `${info.amount(value)} of ${info.label.toLowerCase()}`;
  return `Apple Health has recorded ${phrase} today.`;
}

/**
 * The row's own `notes`, for whichever metric a rule watches — the one place
 * `checkHealthTasks` reaches to decide, so it stays a single `draft()` line
 * rather than a ten-way ternary living in the store.
 *
 * Steps carries none, for `healthTaskLinkUrl`'s reason: "Go for a walk"
 * already names its own action. Sleep gets `shortSleepDeloadNote`, its own
 * function since it also feeds the standalone "Lighten today" menu line.
 * Every other metric is the app's own inference from a reading nobody
 * stated, so each gets `nutrientReadingNote` — see its doc comment for why
 * that matters as much for a ceiling as for a floor.
 */
export function healthTaskNote(rule: HealthRule, reading: HealthRuleReading): string | undefined {
  if (rule.metric === 'steps') return undefined;
  if (rule.metric === 'sleepHours') return shortSleepDeloadNote(reading.sleepHours) ?? undefined;
  const value = reading[rule.metric];
  return value === null ? undefined : nutrientReadingNote(rule.metric, value);
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
