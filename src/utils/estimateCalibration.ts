import type { Task } from '../types';

/**
 * How somebody's estimates compare to their own clock (#2681).
 *
 * `applyMeasuredTime` makes a measurement the estimate, which is right per task
 * and destroys the comparison at the moment it is made. `estimateBeforeTiming`
 * keeps the guess that stood; this reads those pairs back.
 *
 * **It is said about a pace, never about a person.** The same rule
 * `weightGoal.ts` follows: a ratio here is "things you time take about a third
 * longer than you expect", not a verdict on estimating. Nothing derived here
 * reaches a streak, a penalty or a suggestion about whether somebody is doing
 * well, and the one place it is *used* only fills a gap where there was no
 * estimate at all.
 *
 * **The median, not the mean.** One task left running over lunch is a 400%
 * ratio, and a mean would carry it into every day's workload for good. The
 * median ignores it, which is what a single mis-stopped stopwatch deserves.
 *
 * **Nothing is claimed below `MIN_CALIBRATION_SAMPLES`.** Two pairs is an
 * anecdote, and a workload quietly scaled by an anecdote is worse than one
 * scaled by nothing. `null` is the answer until there are enough, and every
 * reader treats null as "carry on as before".
 */

/** Pairs needed before a ratio is reported at all. */
export const MIN_CALIBRATION_SAMPLES = 5;

/**
 * Ratios outside this are dropped before the median, not clamped after it: a
 * task timed for eight seconds against a 30 minute estimate, or one left
 * running overnight, is a broken reading rather than a fast or slow one.
 */
export const MIN_SANE_RATIO = 0.1;
export const MAX_SANE_RATIO = 10;

export interface EstimateCalibration {
  /** Measured over estimated. Above 1 means things take longer than expected. */
  ratio: number;
  /** How many timed tasks the ratio is drawn from. */
  samples: number;
}

/** The usable (estimate, measurement) pairs on a set of tasks. */
export function calibrationPairs(
  tasks: readonly Task[],
): { estimated: number; actual: number }[] {
  const pairs: { estimated: number; actual: number }[] = [];
  for (const task of tasks) {
    const estimated = task.estimateBeforeTiming;
    const actual = task.actualMinutes;
    if (estimated === null || actual === null) continue;
    if (estimated <= 0 || actual <= 0) continue;
    const ratio = actual / estimated;
    if (ratio < MIN_SANE_RATIO || ratio > MAX_SANE_RATIO) continue;
    pairs.push({ estimated, actual });
  }
  return pairs;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** The ratio, or null while there isn't enough to say anything with. */
export function calibrationFrom(tasks: readonly Task[]): EstimateCalibration | null {
  const pairs = calibrationPairs(tasks);
  if (pairs.length < MIN_CALIBRATION_SAMPLES) return null;
  return {
    ratio: median(pairs.map(p => p.actual / p.estimated)),
    samples: pairs.length,
  };
}

/**
 * What to assume a task takes when it carries no estimate at all.
 *
 * This is the one place the calibration changes a number the app acts on, and
 * it is deliberately the gap rather than the estimate: a task whose minutes
 * somebody typed keeps them exactly. `base` is returned untouched when there
 * is no calibration, so an install with nothing timed behaves as it always did.
 */
export function calibratedAssumedMinutes(
  base: number,
  calibration: EstimateCalibration | null,
): number {
  if (!calibration) return base;
  return Math.max(1, Math.round(base * calibration.ratio));
}

/**
 * One line for the Stats screen, phrased about the work rather than the person.
 *
 * Returns null below the sample floor, so a caller renders nothing rather than
 * a hedge about not knowing yet.
 */
export function describeCalibration(calibration: EstimateCalibration | null): string | null {
  if (!calibration) return null;
  const percent = Math.round(Math.abs(calibration.ratio - 1) * 100);
  const noun = calibration.samples === 1 ? 'task' : 'tasks';
  if (percent < 10) {
    return `Timed work lands close to its estimate, across ${calibration.samples} ${noun}.`;
  }
  return calibration.ratio > 1
    ? `Timed work takes about ${percent}% longer than estimated, across ${calibration.samples} ${noun}.`
    : `Timed work takes about ${percent}% less than estimated, across ${calibration.samples} ${noun}.`;
}

