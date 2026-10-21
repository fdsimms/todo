// Makes the exercises a described workout asked to create, at the moment the
// person confirms and never before, so backing out leaves the library as it was.
// Shared by the routine editor's Save and workout mode's "Describe".
import type { WorkoutRoutineItem } from '../types';
import { useWorkoutStore, type ExerciseInput } from '../store/useWorkoutStore';
import { buildCatalog } from './exerciseCatalog';
import { exerciseNameKey } from './workoutData';
import { NEW_EXERCISE_PREFIX } from './workoutCsv';

/**
 * The items with each `new:` exercise made and its real id put in. A name that
 * was taken since the draft was read (made on another device, or by an earlier
 * try at this same save) is that exercise, not a second one. Null when an item
 * names a `new:` exercise the draft has no description for, or one that can be
 * neither made nor found.
 */
export function withCreatedExercises(
  items: WorkoutRoutineItem[],
  newExercises: Readonly<Record<string, ExerciseInput>>,
): WorkoutRoutineItem[] | null {
  const store = useWorkoutStore.getState();
  const made = new Map<string, string>();
  for (const item of items) {
    if (!item.exerciseId.startsWith(NEW_EXERCISE_PREFIX) || made.has(item.exerciseId)) continue;
    const input = newExercises[item.exerciseId.slice(NEW_EXERCISE_PREFIX.length)];
    if (!input) return null;
    const row = store.addExercise(input);
    if (typeof row !== 'string') { made.set(item.exerciseId, row.id); continue; }
    const holder = buildCatalog(useWorkoutStore.getState().exercises)
      .find(e => exerciseNameKey(e.name) === exerciseNameKey(input.name));
    if (!holder) return null;
    made.set(item.exerciseId, holder.id);
  }
  return items.map(i => (made.has(i.exerciseId) ? { ...i, exerciseId: made.get(i.exerciseId)! } : i));
}
