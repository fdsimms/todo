/**
 * A record of how long the app's own launch work takes, kept on the device.
 *
 * Nothing here leaves the phone: no network, no account. The entries are what
 * `runStartupStep` already names (each launch step and background pass), plus a
 * few marks, so "which step got slow" is answered from the same names the
 * crash log uses. This module has no database access on purpose, so
 * `startup.ts` can import it without pulling the database in; saving a run is
 * `perfReport.ts`.
 */

export interface PerfEntry {
  name: string;
  /** Milliseconds the step took, or for a mark, milliseconds since the app started. */
  ms: number;
  mark?: true;
  /**
   * Where a step's time went, for a step that records its own parts
   * (`timedPart`): its slowest PERF_PART_LIMIT parts, then the rest summed.
   * Carried on the step's one entry rather than as entries of their own, so a
   * step with forty parts doesn't push the run past PERF_ENTRY_LIMIT and drop
   * the steps after it.
   */
  parts?: PerfEntry[];
}

export type PerfRunKind = 'launch' | 'background';

export interface PerfRun {
  /** ISO time the run was saved. */
  at: string;
  kind: PerfRunKind;
  entries: PerfEntry[];
}

/** Most runs kept, newest last. Small on purpose: this is a diagnostic, not a history. */
export const PERF_RUN_LIMIT = 5;

/** Most entries kept per run, so a runaway caller can't grow the saved value. */
export const PERF_ENTRY_LIMIT = 80;

/** Most parts kept on one step before the rest are summed into one line. */
export const PERF_PART_LIMIT = 10;

let current: PerfEntry[] = [];
/** Parts recorded since the last step finished; the next step to finish takes them. */
let pendingParts: PerfEntry[] = [];
/**
 * How many `timed` steps are running. A part is only recorded inside one, so
 * the same work run outside a launch step (a demo swap reloading every store)
 * can't hand its parts to whichever unrelated step finishes next.
 */
let openSteps = 0;

/** Milliseconds from the engine's clock, which starts with the app. Falls back to wall time where there is none. */
export function perfNow(): number {
  const p = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof p?.now === 'function' ? p.now() : Date.now();
}

const roundMs = (ms: number) => Math.round(ms * 10) / 10;

/**
 * A step's parts, slowest first: the slowest PERF_PART_LIMIT as they are, and
 * everything else as one "N others" line, so the total still adds up.
 */
export function summarizeParts(parts: readonly PerfEntry[]): PerfEntry[] {
  const sorted = [...parts].sort((a, b) => b.ms - a.ms);
  if (sorted.length <= PERF_PART_LIMIT + 1) return sorted;
  const kept = sorted.slice(0, PERF_PART_LIMIT);
  const rest = sorted.slice(PERF_PART_LIMIT);
  return [...kept, { name: `${rest.length} others`, ms: roundMs(rest.reduce((sum, e) => sum + e.ms, 0)) }];
}

/** Records one finished step, with any parts recorded while it ran. */
export function recordTiming(name: string, ms: number): void {
  const parts = pendingParts;
  pendingParts = [];
  if (current.length >= PERF_ENTRY_LIMIT) return;
  current.push(parts.length > 0
    ? { name, ms: roundMs(ms), parts: summarizeParts(parts) }
    : { name, ms: roundMs(ms) });
}

/**
 * Runs one part of a larger step and records how long it took, to be attached
 * to that step's entry when it finishes (see PerfEntry.parts). For a step whose
 * time is worth breaking down, such as the store fan-out in
 * `useTaskStore.initialize`.
 */
export function timedPart<T>(name: string, fn: () => T): T {
  if (openSteps === 0) return fn();
  const start = perfNow();
  try {
    return fn();
  } finally {
    pendingParts.push({ name, ms: roundMs(perfNow() - start) });
  }
}

/** Records a moment rather than a duration: how long after the app started it was reached. */
export function markMilestone(name: string): void {
  if (current.length >= PERF_ENTRY_LIMIT) return;
  current.push({ name, ms: Math.round(perfNow()), mark: true });
}

/** Runs `fn` and records how long it took, whether or not it throws. */
export function timed<T>(name: string, fn: () => T): T {
  const start = perfNow();
  openSteps += 1;
  try {
    return fn();
  } finally {
    openSteps -= 1;
    recordTiming(name, perfNow() - start);
  }
}

/** The entries recorded since the last run was saved. */
export function currentEntries(): readonly PerfEntry[] {
  return current;
}

/** Hands back the recorded entries and starts over. */
export function takeEntries(): PerfEntry[] {
  const taken = current;
  current = [];
  return taken;
}

/** Test seam: forgets everything recorded. */
export function resetPerfLog(): void {
  current = [];
  pendingParts = [];
  openSteps = 0;
}

/** `runs` with `run` added, keeping only the newest PERF_RUN_LIMIT. */
export function appendRun(runs: readonly PerfRun[], run: PerfRun): PerfRun[] {
  return [...runs, run].slice(-PERF_RUN_LIMIT);
}

/** Reads a saved value back. Anything that isn't a list of runs is treated as no history. */
export function parseRuns(raw: string | null): PerfRun[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is PerfRun =>
        !!r && typeof r.at === 'string' && Array.isArray(r.entries) &&
        (r.kind === 'launch' || r.kind === 'background')
    );
  } catch {
    return [];
  }
}

function lineFor(e: PerfEntry): string {
  const line = e.mark ? `  ${e.name}: at ${e.ms} ms` : `  ${e.name}: ${e.ms} ms`;
  if (!e.parts || e.parts.length === 0) return line;
  return [line, ...e.parts.map(p => `      ${p.name}: ${p.ms} ms`)].join('\n');
}

function totalOf(entries: readonly PerfEntry[]): number {
  return Math.round(entries.reduce((sum, e) => sum + (e.mark ? 0 : e.ms), 0));
}

/**
 * The text a person copies out of Settings. Newest run first. A run lists its
 * steps in the order they ran, then its total, so a slow one stands out against
 * the same step in the other runs.
 */
export function formatPerfReport(
  runs: readonly PerfRun[],
  session: readonly PerfEntry[],
  now: Date = new Date()
): string {
  const lines = [`Performance log, ${now.toISOString()}`, 'Times are in milliseconds.'];
  if (session.length > 0) {
    lines.push('', 'Since the last saved run:');
    for (const e of session) lines.push(lineFor(e));
  }
  if (runs.length === 0) {
    lines.push('', 'No saved runs yet.');
    return lines.join('\n');
  }
  for (const run of [...runs].reverse()) {
    lines.push('', `${run.kind === 'launch' ? 'Launch' : 'Background run'}, ${run.at}`);
    for (const e of run.entries) lines.push(lineFor(e));
    lines.push(`  Total of steps: ${totalOf(run.entries)} ms`);
  }
  return lines.join('\n');
}
