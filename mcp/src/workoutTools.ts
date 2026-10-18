/**
 * Workouts (docs/arch/workouts.md): the exercise catalog, the sessions logged
 * with their sets beside the routines and programs they came from, and the
 * writes an agent may make. Routines are plans and Claude may build them. A
 * workout is a record of what a body did, so `log_workout` writes only one the
 * person describes, after the fact, and nothing here starts, advances or
 * finishes the session in progress on the phone.
 *
 * Two privacy classes in one area. Exercises, routines and programs are plans
 * and reach the server like any other data. Sessions and sets are the health
 * record (`HEALTH_SYNC_TABLES`): the phone sends them only with Include health
 * logs on, so an empty history is not evidence that nobody trained, the same
 * reading the food, mood and medication tools give.
 *
 * Every weight is kilograms, whatever unit the person's phone shows.
 */
import type {
  Exercise, ExerciseEquipment, MuscleGroup, ProgressionScheme, RoutineSetTarget, WorkoutRoutine, WorkoutRoutineItem,
  WorkoutSession, WorkoutSet, WorkoutSetKind,
} from '../../src/types';
import type { Replica } from './replica';
import { resolveRange, type DayRange, type LogRangeInput } from './tools';
import { atFrom } from './logTools';
import { joinPrevious } from '../../src/utils/workoutRoutine';
import type { SetInput } from '../../src/store/useWorkoutStore';
import { catalogExercise, exerciseName, searchExercises, type CatalogExercise } from '../../src/utils/exerciseCatalog';
import { analyzeExercise, countsForRecords, volumeUnit, type RecordSession, type RecordType } from '../../src/utils/workoutRecords';
import { recordLabel } from '../../src/utils/workoutRecordText';

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

interface RowNames {
  rows: readonly Exercise[];
  routineName: ReadonlyMap<string, string>;
  programName: ReadonlyMap<string, string>;
}

function workoutRow(replica: Replica, s: WorkoutSession, sets: readonly WorkoutSet[], names: RowNames): WorkoutRow {
  const byExercise = new Map<string, WorkoutSet[]>();
  for (const set of sets) {
    if (!byExercise.has(set.exerciseId)) byExercise.set(set.exerciseId, []);
    byExercise.get(set.exerciseId)!.push(set);
  }
  return {
    id: s.id,
    title: s.title,
    date: replica.logicalDayKeyOf(s.startedAt),
    startedAt: s.startedAt,
    ...(s.endedAt ? { endedAt: s.endedAt } : { inProgress: true as const }),
    ...(s.routineId && names.routineName.has(s.routineId) ? { routine: names.routineName.get(s.routineId)! } : {}),
    ...(s.programId && names.programName.has(s.programId) ? { program: names.programName.get(s.programId)! } : {}),
    ...(s.effort !== null ? { effort: s.effort } : {}),
    ...(s.notes ? { notes: s.notes } : {}),
    exercises: [...byExercise.entries()].map(([exerciseId, list]) => ({
      exerciseId,
      name: exerciseName(names.rows, exerciseId),
      sets: list.map(setRow),
    })),
  };
}

function namesOf(replica: Replica): RowNames {
  return {
    rows: replica.exercises(),
    routineName: new Map(replica.workoutRoutines().map(r => [r.id, r.name])),
    programName: new Map(replica.workoutPrograms().map(p => [p.id, p.name])),
  };
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
  exercises: {
    exerciseId: string;
    name: string;
    supersetKey?: string;
    restSeconds?: number;
    /** The scheme chosen for moving on. Stored only: nothing proposes a load from it yet. */
    progression?: ProgressionScheme;
    targets: WorkoutRoutine['items'][number]['targets'];
  }[];
}

