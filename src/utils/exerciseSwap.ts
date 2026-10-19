import type { Exercise, WorkoutSet } from '../types';
import { buildCatalog } from './exerciseCatalog';

/**
 * Swapping one exercise for another in a live workout ("the bench is taken").
 *
 * A swap moves only the sets not yet done: a set already ticked is a record of
 * what happened under the original exercise, and re-pointing it would put a
 * lift in the wrong exercise's history and records. The routine is untouched
 * here; whether the swap becomes permanent is the person's call at the end
 * (`routineUpdate.ts`).
 */

/** The unticked sets of `exerciseId`, which a swap moves; empty when there is nothing left to move. */
export function swappableSets(sets: readonly WorkoutSet[], exerciseId: string): WorkoutSet[] {
  return sets.filter(s => s.exerciseId === exerciseId && s.completedAt === null);
}

/**
 * Exercises worth offering in place of `exerciseId`, best first: the same kind
 * of movement, sharing a primary muscle, on different equipment (the reason
 * to swap is usually that the equipment is taken). Ties go to the most shared
 * muscles, then the name. Archived exercises and anything in `exceptIds` (what
 * the workout already has) are left out.
 */
export function swapCandidates(
  rows: readonly Exercise[],
  exerciseId: string,
  exceptIds: readonly string[] = [],
): string[] {
  const catalog = buildCatalog(rows);
  const from = catalog.find(e => e.id === exerciseId);
  if (!from) return [];
  const skip = new Set([exerciseId, ...exceptIds]);
  return catalog
    .filter(e => !e.archived && !skip.has(e.id) && e.kind === from.kind && e.equipment !== from.equipment)
    .map(e => ({ e, shared: e.primaryMuscles.filter(m => from.primaryMuscles.includes(m)).length }))
    .filter(x => x.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.e.name.localeCompare(b.e.name))
    .map(x => x.e.id);
}
