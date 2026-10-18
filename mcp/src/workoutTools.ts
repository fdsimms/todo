/**
 * Workouts, read-only for now (docs/arch/workouts.md, phase 1): the exercise
 * catalog, and the sessions logged with their sets, beside the routines and
 * programs they came from.
 *
 * Two privacy classes in one area. Exercises, routines and programs are plans
 * and reach the server like any other data. Sessions and sets are the health
 * record (`HEALTH_SYNC_TABLES`): the phone sends them only with Include health
 * logs on, so an empty history is not evidence that nobody trained, the same
 * reading the food, mood and medication tools give.
 *
 * Every weight is kilograms, whatever unit the person's phone shows.
 */
import type { ExerciseEquipment, MuscleGroup, WorkoutRoutine, WorkoutSet } from '../../src/types';
import type { Replica } from './replica';
import { resolveRange, type DayRange, type LogRangeInput } from './tools';
import { catalogExercise, exerciseName, searchExercises, type CatalogExercise } from '../../src/utils/exerciseCatalog';

/** How many exercises a list returns unless asked for more. */
export const DEFAULT_EXERCISE_LIMIT = 50;
export const MAX_EXERCISE_LIMIT = 250;

export interface ExerciseRow {
  id: string;
  name: string;
  kind: string;
  equipment: ExerciseEquipment;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles?: MuscleGroup[];
  /** How it's done, from the library. */
  cue?: string;
  /** The person's own notes. */
  notes?: string;
  /** One the person made, rather than a built-in. */
  custom?: true;
  /** A built-in the person renamed or annotated. */
  changedByYou?: true;
  archived?: true;
  /** A bar weight the person set, in kg. */
  barKg?: number;
}

function exerciseRow(e: CatalogExercise): ExerciseRow {
  return {
    id: e.id,
    name: e.name,
    kind: e.kind,
    equipment: e.equipment,
    primaryMuscles: e.primaryMuscles,
    ...(e.secondaryMuscles.length ? { secondaryMuscles: e.secondaryMuscles } : {}),
    ...(e.cue ? { cue: e.cue } : {}),
    ...(e.notes ? { notes: e.notes } : {}),
    ...(!e.builtIn ? { custom: true as const } : {}),
    ...(e.overridden ? { changedByYou: true as const } : {}),
    ...(e.archived ? { archived: true as const } : {}),
    ...(e.barKg !== null ? { barKg: e.barKg } : {}),
  };
}

export interface ListExercisesInput {
  query?: string;
  muscle?: MuscleGroup;
  equipment?: ExerciseEquipment;
  includeArchived?: boolean;
  limit?: number;
}

export function listExercises(
  replica: Replica,
  input: ListExercisesInput = {},
): { exercises: ExerciseRow[]; total: number; note?: string } {
  const rows = replica.exercises();
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_EXERCISE_LIMIT, 1), MAX_EXERCISE_LIMIT);
  const found = searchExercises(rows, input.query ?? '', {
    muscle: input.muscle, equipment: input.equipment, includeArchived: input.includeArchived,
  }).map(r => r.exercise);
  return {
    exercises: found.slice(0, limit).map(exerciseRow),
    total: found.length,
    ...(found.length > limit ? { note: `Showing ${limit} of ${found.length}. Narrow with query, muscle or equipment, or raise limit.` } : {}),
  };
}

export interface WorkoutSetRow {
  kind: WorkoutSet['kind'];
  weightKg?: number;
  reps?: number;
  durationSeconds?: number;
  distanceM?: number;
  rpe?: number;
  /** False for a set laid out but not done yet. */
  done: boolean;
  note?: string;
}

export interface WorkoutRow {
  id: string;
  title: string;
  /** `YYYY-MM-DD`, the person's logical day it started on. */
  date: string;
  startedAt: string;
  endedAt?: string;
  inProgress?: true;
  routine?: string;
  program?: string;
  /** How hard it felt, 1 to 10, as the person typed it. */
  effort?: number;
  notes?: string;
  exercises: { exerciseId: string; name: string; sets: WorkoutSetRow[] }[];
}

