import type { Effort } from '../types';
import { activeChainStep, type ChainCarrier } from './chain';

/**
 * Field updates to apply when a task's duration is measured by the stopwatch.
 *
 * **The measurement becomes the estimate, always.** That's the whole point of
 * timing something: next time this task comes round, the number attached to it
 * should be what it actually took rather than what someone once guessed. It
 * used to backfill the estimate only when there wasn't one, on the reasoning
 * that a typed estimate shouldn't be silently overwritten — which sounds
 * careful and means a task you estimated once keeps that guess for ever, no
 * matter how many times you time it. A measurement is better evidence than an
 * estimate by definition; there is nothing to protect it from.
 *
 * `actualMinutes` is kept, and after this it is always equal to the estimate.
 * All it does now is let the expanded task row and the Logbook say "Timed"
 * next to the number, i.e. that it was measured rather than guessed. Nothing
 * shows it as a second number, and nothing compares the two.
 */
export function applyMeasuredTime(minutes: number): {
  actualMinutes: number;
  estimatedMinutes: number;
  effort: Effort;
} {
  const rounded = Math.max(1, Math.round(minutes));
  return {
    actualMinutes: rounded,
    estimatedMinutes: rounded,
    effort: minutesToEffort(rounded),
  };
}

/** Clock-style label for a live timer: `m:ss` under an hour, else `h:mm:ss`. */
export function formatStopwatch(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}

// Canonical minutes per effort bucket. Index = Effort value; 0 = unknown (null).
// These are the times shown on the preset chips and used as the fallback when a
// task has no precise estimate.
export const EFFORT_MINUTES: readonly (number | null)[] = [null, 1, 15, 30, 90, 240, 480];

/** The canonical minute value for an effort bucket (null for "unknown"). */
export function effortToMinutes(e: Effort): number | null {
  return EFFORT_MINUTES[e] ?? null;
}

/**
 * Derive the coarse effort bucket from a precise minute estimate. Thresholds are
 * centered on the canonical values so a preset round-trips to itself. null → 0.
 */
export function minutesToEffort(min: number | null): Effort {
  if (min == null || min <= 0) return 0;
  if (min <= 5) return 1;    // XXS ~1
  if (min <= 20) return 2;   // XS ~15
  if (min <= 45) return 3;   // S ~30
  if (min <= 150) return 4;  // M ~90
  if (min <= 330) return 5;  // L ~240
  return 6;                  // XL ~480+
}

/** What estimatedMinutesFor needs: the task's own estimate, plus its chain position. */
export type EstimateSource = ChainCarrier & {
  estimatedMinutes: number | null;
  effort: Effort;
};

/**
 * What a task is expected to cost *right now* — the single read every workload
 * surface should route through (today's "planned" total, the deload sheet, the
 * snooze engine's day scoring), the way displayTitleFor is the single read for
 * a task's name.
 *
 * Mid-chain it's the active step's own estimate when that step has one. Only
 * one step of a chain is ever on the day at a time, but the task-level estimate
 * covers the whole chain — so charging it per step both overstates the day and,
 * because completing a step spawns the next onto the same day, never lets the
 * total fall as the chain is worked. Falls back to the task's estimate, then
 * its coarse effort bucket; null when nothing is set at all.
 */
export function estimatedMinutesFor(task: EstimateSource): number | null {
  const step = activeChainStep(task);
  if (step?.estimatedMinutes != null) return step.estimatedMinutes;
  return task.estimatedMinutes ?? effortToMinutes(task.effort);
}

/**
 * Total estimated minutes across a set of tasks, falling back to each task's
 * coarse effort bucket when it has no precise estimate. Powers the "how full
 * is today" workload readout.
 */
export function sumEstimatedMinutes(tasks: readonly EstimateSource[]): number {
  return tasks.reduce((sum, t) => sum + (estimatedMinutesFor(t) ?? 0), 0);
}

/** Compact human label for a duration in minutes, e.g. 15m, 45m, 1h, 1.5h, 8h. */
export function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const hours = min / 60;
  // Drop a trailing ".0" (2h, not 2.0h); keep one decimal otherwise (1.5h).
  const label = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${label}h`;
}
