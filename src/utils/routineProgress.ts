import type { ExerciseKind, WorkoutSession, WorkoutSet } from '../types';
import type { WeightUnit } from './weightLog';
import { kgToUnit } from './weightLog';
import { analyzeExercise, liftVolumeKg, recordSessions, type SessionPoint } from './workoutRecords';
import { metricNumber } from './workoutRecordText';

/**
 * How a routine has gone over time: the workouts done from it, their lifted
 * volume, and each of its exercises' best set. Pure and store-free, like
 * `workoutRecords.ts`, which does the per-exercise arithmetic (see
 * docs/arch/workouts.md, "A routine's progress").
 *
 * **Derived from the sessions, never stored**, and from the routine's own
 * sessions only (`WorkoutSession.routineId`): an exercise's figures here are how
 * it went *in this routine*, not on the exercise's own page, which reads every
 * workout. A "record" on a row therefore means a heavier best set than any
 * earlier workout of this routine, which is the question the row answers.
 *
 * **The rows are the routine's exercises as it stands now**, in its order. An
 * exercise taken out of the routine drops off, and one added after some
 * workouts starts at its first workout with it.
 *
 * Nothing here judges: a lighter latest figure is a negative change, shown
 * plainly, and no figure is scored or ranked against another.
 */

export interface RoutineWorkoutPoint {
  sessionId: string;
  dayKey: string;
  /** Lifted volume in kilograms. Only workouts that had some are listed. */
  volumeKg: number;
}

export interface RoutineExerciseProgress {
  exerciseId: string;
  kind: ExerciseKind;
  /** Workouts of this routine that did the exercise. */
  workouts: number;
  /** The best set of each, oldest first, as a number in the unit shown (see `metricNumber`). */
  plot: { dayKey: string; value: number }[];
  /** The best set of the first and the latest workout. Null when nothing was done. */
  first: NonNullable<SessionPoint['best']> | null;
  latest: NonNullable<SessionPoint['best']> | null;
  firstDayKey: string | null;
  /** Latest minus first, in the unit shown. Null with fewer than two workouts. */
  change: number | null;
  /** The latest workout's best set beat every earlier one in this routine. */
  latestIsRecord: boolean;
}

export interface RoutineProgress {
  /** Finished workouts started from the routine. */
  workouts: number;
  firstDayKey: string | null;
  volume: RoutineWorkoutPoint[];
  /** Whole percent from the first workout's volume to the latest. Null with fewer than two, or a first of zero. */
  volumeChangePercent: number | null;
  exercises: RoutineExerciseProgress[];
}

/** The finished workouts started from a routine, oldest first. A live one is not progress yet. */
export function routineSessions(routineId: string, sessions: readonly WorkoutSession[]): WorkoutSession[] {
  return sessions
    .filter(s => s.routineId === routineId && s.endedAt !== null)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
}

export interface RoutineProgressInput {
  /** The routine's exercises in order, repeats allowed (an exercise twice in a routine is one row). */
  exerciseIds: readonly string[];
  /** The routine's own finished sessions, from `routineSessions`. */
  sessions: readonly WorkoutSession[];
  /** Every set of those sessions, by session id. */
  setsBySession: ReadonlyMap<string, readonly WorkoutSet[]>;
  kindOf: (exerciseId: string) => ExerciseKind;
  unit: WeightUnit;
  dayResetTime: string;
  /**
   * What an exercise's stored one-dumbbell weights are multiplied by to be read, 2 for a pair
   * total (`dumbbellLoad.ts`). Every weight here, volume included, is in those terms, so a
   * routine mixing exercises logged each way still adds like with like.
   */
  scaleOf?: (exerciseId: string) => number;
}

export function routineProgress({ exerciseIds, sessions, setsBySession, kindOf, unit, dayResetTime, scaleOf = () => 1 }: RoutineProgressInput): RoutineProgress {
  const recSessions = recordSessions(sessions, dayResetTime);
  const dayOf = new Map(recSessions.map(s => [s.id, s.dayKey]));

  const volume: RoutineWorkoutPoint[] = [];
  for (const s of recSessions) {
    const kg = liftVolumeKg((setsBySession.get(s.id) ?? []).map(x => (x.weightKg === null ? x : { ...x, weightKg: x.weightKg * scaleOf(x.exerciseId) })), kindOf);
    if (kg !== null && kg > 0) volume.push({ sessionId: s.id, dayKey: s.dayKey, volumeKg: kg });
  }
  const volumeChangePercent = volume.length >= 2 && volume[0].volumeKg > 0
    ? Math.round(((volume[volume.length - 1].volumeKg - volume[0].volumeKg) / volume[0].volumeKg) * 100)
    : null;

  const allSets: WorkoutSet[] = [];
  for (const s of sessions) allSets.push(...(setsBySession.get(s.id) ?? []));

  const seen = new Set<string>();
  const exercises: RoutineExerciseProgress[] = [];
  for (const exerciseId of exerciseIds) {
    if (seen.has(exerciseId)) continue;
    seen.add(exerciseId);
    const kind = kindOf(exerciseId);
    const analysis = analyzeExercise(exerciseId, kind, allSets.filter(s => s.exerciseId === exerciseId), recSessions);
    const points = analysis.points.filter(p => p.best !== null && dayOf.has(p.sessionId));
    const plot: RoutineExerciseProgress['plot'] = [];
    for (const p of points) {
      const value = metricNumber(p, 'best', kind, unit, scaleOf(exerciseId));
      if (value !== null) plot.push({ dayKey: p.dayKey, value });
    }
    const first = points.length > 0 ? points[0].best : null;
    const latest = points.length > 0 ? points[points.length - 1].best : null;
    const latestValue = plot.length > 0 ? plot[plot.length - 1].value : null;
    const earlierBest = plot.length > 1 ? Math.max(...plot.slice(0, -1).map(p => p.value)) : null;
    exercises.push({
      exerciseId,
      kind,
      workouts: points.length,
      plot,
      first,
      latest,
      firstDayKey: points.length > 0 ? points[0].dayKey : null,
      change: plot.length >= 2 ? plot[plot.length - 1].value - plot[0].value : null,
      latestIsRecord: latestValue !== null && earlierBest !== null && latestValue > earlierBest,
    });
  }

  return {
    workouts: sessions.length,
    firstDayKey: recSessions.length > 0 ? recSessions[0].dayKey : null,
    volume,
    volumeChangePercent,
    exercises,
  };
}

/** A volume in kilograms as a number in the unit shown, for a chart axis. */
export function volumeForChart(kg: number, unit: WeightUnit): number {
  return Math.round(kgToUnit(kg, unit));
}
