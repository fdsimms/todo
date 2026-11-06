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
 * Whether a lift can stand in for another. Weighted and bodyweight reps are the
 * same kind of movement for this (a goblet squat and a bodyweight squat), since a
 * swap resets the carried sets to the new exercise's own last load; every other
 * kind (time, distance, assisted) only matches itself.
 */
export function swapKindsMatch(a: Exercise['kind'], b: Exercise['kind']): boolean {
  if (a === b) return true;
  return (a === 'weight_reps' || a === 'bodyweight_reps') && (b === 'weight_reps' || b === 'bodyweight_reps');
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
  preferredId: string | null = null,
): string[] {
  const catalog = buildCatalog(rows);
  const from = catalog.find(e => e.id === exerciseId);
  if (!from) return [];
  const skip = new Set([exerciseId, ...exceptIds]);
  const ranked = catalog
    .filter(e => !e.archived && !skip.has(e.id) && swapKindsMatch(e.kind, from.kind) && e.equipment !== from.equipment)
    .map(e => ({ e, shared: e.primaryMuscles.filter(m => from.primaryMuscles.includes(m)).length }))
    .filter(x => x.shared > 0)
    .sort((a, b) => b.shared - a.shared
      || Number(b.e.kind === from.kind) - Number(a.e.kind === from.kind)
      || a.e.name.localeCompare(b.e.name))
    .map(x => x.e.id);
  return preferredFirst(ranked, preferredId, catalog.filter(e => !e.archived && !skip.has(e.id)).map(e => e.id));
}

/**
 * Puts the routine's own alternate for an exercise (`WorkoutRoutineItem.alternateId`)
 * ahead of the ranked suggestions. The person chose it, so it needs no shared
 * muscle or matching kind to qualify: it only has to be an exercise the
 * workout can still take (`usable`).
 */
export function preferredFirst(ranked: readonly string[], preferredId: string | null, usable: readonly string[]): string[] {
  if (!preferredId || !usable.includes(preferredId)) return [...ranked];
  return [preferredId, ...ranked.filter(id => id !== preferredId)];
}
