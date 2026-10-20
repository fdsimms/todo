import type { WorkoutSet } from '../types';

const bySetOrder = (a: WorkoutSet, b: WorkoutSet) => a.position - b.position || a.setIndex - b.setIndex;

/**
 * The note about how an exercise went in one workout ("left shoulder tight,
 * stopped at 100"), as workout mode's card shows and writes it.
 *
 * **One note per exercise per workout, stored on the exercise's first set.**
 * A session has no row for an exercise, only for its sets, and a set's `note`
 * is already a column that syncs, exports and reaches the MCP and the watch,
 * so this adds no storage (the rule in `docs/arch/workouts.md`). Reading joins
 * every set's note, so one written on a set by the watch or an older version
 * still shows; writing puts the text on the first set and clears the rest, so
 * an edit folds those into the one note.
 */
export function exerciseDayNote(sets: readonly WorkoutSet[]): string {
  return [...sets]
    .sort(bySetOrder)
    .map(s => (s.note ?? '').trim())
    .filter(Boolean)
    .join('\n');
}

/** The sets whose `note` has to change for the exercise's note to read as `text`. */
export function exerciseDayNotePatches(
  sets: readonly WorkoutSet[],
  text: string,
): Array<{ setId: string; note: string | null }> {
  const ordered = [...sets].sort(bySetOrder);
  const wanted = text.trim() || null;
  const patches: Array<{ setId: string; note: string | null }> = [];
  ordered.forEach((s, i) => {
    const target = i === 0 ? wanted : null;
    if ((s.note?.trim() || null) !== target) patches.push({ setId: s.id, note: target });
  });
  return patches;
}
