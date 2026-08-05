import type { Effort } from '../types';

/**
 * Field updates to apply when a task's actual duration is measured (via the
 * stopwatch or a manual log). `actualMinutes` is always set. The estimate/effort
 * bucket is only backfilled when the task has no estimate of its own — so a
 * timed task with no typed estimate still powers effort-based sort and AI
 * scheduling, but a typed estimate is never silently overwritten by a
 * measurement. (The consumers that read estimatedMinutes already fall back to
 * actualMinutes-derived data at read time where it matters.)
 */
export function applyMeasuredTime(minutes: number, existingEstimatedMinutes: number | null): {
  actualMinutes: number;
  estimatedMinutes?: number;
  effort?: Effort;
} {
  const rounded = Math.max(1, Math.round(minutes));
  if (existingEstimatedMinutes != null) {
    return { actualMinutes: rounded };
  }
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

/**
 * Total estimated minutes across a set of tasks, falling back to each task's
 * coarse effort bucket when it has no precise estimate. Powers the "how full
 * is today" workload readout.
 */
export function sumEstimatedMinutes(tasks: readonly { estimatedMinutes: number | null; effort: Effort }[]): number {
  return tasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? effortToMinutes(t.effort) ?? 0), 0);
}

/** Compact human label for a duration in minutes, e.g. 15m, 45m, 1h, 1.5h, 8h. */
export function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const hours = min / 60;
  // Drop a trailing ".0" (2h, not 2.0h); keep one decimal otherwise (1.5h).
  const label = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
  return `${label}h`;
}
