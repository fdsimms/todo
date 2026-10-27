import type { WorkoutRoutine, WorkoutSet } from '../types';
import { useWorkoutStore, type SetPatch } from '../store/useWorkoutStore';
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
 * "After set 2 of Barbell bench press". A warm-up, a drop set and a set to
 * failure say so, since they carry no number.
 */
export function restLabelFor(set: Pick<WorkoutSet, 'kind'>, label: string | undefined, exerciseNameText: string): string {
  if (set.kind === 'warmup') return `After a warm-up set of ${exerciseNameText}`;
  if (set.kind === 'drop') return `After a drop set of ${exerciseNameText}`;
  if (set.kind === 'amrap') return `After a set to failure of ${exerciseNameText}`;
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
    /** Rests set on exercises in this workout, which outrank the routine's. */
    restOverrides?: Readonly<Record<string, number>> | null;
  },
): TickOutcome | null {
  const next = afterLog(sets, setId);
  const set = sets.find(s => s.id === setId);
  if (!next || !set) return null;
  if (!next.rest) return { ...next, restPlan: { kind: 'keep' } };
  const seconds = restSecondsFor(ctx.routine, set.exerciseId, ctx.defaultRestSeconds, ctx.restOverrides);
  if (seconds <= 0) return { ...next, restPlan: { kind: 'clear' } };
  const exercise = sessionExercises(sets).find(e => e.exerciseId === set.exerciseId);
  const label = exercise ? setLabels(exercise.sets).get(set.id) : undefined;
  return { ...next, restPlan: { kind: 'start', seconds, label: restLabelFor(set, label, ctx.exerciseName) } };
}

/** The numbers a tick writes with it (the Apple Watch's), in kilograms. Absent ones are left as they are. */
export type TickValues = Pick<SetPatch, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'>;

/**
 * Ticks a set of the live session off at `now`, and starts (or drops) the rest
 * it leads to. Returns where workout mode's card goes next, or null when
 * nothing was ticked: not the live session, a set it doesn't hold, a set
 * already done, or the store refusing the write.
 *
 * Three callers: workout mode's check, the Lock Screen's Done set, and a set
 * done on the Apple Watch (`processQuietWidgetTaps`). The watch's tick carries
 * the numbers it was done at (`values`, written in the same write as the tick)
 * and the moment it was done, which can be a while before it is applied: the
 * rest starts from that moment, and a rest that would already be over by now
 * isn't started at all (the older one is dropped, as for an exercise that asks
 * for none), since a phone ringing for a rest the lifter finished on the watch
 * minutes ago is a rest about nothing.
 */
export function tickSet(sessionId: string, setId: string, now: Date = new Date(), values: TickValues = {}): AfterLog | null {
  const store = useWorkoutStore.getState();
  const session = store.sessions.find(s => s.id === sessionId);
  if (!session || session.endedAt !== null) return null;
  const before = store.setsBySession[sessionId] ?? store.loadSets(sessionId);
  const set = before.find(s => s.id === setId);
  if (!set || set.completedAt !== null) return null;
  const done = store.editSet(sessionId, setId, { ...values, completedAt: now.toISOString() });
  if (typeof done === 'string') return null;
  const workouts = useWorkoutStore.getState();
  const routine = session.routineId ? workouts.routines.find(r => r.id === session.routineId) ?? null : null;
  const outcome = tickOutcome(workouts.setsBySession[sessionId] ?? [], setId, {
    routine,
    defaultRestSeconds: useSettingsStore.getState().defaultRestSeconds,
    exerciseName: catalogExercise(workouts.exercises, set.exerciseId)?.name ?? 'this exercise',
    restOverrides: session.restOverrides,
  });
  if (!outcome) return null;
  const timers = useStepTimerStore.getState();
  const restOverAlready = outcome.restPlan.kind === 'start' && now.getTime() + outcome.restPlan.seconds * 1000 <= Date.now();
  if (outcome.restPlan.kind === 'start' && !restOverAlready) {
    timers.startRest({
      sessionId,
      exerciseId: set.exerciseId,
      sessionTitle: session.title,
      label: outcome.restPlan.label,
      durationSeconds: outcome.restPlan.seconds,
      startedAt: now.toISOString(),
    });
  } else if (outcome.restPlan.kind === 'clear' || restOverAlready) {
    // No rest after this exercise: the last one's would otherwise keep running
    // in the footer, about a set that is no longer the latest.
    timers.removeRestsOutside(null);
  }
  return { showExerciseId: outcome.showExerciseId, rest: outcome.rest };
}