function routineRow(r: WorkoutRoutine, rows: readonly Exercise[], programName: ReadonlyMap<string, string>): RoutineRow {
  return {
    id: r.id,
    name: r.name,
    ...(r.notes ? { notes: r.notes } : {}),
    ...(r.programId && programName.has(r.programId) ? { program: programName.get(r.programId)! } : {}),
    exercises: r.items.map(i => ({
      exerciseId: i.exerciseId,
      name: catalogExercise(rows, i.exerciseId)?.name ?? 'Unknown exercise',
      ...(i.supersetKey ? { supersetKey: i.supersetKey } : {}),
      ...(i.restSeconds !== null ? { restSeconds: i.restSeconds } : {}),
      ...(i.progression ? { progression: i.progression.scheme } : {}),
      targets: i.targets,
    })),
  };
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

  const workouts = replica.workoutSessions(range.from, range.to)
    .map(s => workoutRow(replica, s, replica.workoutSets(s.id), { rows, routineName, programName }));

  return {
    range,
    workouts,
    routines: routines.map(r => routineRow(r, rows, programName)),
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

// ---------------------------------------------------------------------------
// Exercise history
// ---------------------------------------------------------------------------

/** How many points of the estimated 1RM trend one call returns. */
export const TREND_POINTS = 26;

export interface ExerciseHistoryInput {
  /** From list_exercises. */
  exerciseId: string;
}

export interface RecordRowOut {
  /** What it is: "Estimated 1RM", "Heaviest weight", "Best set of 8", "Most volume in a session". */
  record: string;
  type: RecordType;
  value: number;
  /** kg for weights, otherwise what the exercise measures. */
  unit: 'kg' | 'reps' | 'seconds' | 'm';
  /** The set that holds it, for a record held by one set. */
  reps?: number;
  /** `YYYY-MM-DD`, the day it was set. */
  date: string;
  /** True for the estimated 1RM: a calculation, not a lift. */
  estimated?: true;
}

/**
 * One exercise's history: its personal records, the trend of the estimated 1RM
 * and the last session's sets. Computed from the sets by the app's own
 * `workoutRecords.ts`, so Claude and the phone's exercise page cannot disagree.
 *
 * **The estimated 1RM is an estimate and is labelled one.** Epley, from a set
 * of ten reps or fewer; it is a calculation and never a lift the person did.
 * Nothing here is relative to a body weight, and a bodyweight exercise's volume
 * is its reps. Weights are kilograms whatever unit the phone shows.
 *
 * Sets are the health record, so with Include health logs off the history is
 * empty and the note says that is not evidence nobody trained, the reading
 * `list_workouts` gives.
 */
export function exerciseHistory(
  replica: Replica,
  input: ExerciseHistoryInput,
): {
  exercise: { id: string; name: string; kind: string; equipment: ExerciseEquipment; primaryMuscles: MuscleGroup[]; secondaryMuscles?: MuscleGroup[]; barKg?: number };
  sessions: number;
  firstDate?: string;
  lastDate?: string;
  personalRecords: RecordRowOut[];
  estimatedOneRepMaxTrend?: { date: string; estimatedKg: number }[];
  trendNote?: string;
  lastSession?: { id: string; title: string; date: string; sets: WorkoutSetRow[] };
  note?: string;
} {
  const rows = replica.exercises();
  const info = catalogExercise(rows, input.exerciseId);
  if (!info) throw new Error(`No exercise with id ${input.exerciseId}. list_exercises names them.`);

  const sessions: RecordSession[] = replica.workoutSessions('0000-01-01', '9999-12-31')
    .map(s => ({ id: s.id, startedAt: s.startedAt, dayKey: replica.logicalDayKeyOf(s.startedAt) }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
  const sets = replica.workoutExerciseSets(input.exerciseId);
  const analysis = analyzeExercise(input.exerciseId, info.kind, sets, sessions);

  const exercise = {
    id: info.id,
    name: info.name,
    kind: info.kind,
    equipment: info.equipment,
    primaryMuscles: info.primaryMuscles,
    ...(info.secondaryMuscles.length ? { secondaryMuscles: info.secondaryMuscles } : {}),
    ...(info.barKg !== null ? { barKg: info.barKg } : {}),
  };
  if (analysis.points.length === 0) {
    return { exercise, sessions: 0, personalRecords: [], note: WITHHELD_HISTORY_NOTE };
  }

  const unitOf = (type: RecordType): RecordRowOut['unit'] =>
    type === 'volume' ? volumeUnit(info.kind) : type === 'best'
      ? (info.kind === 'duration' ? 'seconds' : info.kind === 'distance' ? 'm' : 'reps')
      : 'kg';
  const personalRecords = analysis.records.map((r): RecordRowOut => ({
    record: recordLabel(r.type, info.kind, r.reps),
    type: r.type,
    value: r.value,
    unit: unitOf(r.type),
    ...(r.type === 'repsAt' && r.reps !== undefined ? { reps: r.reps } : {}),
    ...(r.type === 'weight' && r.set?.reps != null ? { reps: r.set.reps } : {}),
    date: r.dayKey,
    ...(r.type === 'e1rm' ? { estimated: true as const } : {}),
  }));

  const trend = analysis.points
    .filter(p => p.e1rm !== null)
    .slice(-TREND_POINTS)
    .map(p => ({ date: p.dayKey, estimatedKg: p.e1rm as number }));

  const lastPoint = analysis.points[analysis.points.length - 1];
  const lastSessionRow = sessions.find(s => s.id === lastPoint.sessionId);
  const lastSets = sets
    .filter(st => st.sessionId === lastPoint.sessionId && (countsForRecords(st) || st.kind === 'warmup'))
    .sort((a, b) => a.setIndex - b.setIndex)
    .map(setRow);
  const title = replica.workoutSession(lastPoint.sessionId)?.title ?? 'Workout';

  return {
    exercise,
    sessions: analysis.points.length,
    firstDate: analysis.points[0].dayKey,
    lastDate: lastPoint.dayKey,
    personalRecords,
    ...(trend.length > 0 ? { estimatedOneRepMaxTrend: trend } : {}),
    ...(trend.length > 0 ? {
      trendNote: 'Estimated, not lifted: Epley, from each session\'s best set of 10 reps or fewer. Always call it estimated.',
    } : {}),
    ...(lastSessionRow ? { lastSession: { id: lastSessionRow.id, title, date: lastSessionRow.dayKey, sets: lastSets } } : {}),
  };
}

const WITHHELD_HISTORY_NOTE =
  'No sets logged for this exercise. Workout history is part of the health record: it reaches the server only with Settings › Data & reset › Sync › Include health logs turned on, so this may mean it was never sent.';

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** One planned set of a routine exercise, as an agent writes it. Weights in kg. */
export interface RoutineSetInput {
  kind?: WorkoutSetKind;
  repsMin?: number | null;
  repsMax?: number | null;
  weightKg?: number | null;
  durationSeconds?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
  pctOfTm?: number | null;
}

export interface RoutineExerciseInput {
  exerciseId: string;
  sets: RoutineSetInput[];
  /** Rest after each set, in seconds. Absent for the person's default; 0 for none. */
  restSeconds?: number | null;
  /** Done as a superset with the exercise before it, set by set, back to back. */
  supersetWithPrevious?: boolean;
  progression?: ProgressionScheme | null;
}

export interface SaveRoutineInput {
  /** Absent to create one. */
  id?: string;
  name?: string;
  notes?: string;
  /** Replaces every exercise when given. */
  exercises?: RoutineExerciseInput[];
}

/** Ids no catalog knows, so the call can say which. */
function unknownExercises(replica: Replica, ids: readonly string[]): string[] {
  const rows = replica.exercises();
  return [...new Set(ids)].filter(id => catalogExercise(rows, id) === null);
}

function unknownError(ids: string[]): Error {
  return new Error(`No exercise with id ${ids.join(', ')}. list_exercises names them; a custom exercise is made on the phone.`);
}

/** An agent's exercises as routine items, supersets keyed the way the editor keys them. */
export function routineItemsFrom(input: readonly RoutineExerciseInput[], newKey: () => string): WorkoutRoutineItem[] {
  let items: WorkoutRoutineItem[] = input.map(e => ({
    exerciseId: e.exerciseId,
    supersetKey: null,
    restSeconds: e.restSeconds ?? null,
    progression: e.progression ? { scheme: e.progression, incrementKg: null } : null,
    targets: e.sets.map((t): RoutineSetTarget => ({
      kind: t.kind ?? 'working',
      repsMin: t.repsMin ?? t.repsMax ?? null,
      repsMax: t.repsMax ?? t.repsMin ?? null,
      ...(t.weightKg != null ? { weightKg: t.weightKg } : {}),
      ...(t.durationSeconds != null ? { durationSeconds: t.durationSeconds } : {}),
      ...(t.distanceM != null ? { distanceM: t.distanceM } : {}),
      ...(t.rpe != null ? { rpe: t.rpe } : {}),
      ...(t.pctOfTm != null ? { pctOfTm: t.pctOfTm } : {}),
    })),
  }));
  input.forEach((e, i) => { if (e.supersetWithPrevious) items = joinPrevious(items, i, newKey()); });
  return items;
}

let keySeq = 0;
const supersetKey = () => `ss-${Date.now().toString(36)}-${(keySeq++).toString(36)}`;

export function saveRoutine(replica: Replica, input: SaveRoutineInput): { routine: RoutineRow; note: string } {
  if (!input.id && !input.name?.trim()) throw new Error('A new routine needs a name.');
  if (input.exercises) {
    const unknown = unknownExercises(replica, input.exercises.map(e => e.exerciseId));
    if (unknown.length) throw unknownError(unknown);
    if (input.exercises.some(e => e.sets.length === 0)) throw new Error('Each exercise needs at least one set.');
  }
  const routine = replica.saveRoutine({
    id: input.id,
    name: input.name,
    notes: input.notes,
    items: input.exercises ? routineItemsFrom(input.exercises, supersetKey) : undefined,
  });
  const names = namesOf(replica);
  return {
    routine: routineRow(routine, names.rows, names.programName),
    note: 'A plan, not a record. A progression is stored as the person\'s choice and nothing proposes a load from it yet. To put it on their schedule, create or update a task with workoutRoutineId.',
  };
}

export function deleteRoutine(replica: Replica, id: string): { removed: { id: string; name: string }; note: string } {
  const routine = replica.deleteRoutine(id);
  return {
    removed: { id: routine.id, name: routine.name },
    note: 'Workouts already logged from it keep their history. Tasks linked to it stop offering it.',
  };
}

/** One set as an agent logs it. Weights in kg. */
export interface LoggedSetInput {
  kind?: WorkoutSetKind;
  weightKg?: number | null;
  reps?: number | null;
  durationSeconds?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
  note?: string | null;
}

export interface LogWorkoutInput {
  title?: string;
  routineId?: string | null;
  /** When it started: an ISO date-time, or YYYY-MM-DD for a day gone by. */
  startedAt: string;
  /** How long it took, when the person said. Absent leaves the length unknown. */
  durationMinutes?: number | null;
  notes?: string;
  effort?: number | null;
  exercises: { exerciseId: string; sets: LoggedSetInput[] }[];
}

function setsFrom(exercises: LogWorkoutInput['exercises']): SetInput[] {
  return exercises.flatMap(e => e.sets.map(st => ({
    exerciseId: e.exerciseId,
    kind: st.kind,
    weightKg: st.weightKg ?? null,
    reps: st.reps ?? null,
    durationSeconds: st.durationSeconds ?? null,
    distanceM: st.distanceM ?? null,
    rpe: st.rpe ?? null,
    note: st.note ?? null,
  })));
}

/** How far ahead of the replica's clock a start may be and still be a workout that happened. */
const FUTURE_SLACK_MS = 5 * 60 * 1000;

/**
 * The start a `startedAt` names. A bare day resolves to noon, which is still
 * ahead of "this morning" when the day is today, so it is held to now instead.
 */
function startFrom(value: string, now: Date): Date {
  const at = atFrom(value)!;
  const bare = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  return bare && at.getTime() > now.getTime() && at.toDateString() === now.toDateString() ? new Date(now.getTime()) : at;
}

export function logWorkout(replica: Replica, input: LogWorkoutInput, now: Date = new Date()): { workout: WorkoutRow } {
  const start = startFrom(input.startedAt, now);
  if (start.getTime() > now.getTime() + FUTURE_SLACK_MS) {
    throw new Error('A logged workout is one that happened: startedAt is in the future. Plan one with a task instead.');
  }
  const unknown = unknownExercises(replica, input.exercises.map(e => e.exerciseId));
  if (unknown.length) throw unknownError(unknown);
  if (input.routineId && !replica.workoutRoutines().some(r => r.id === input.routineId)) {
    throw new Error(`No routine with id ${input.routineId}. list_workouts lists the routines.`);
  }
  const end = input.durationMinutes != null && input.durationMinutes > 0
    ? new Date(start.getTime() + input.durationMinutes * 60000)
    : start;
  const { session, sets } = replica.logWorkout({
    title: input.title,
    routineId: input.routineId ?? null,
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    notes: input.notes,
    effort: input.effort ?? null,
    sets: setsFrom(input.exercises),
  });
  return { workout: workoutRow(replica, session, sets, namesOf(replica)) };
}

export interface UpdateWorkoutInput {
  title?: string;
  notes?: string;
  effort?: number | null;
  startedAt?: string;
  durationMinutes?: number | null;
  /** Replaces every set when given. */
  exercises?: LogWorkoutInput['exercises'];
}

export function updateWorkout(replica: Replica, id: string, input: UpdateWorkoutInput, now: Date = new Date()): { workout: WorkoutRow } {
  const existing = replica.workoutSession(id);
  if (!existing) throw new Error(`No workout with id ${id}. list_workouts lists them.`);
  if (Object.values(input).every(v => v === undefined)) throw new Error('Nothing to change: name a field.');
  if (input.exercises) {
    const unknown = unknownExercises(replica, input.exercises.map(e => e.exerciseId));
    if (unknown.length) throw unknownError(unknown);
  }
  const start = input.startedAt ? startFrom(input.startedAt, now) : new Date(existing.startedAt);
  if (input.startedAt && start.getTime() > now.getTime() + FUTURE_SLACK_MS) {
    throw new Error('A logged workout is one that happened: startedAt is in the future. Plan one with a task instead.');
  }
  const lengthMs = existing.endedAt ? new Date(existing.endedAt).getTime() - new Date(existing.startedAt).getTime() : 0;
  const end = input.durationMinutes !== undefined
    ? new Date(start.getTime() + Math.max(0, input.durationMinutes ?? 0) * 60000)
    : input.startedAt ? new Date(start.getTime() + lengthMs) : undefined;
  // Moving the start moves the sets with it, or they would sit a day after the session.
  const delta = start.getTime() - new Date(existing.startedAt).getTime();
  const shifted: SetInput[] | undefined = input.startedAt && !input.exercises && delta !== 0
    ? replica.workoutSets(id).map(st => ({
      exerciseId: st.exerciseId, kind: st.kind, weightKg: st.weightKg, reps: st.reps,
      durationSeconds: st.durationSeconds, distanceM: st.distanceM, rpe: st.rpe,
      supersetKey: st.supersetKey, note: st.note,
      completedAt: st.completedAt ? new Date(new Date(st.completedAt).getTime() + delta).toISOString() : null,
    }))
    : undefined;
  const { session, sets } = replica.updateWorkout(id, {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.effort !== undefined ? { effort: input.effort } : {}),
    ...(input.startedAt !== undefined ? { startedAt: start.toISOString() } : {}),
    ...(end ? { endedAt: end.toISOString() } : {}),
    ...(input.exercises ? { sets: setsFrom(input.exercises) } : shifted && shifted.length ? { sets: shifted } : {}),
  });
  return { workout: workoutRow(replica, session, sets, namesOf(replica)) };
}

export function deleteWorkout(replica: Replica, id: string): { removed: WorkoutRow; note: string } {
  const { session, sets } = replica.deleteWorkout(id);
  return {
    removed: workoutRow(replica, session, sets, namesOf(replica)),
    note: 'Deleted with its sets. It cannot be restored from here. A task it completed stays completed.',
  };
}
