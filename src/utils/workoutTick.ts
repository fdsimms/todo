import type { WorkoutRoutine, WorkoutSet } from '../types';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useStepTimerStore } from '../store/useStepTimerStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { catalogExercise } from './exerciseCatalog';
import { afterLog, restSecondsFor, sessionExercises, setLabels, type AfterLog } from './workoutSession';

/**
 * Ticking a set off: the one thing that moves a live workout on. Workout
 * mode's check and the Lock Screen's "Done set" (`dundundun://workout?do=set-done`)
 * both come through `tickSet`, so the two can't come to disagree about what a
 * tick starts or stops.
 *
 * `tickOutcome` is the rule and is pure; `tickSet` writes it.
 */

/** What ticking a set does to the rest. */
export type TickRest =
  /** Start this rest, replacing any rest already going. */
  | { kind: 'start'; seconds: number; label: string }
  /** The exercise asks for no rest: drop the last one, which is about an older set. */
  | { kind: 'clear' }
  /** Mid superset round: no rest, and the one going (if any) stays. */
  | { kind: 'keep' };

export interface TickOutcome extends AfterLog {
  restPlan: TickRest;
}

/**
 * The rest after a set, in the words the footer and the Lock Screen show:
 * "After set 2 of Barbell bench press". A warm-up and a drop set say so, since
 * they carry no number.
 */
export function restLabelFor(set: Pick<WorkoutSet, 'kind'>, label: string | undefined, exerciseNameText: string): string {
  if (set.kind === 'warmup') return `After a warm-up set of ${exerciseNameText}`;
  if (set.kind === 'drop') return `After a drop set of ${exerciseNameText}`;
  return `After set ${label} of ${exerciseNameText}`;
}

/**
 * What a tick of `setId` leads to, read from the session's sets *after* the
 * tick was written: where workout mode's card goes (`afterLog`), and whether a
 * rest starts, how long (the routine item's own rest, else the default) and
 * what it is called. Null for a set the sets don't hold.
 */
export function tickOutcome(
  sets: readonly WorkoutSet[],
  setId: string,
  ctx: {
    routine: Pick<WorkoutRoutine, 'items'> | null;
    defaultRestSeconds: number;
    exerciseName: string;
  },
): TickOutcome | null {
  const next = afterLog(sets, setId);
  const set = sets.find(s => s.id === setId);
  if (!next || !set) return null;
  if (!next.rest) return { ...next, restPlan: { kind: 'keep' } };
  const seconds = restSecondsFor(ctx.routine, set.exerciseId, ctx.defaultRestSeconds);
  if (seconds <= 0) return { ...next, restPlan: { kind: 'clear' } };
  const exercise = sessionExercises(sets).find(e => e.exerciseId === set.exerciseId);
  const label = exercise ? setLabels(exercise.sets).get(set.id) : undefined;
  return { ...next, restPlan: { kind: 'start', seconds, label: restLabelFor(set, label, ctx.exerciseName) } };
}

/**
 * Ticks a set of the live session off now, and starts (or drops) the rest it
 * leads to. Returns where workout mode's card goes next, or null when nothing
 * was ticked: not the live session, a set it doesn't hold, a set already done,
 * or the store refusing the write.
 */
export function tickSet(sessionId: string, setId: string, now: Date = new Date()): AfterLog | null {
  const store = useWorkoutStore.getState();
  const session = store.sessions.find(s => s.id === sessionId);
  if (!session || session.endedAt !== null) return null;
  const before = store.setsBySession[sessionId] ?? store.loadSets(sessionId);
  const set = before.find(s => s.id === setId);
  if (!set || set.completedAt !== null) return null;
  const done = store.editSet(sessionId, setId, { completedAt: now.toISOString() });
  if (typeof done === 'string') return null;
  const workouts = useWorkoutStore.getState();
  const routine = session.routineId ? workouts.routines.find(r => r.id === session.routineId) ?? null : null;
  const outcome = tickOutcome(workouts.setsBySession[sessionId] ?? [], setId, {
    routine,
    defaultRestSeconds: useSettingsStore.getState().defaultRestSeconds,
    exerciseName: catalogExercise(workouts.exercises, set.exerciseId)?.name ?? 'this exercise',
  });
  if (!outcome) return null;
  const timers = useStepTimerStore.getState();
  if (outcome.restPlan.kind === 'start') {
    timers.startRest({
      sessionId,
      exerciseId: set.exerciseId,
      sessionTitle: session.title,
      label: outcome.restPlan.label,
      durationSeconds: outcome.restPlan.seconds,
    });
  } else if (outcome.restPlan.kind === 'clear') {
    // No rest after this exercise: the last one's would otherwise keep running
    // in the footer, about a set that is no longer the latest.
    timers.removeRestsOutside(null);
  }
  return { showExerciseId: outcome.showExerciseId, rest: outcome.rest };
}
