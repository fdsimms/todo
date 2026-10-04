/**
 * Sleep: when it started and ended, how long it was, and what may honestly be
 * said about a run of nights.
 *
 * Everything here is arithmetic over samples Apple Health already holds, for
 * the reason `weightLog.ts` gives: HealthKit is the record, and this module
 * keeps no state and writes nothing. The native side
 * (`readSleepSeries` in `todo-health-bridge`) hands back raw episodes (one
 * unbroken stretch of sleep as one app recorded it), and every rule about
 * what those episodes *mean* lives here, where it can be tested.
 *
 * **A day's total matches `readDailyHealth`'s `sleepMinutes`, on purpose.**
 * Both file an episode under the logical day it *ends* in, both sum per
 * source, and both keep the largest source rather than adding sources
 * together (a phone and a watch recording one night would otherwise put
 * somebody to sleep twice). So the hours on the Sleep screen and the hours a
 * health rule fired on are the same number. Change one rule and change both.
 *
 * **Nothing here judges a night.** There is no sleep score, no "you should get
 * eight hours" and no healthy range: the only number a night is compared with
 * is a goal the person typed in (`sleepGoalMinutes`), the carve-out
 * `weightGoal.ts` makes for the same reason. And nothing calls a night "last
 * night": a nap counts toward its own day, so what this reads is time asleep
 * recorded against a day.
 */
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';
import { formatHHMM, logicalDayStart } from './clockTime';
import type { HealthDayInput } from './moodInsights';

/** One unbroken stretch of sleep, as one app recorded it. */
export interface SleepEpisode {
  /** The first asleep sample's start. */
  start: Date;
  /** The last asleep sample's end. */
  end: Date;
  /**
   * Time actually asleep between the two, which is less than `end - start`
   * whenever the stretch holds a short wake.
   */
  minutes: number;
  /** Which app recorded it. Only meaningful compared with another episode's. */
  source: number;
  /** Null when the recording app doesn't stage sleep (see `SleepStages`). */
  stages: SleepStages | null;
}

/**
 * Minutes in each sleep stage, as an Apple Watch records them (iOS 16+).
 *
 * `awake` is time marked awake *between* two asleep stretches of the night,
 * never before falling asleep or after the final wake. An iPhone's sleep
 * schedule, and most third-party apps, record only "asleep", so a night from
 * them has no stages at all rather than a night of zeros: absent stays absent
 * here as everywhere in the health layer. Nothing ranks the stages or says
 * how much of one is enough; they are drawn as recorded.
 */
export interface SleepStages {
  core: number;
  deep: number;
  rem: number;
  awake: number;
}

/** Display order, the order Health itself lists them: awake at the top, deep at the bottom. */
export const SLEEP_STAGE_ORDER: readonly (keyof SleepStages)[] = ['awake', 'rem', 'core', 'deep'];

export const SLEEP_STAGE_LABEL: Record<keyof SleepStages, string> = {
  awake: 'Awake',
  rem: 'REM',
  core: 'Core',
  deep: 'Deep',
};