function setRow(s: WorkoutSet): WorkoutSetRow {
  return {
    kind: s.kind,
    ...(s.weightKg !== null ? { weightKg: s.weightKg } : {}),
    ...(s.reps !== null ? { reps: s.reps } : {}),
    ...(s.durationSeconds !== null ? { durationSeconds: s.durationSeconds } : {}),
    ...(s.distanceM !== null ? { distanceM: s.distanceM } : {}),
    ...(s.rpe !== null ? { rpe: s.rpe } : {}),
    done: s.completedAt !== null,
    ...(s.note ? { note: s.note } : {}),
  };
}

export interface RoutineRow {
  id: string;
  name: string;
  notes?: string;
  program?: string;
  exercises: { exerciseId: string; name: string; supersetKey?: string; restSeconds?: number; targets: WorkoutRoutine['items'][number]['targets'] }[];
}

const WITHHELD_NOTE =
  'No workouts in this range. Workout history is part of the health record: it reaches the server only with Settings › Data & reset › Sync › Include health logs turned on, so this may mean it was never sent. Routines and programs travel either way.';

export function listWorkouts(
  replica: Replica,
  input: LogRangeInput = {},
): { range: DayRange; workouts: WorkoutRow[]; routines: RoutineRow[]; programs: unknown[]; note?: string } {
  const range = resolveRange(replica, input);
  const rows = replica.exercises();
  const routines = replica.workoutRoutines();
  const programs = replica.workoutPrograms();
  const routineName = new Map(routines.map(r => [r.id, r.name]));
  const programName = new Map(programs.map(p => [p.id, p.name]));

  const workouts = replica.workoutSessions(range.from, range.to).map((s): WorkoutRow => {
    const byExercise = new Map<string, WorkoutSet[]>();
    for (const set of replica.workoutSets(s.id)) {
      if (!byExercise.has(set.exerciseId)) byExercise.set(set.exerciseId, []);
      byExercise.get(set.exerciseId)!.push(set);
    }
    return {
      id: s.id,
      title: s.title,
      date: replica.logicalDayKeyOf(s.startedAt),
      startedAt: s.startedAt,
      ...(s.endedAt ? { endedAt: s.endedAt } : { inProgress: true as const }),
      ...(s.routineId && routineName.has(s.routineId) ? { routine: routineName.get(s.routineId)! } : {}),
      ...(s.programId && programName.has(s.programId) ? { program: programName.get(s.programId)! } : {}),
      ...(s.effort !== null ? { effort: s.effort } : {}),
      ...(s.notes ? { notes: s.notes } : {}),
      exercises: [...byExercise.entries()].map(([exerciseId, sets]) => ({
        exerciseId,
        name: exerciseName(rows, exerciseId),
        sets: sets.map(setRow),
      })),
    };
  });

  return {
    range,
    workouts,
    routines: routines.map(r => ({
      id: r.id,
      name: r.name,
      ...(r.notes ? { notes: r.notes } : {}),
      ...(r.programId && programName.has(r.programId) ? { program: programName.get(r.programId)! } : {}),
      exercises: r.items.map(i => ({
        exerciseId: i.exerciseId,
        name: catalogExercise(rows, i.exerciseId)?.name ?? 'Unknown exercise',
        ...(i.supersetKey ? { supersetKey: i.supersetKey } : {}),
        ...(i.restSeconds !== null ? { restSeconds: i.restSeconds } : {}),
        targets: i.targets,
      })),
    })),
    programs: programs.filter(p => !p.archived).map(p => ({
      id: p.id,
      name: p.name,
      ...(p.weeks !== null ? { weeks: p.weeks } : {}),
      scheme: p.scheme,
      rotation: p.rotation.map(id => routineName.get(id) ?? 'A deleted routine'),
      ...(p.trainingMaxes.length ? {
        trainingMaxes: p.trainingMaxes.map(t => ({ exerciseId: t.exerciseId, name: exerciseName(rows, t.exerciseId), kg: t.kg })),
      } : {}),
      ...(p.startedAt ? { startedAt: p.startedAt } : {}),
    })),
    ...(workouts.length === 0 ? { note: WITHHELD_NOTE } : {}),
  };
}
