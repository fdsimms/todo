import type { WorkoutSet } from '../types';
import { setLabels, setName } from './workoutSession';

/**
 * What the person wrote on this exercise's sets the last time they did it
 * ("left shoulder hurt, go lighter"), shown on the exercise card so it is read
 * before the first set rather than found by opening last time's workout.
 *
 * **Read from the sets' own notes, never stored again.** `previous` is
 * `previousSets`: the done sets of the newest other session, so a note rides
 * with the session it was written in and stops being shown once a newer
 * session of the exercise exists, without anyone clearing it.
 */
export interface LastTimeNote {
  /** "Set 2", "Warm-up" and so on: the set it was written on. */
  where: string;
  text: string;
}

export interface LastTimeNotes {
  /** When the newest of the sets was done, for "Last time · Oct 12". */
  at: string;
  notes: LastTimeNote[];
}

export function lastTimeNotes(previous: readonly WorkoutSet[]): LastTimeNotes | null {
  const labels = setLabels(previous);
  const notes: LastTimeNote[] = [];
  let at = '';
  for (const s of previous) {
    const text = (s.note ?? '').trim();
    if (!text) continue;
    notes.push({ where: setName(s.kind, labels.get(s.id) ?? ''), text });
    if (s.completedAt && s.completedAt > at) at = s.completedAt;
  }
  return notes.length > 0 ? { at, notes } : null;
}