function stageMinutes(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The bridge's wire JSON as episodes, dropping anything malformed.
 *
 * `[]` for every reason there is nothing to read, a refusal included: Health
 * serves a refused read as an empty store, so an empty answer here can't say
 * which it was and must not try (`docs/arch/health-data.md`).
 */
export function parseSleepEpisodes(json: string): SleepEpisode[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: SleepEpisode[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { start, end, minutes, source, core, deep, rem, awake } = entry as Record<string, unknown>;
      if (typeof start !== 'string' || typeof end !== 'string') continue;
      const startAt = new Date(start);
      const endAt = new Date(end);
      if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) continue;
      if (endAt <= startAt) continue;
      if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) continue;
      out.push({
        start: startAt,
        end: endAt,
        minutes,
        source: typeof source === 'number' && Number.isFinite(source) ? source : 0,
        stages: parseStages(core, deep, rem, awake),
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The wire's four stage fields as stages, or null for an unstaged episode.
 * Awake time alone doesn't make an episode staged: a source that marks wakes
 * but not stages still can't say what the sleep was made of.
 */
function parseStages(core: unknown, deep: unknown, rem: unknown, awake: unknown): SleepStages | null {
  const stages = { core: stageMinutes(core), deep: stageMinutes(deep), rem: stageMinutes(rem), awake: stageMinutes(awake) };
  return stages.core + stages.deep + stages.rem > 0 ? stages : null;
}

/** One logical day's sleep. */
export interface SleepNight {
  /** The logical day the sleep ended in. */
  dayKey: string;
  /**
   * Time asleep recorded against the day, naps included: the same figure
   * `HealthDay.sleepHours` holds, in minutes.
   */
  minutes: number;
  /** When the day's main sleep started. */
  asleepAt: Date;
  /** When it ended. */
  wokeAt: Date;
  /** Time asleep in the main stretch alone. Less than `minutes` on a day with a nap. */
  mainMinutes: number;
  /** The main stretch's stages, or null when its source doesn't record them. */
  stages: SleepStages | null;
}

/**
 * Episodes grouped into days, oldest first, one entry per day that has any.
 *
 * Per day, the source with the most sleep wins and the others are ignored
 * entirely (the rule the daily total uses; see the file header). The *main*
 * sleep is that source's longest episode, which is the night for nearly
 * everybody and the nap only on a day with nothing else. A night broken by
 * more than an hour awake is two episodes on the native side, so its main
 * stretch is the longer half, and the start time shown is that half's.
 */
export function sleepNights(episodes: readonly SleepEpisode[], dayResetTime: string): SleepNight[] {
  const byDay = new Map<string, Map<number, SleepEpisode[]>>();
  for (const episode of episodes) {
    const dayKey = format(logicalDayStart(episode.end, dayResetTime), 'yyyy-MM-dd');
    let sources = byDay.get(dayKey);
    if (!sources) byDay.set(dayKey, (sources = new Map()));
    const list = sources.get(episode.source);
    if (list) list.push(episode);
    else sources.set(episode.source, [episode]);
  }

  const nights: SleepNight[] = [];
  for (const [dayKey, sources] of byDay) {
    let best: { total: number; list: SleepEpisode[] } | null = null;
    // Sorted so a tie between two sources always goes the same way.
    for (const source of [...sources.keys()].sort((a, b) => a - b)) {
      const list = sources.get(source)!;
      const total = list.reduce((sum, e) => sum + e.minutes, 0);
      if (!best || total > best.total) best = { total, list };
    }
    if (!best) continue;
    let main = best.list[0];
    for (const episode of best.list) {
      // The longer stretch; on a tie the later one, which is the one the
      // person woke from.
      if (episode.minutes > main.minutes || (episode.minutes === main.minutes && episode.end > main.end)) {
        main = episode;
      }
    }
    nights.push({
      dayKey,
      minutes: best.total,
      asleepAt: main.start,
      wokeAt: main.end,
      mainMinutes: main.minutes,
      stages: main.stages,
    });
  }
  return nights.sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0));
}

/**
 * Nights as the readings `buildMoodDays` takes, so the Sleep screen can line
 * them up against mood and finished tasks without a second Health query. The
 * hours are the day's total, which is the same figure `refreshHistory` would
 * have read (see the file header), so the comparison says what the Mood
 * screen's does. Steps stay null: this screen speaks about sleep only.
 */
export function sleepReadings(nights: readonly SleepNight[]): HealthDayInput[] {
  return nights.map(n => ({ dayKey: n.dayKey, steps: null, sleepHours: n.minutes / 60 }));
}

/** The nights falling in the `days` logical days ending on `todayKey`. */
export function nightsInWindow(nights: readonly SleepNight[], days: number, todayKey: string): SleepNight[] {
  const firstKey = format(addDays(new Date(`${todayKey}T00:00:00`), -(days - 1)), 'yyyy-MM-dd');
  return nights.filter(n => n.dayKey >= firstKey && n.dayKey <= todayKey);
}

function clockMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * The average clock time of a set of instants, in minutes after midnight, or
 * null when there is none to give.
 *
 * A circular mean rather than an arithmetic one, because the clock wraps: the
 * plain average of 11 PM and 1 AM is noon. Each time becomes a point on a
 * circle and the mean is the direction of their sum. When the points are
 * spread so widely that the sum nearly cancels out (somebody on rotating
 * shifts, say), any single time would be a number the nights don't support, so
 * the answer is null rather than a guess. `MIN_CLOCK_CONCENTRATION` is that
 * floor; 0.3 is roughly a spread of four and a half hours either way.
 */
export const MIN_CLOCK_CONCENTRATION = 0.3;

export function averageClockMinutes(dates: readonly Date[]): number | null {
  if (dates.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const date of dates) {
    const angle = (clockMinutes(date) / 1440) * 2 * Math.PI;
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  if (Math.hypot(x, y) / dates.length < MIN_CLOCK_CONCENTRATION) return null;
  let angle = Math.atan2(y, x);
  if (angle < 0) angle += 2 * Math.PI;
  return Math.round((angle / (2 * Math.PI)) * 1440) % 1440;
}

/** Average stage minutes over the nights that have stages, and how many did. */
export interface SleepStageAverage {
  stages: SleepStages;
  nights: number;
}

/**
 * The average main-stretch stages across a window, counting only the nights
 * that were staged, or null when none were. A phone night isn't a night of
 * zero deep sleep, so it can't pull the average down.
 */
export function averageSleepStages(nights: readonly SleepNight[]): SleepStageAverage | null {
  const staged = nights.filter((n): n is SleepNight & { stages: SleepStages } => n.stages !== null);
  if (staged.length === 0) return null;
  const mean = (key: keyof SleepStages) => Math.round(staged.reduce((sum, n) => sum + n.stages[key], 0) / staged.length);
  return {
    stages: { core: mean('core'), deep: mean('deep'), rem: mean('rem'), awake: mean('awake') },
    nights: staged.length,
  };
}

/** What a window of nights adds up to. Null figures mean there was nothing to average. */
export interface SleepSummary {
  /** How many days in the window have any sleep recorded. */
  nights: number;
  averageMinutes: number | null;
  /** Minutes after midnight. */
  averageAsleepAt: number | null;
  /** Minutes after midnight. */
  averageWokeAt: number | null;
  /** Days at or over the goal, or null with no goal set. */
  atGoal: number | null;
}

export function sleepSummary(nights: readonly SleepNight[], goalMinutes: number | null): SleepSummary {
  if (nights.length === 0) {
    return { nights: 0, averageMinutes: null, averageAsleepAt: null, averageWokeAt: null, atGoal: goalMinutes === null ? null : 0 };
  }
  return {
    nights: nights.length,
    averageMinutes: Math.round(nights.reduce((sum, n) => sum + n.minutes, 0) / nights.length),
    averageAsleepAt: averageClockMinutes(nights.map(n => n.asleepAt)),
    averageWokeAt: averageClockMinutes(nights.map(n => n.wokeAt)),
    atGoal: goalMinutes === null ? null : nights.filter(n => n.minutes >= goalMinutes).length,
  };
}

/**
 * A night's main stretch on a linear clock axis: minutes after noon on the
 * calendar day before its day key. 11 PM the night before is 660 and 7 AM is
 * 1140, so a night crossing midnight is one unbroken bar. Counted in calendar
 * days plus clock minutes rather than elapsed milliseconds, so a DST night
 * still draws from the times on the clock.
 */
export function minutesOnSleepAxis(date: Date, dayKey: string): number {
  return differenceInCalendarDays(date, new Date(`${dayKey}T00:00:00`)) * 1440 + clockMinutes(date) + 720;
}

export interface SleepPlotBar {
  dayKey: string;
  from: number;
  to: number;
}

export interface SleepPlot {
  /** The axis' top and bottom, on whole hours. */
  domainStart: number;
  domainEnd: number;
  bars: SleepPlotBar[];
}

/**
 * The narrowest axis a chart is drawn on, in minutes. Without it a single
 * night fills the whole plot and the bar's length stops meaning anything.
 */
export const MIN_SLEEP_AXIS_SPAN = 8 * 60;

export function sleepPlot(nights: readonly SleepNight[]): SleepPlot | null {
  if (nights.length === 0) return null;
  const bars = nights.map(n => ({
    dayKey: n.dayKey,
    from: minutesOnSleepAxis(n.asleepAt, n.dayKey),
    to: minutesOnSleepAxis(n.wokeAt, n.dayKey),
  }));
  let domainStart = Math.floor(Math.min(...bars.map(b => b.from)) / 60) * 60;
  let domainEnd = Math.ceil(Math.max(...bars.map(b => b.to)) / 60) * 60;
  if (domainEnd - domainStart < MIN_SLEEP_AXIS_SPAN) {
    // Grown evenly about the middle, still on whole hours.
    const grow = MIN_SLEEP_AXIS_SPAN - (domainEnd - domainStart);
    domainStart -= Math.floor(grow / 120) * 60;
    domainEnd = domainStart + MIN_SLEEP_AXIS_SPAN;
  }
  return { domainStart, domainEnd, bars };
}

/** An axis position back to minutes after midnight. */
export function axisToClockMinutes(axisMinutes: number): number {
  return (((axisMinutes - 720) % 1440) + 1440) % 1440;
}

/** Minutes after midnight as a clock time, honoring the 12/24-hour setting. */
export function formatClockMinutes(minutes: number, use24Hour: boolean): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return formatHHMM(hhmm, use24Hour);
}

/** "7 hr 23 min", "8 hr", "45 min". */
export function formatSleepDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}

/**
 * The bounds a goal stepper moves within, in minutes. An absurdity check, not
 * advice: `RATE_RANGE`'s shape in `weightGoal.ts`, with no warning band inside
 * it.
 */
export const SLEEP_GOAL_RANGE = { min: 4 * 60, max: 12 * 60, step: 30, start: 8 * 60 } as const;

/** The stored setting back to minutes, or null when unset or unreadable. */
export function parseSleepGoal(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (value < SLEEP_GOAL_RANGE.min || value > SLEEP_GOAL_RANGE.max) return null;
  return value;
}
