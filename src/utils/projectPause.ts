import type { Project } from '../types';

/**
 * Whether a project is paused (Project.pausedUntil), and the registry that lets
 * the visibility gates ask without importing the project store.
 *
 * The `awayDates` registry shape, for its reason: `useProjectStore` reaches
 * expo-sqlite, and `visibilityUtils` sits under nearly the whole app, so the
 * store pushes a getter in here at load and this module answers on demand.
 * Resolve-or-shrug: with no source registered nothing is paused, which fails
 * toward showing tasks rather than hiding them.
 */

type PausableProject = Pick<Project, 'id' | 'pausedUntil' | 'archived' | 'completed'>;

/**
 * The `pausedUntil` a project in Planning holds: a pause with no day to lift
 * on, which only "Mark ready" ends. It is a day key no logical today reaches,
 * so every reader that already respects a pause (`isWithheld`, the nudges,
 * pull, the weekend offer) holds a planning project back with no change, and
 * there is no second flag for a new reader to forget.
 *
 * It is deliberately the same state as a pause rather than a column of its own:
 * a separate flag would let a project be paused *and* planning, and every
 * withholding check would have to learn both. Anything that shows the pause to
 * a person asks `isPlanning` first, since "Paused until Dec 31, 9999" is the one
 * reading of this value that must never reach a screen.
 */
export const PLANNING_PAUSE_KEY = '9999-12-31';

/** Whether the project is in Planning: paused with no day to come back on. */
export function isPlanning(project: Pick<Project, 'pausedUntil'>): boolean {
  return project.pausedUntil === PLANNING_PAUSE_KEY;
}

/**
 * Paused on the logical day `todayKey` (`YYYY-MM-DD`): the pause holds through
 * the day before `pausedUntil` and lifts that morning, so "pause until March 1"
 * brings the project back on March 1. Day keys compare as strings.
 */
export function isPausedOn(project: Pick<Project, 'pausedUntil'>, todayKey: string): boolean {
  return project.pausedUntil !== null && todayKey < project.pausedUntil;
}

let source: (() => readonly PausableProject[]) | null = null;
let cache: { projects: readonly PausableProject[]; todayKey: string; paused: Map<string, string> } | null = null;

/** Called once by useProjectStore at module load. Tests can point it at a fixture. */
export function registerPausedProjectSource(fn: (() => readonly PausableProject[]) | null): void {
  source = fn;
  cache = null;
}

/** Paused projects on `todayKey`, each with the day key its pause lifts on. */
function pausedOn(todayKey: string): Map<string, string> {
  const projects = source?.();
  if (!projects) return new Map();
  if (!cache || cache.projects !== projects || cache.todayKey !== todayKey) {
    const paused = new Map<string, string>();
    for (const p of projects) if (isPausedOn(p, todayKey)) paused.set(p.id, p.pausedUntil!);
    cache = { projects, todayKey, paused };
  }
  return cache.paused;
}

/**
 * Whether the project with this id is paused on `todayKey`. Cached against the
 * project list's identity and the day, since every visibility check on every
 * row asks it.
 */
export function isProjectPaused(projectId: string, todayKey: string): boolean {
  return pausedOn(todayKey).has(projectId);
}

/**
 * The day key a paused project comes back on, or null when it isn't paused on
 * `todayKey`. What "when does this task next surface" reads, so a gate armed
 * for a paused task's time waits for the pause to lift.
 */
export function projectPausedUntil(projectId: string, todayKey: string): string | null {
  return pausedOn(todayKey).get(projectId) ?? null;
}

/**
 * The day a pause ended, for each project whose pause has run out by
 * `todayKey`: a dated `pausedUntil` on or before today. Planning never runs
 * out by date, so it's left out. A pause stays stored once it has lifted, which
 * is what lets the streak pass find it at the next launch.
 */
export function pauseEndsOn(projects: readonly Pick<Project, 'id' | 'pausedUntil'>[], todayKey: string): Map<string, string> {
  const ends = new Map<string, string>();
  for (const p of projects) {
    if (p.pausedUntil === null || isPlanning(p) || isPausedOn(p, todayKey)) continue;
    ends.set(p.id, p.pausedUntil);
  }
  return ends;
}

/**
 * The day a pause ends when a project's `pausedUntil` changes from `before` to
 * `after`, or null when no pause ends: there was none, or the project is still
 * paused today. A pause that had already lifted ended on its own day; one cut
 * short (End pause, the editor, Mark ready, an agent) ends today.
 */
export function pauseEndedByChange(before: string | null, after: string | null, todayKey: string): string | null {
  if (before === null || after === before) return null;
  if (after !== null && todayKey < after) return null;
  return before < todayKey ? before : todayKey;
}

/**
 * Who hears that a pause ended, so streaks it held can be forgiven before the
 * day it lifted is lost from `pausedUntil`. Registered rather than imported for
 * this module's reason: the task store can't be reached from the project store
 * without a cycle, and the MCP server can't load the task store at all, so each
 * registers its own. With nobody registered nothing happens.
 */
let pauseEndListener: ((projectId: string, endedOn: string) => void) | null = null;

export function registerPauseEndListener(fn: ((projectId: string, endedOn: string) => void) | null): void {
  pauseEndListener = fn;
}

export function notifyPauseEnded(projectId: string, endedOn: string): void {
  pauseEndListener?.(projectId, endedOn);
}
