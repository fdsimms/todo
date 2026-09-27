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
 * Paused on the logical day `todayKey` (`YYYY-MM-DD`): the pause holds through
 * the day before `pausedUntil` and lifts that morning, so "pause until March 1"
 * brings the project back on March 1. Day keys compare as strings.
 */
export function isPausedOn(project: Pick<Project, 'pausedUntil'>, todayKey: string): boolean {
  return project.pausedUntil !== null && todayKey < project.pausedUntil;
}

let source: (() => readonly PausableProject[]) | null = null;
let cache: { projects: readonly PausableProject[]; todayKey: string; paused: Set<string> } | null = null;

/** Called once by useProjectStore at module load. Tests can point it at a fixture. */
export function registerPausedProjectSource(fn: (() => readonly PausableProject[]) | null): void {
  source = fn;
  cache = null;
}

/**
 * Whether the project with this id is paused on `todayKey`. Cached against the
 * project list's identity and the day, since every visibility check on every
 * row asks it.
 */
export function isProjectPaused(projectId: string, todayKey: string): boolean {
  const projects = source?.();
  if (!projects) return false;
  if (!cache || cache.projects !== projects || cache.todayKey !== todayKey) {
    const paused = new Set<string>();
    for (const p of projects) if (isPausedOn(p, todayKey)) paused.add(p.id);
    cache = { projects, todayKey, paused };
  }
  return cache.paused.has(projectId);
}
