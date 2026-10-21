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
  Exercise, ExerciseEquipment, Gym, GymExerciseSetting, MuscleGroup, ProgressionScheme, RoutineSetTarget, TrainingMax, WorkoutProgram, WorkoutRoutine,
  WorkoutRoutineItem, WorkoutSession, WorkoutSet, WorkoutSetKind,
} from '../../src/types';
import type { Replica } from './replica';
import { resolveRange, type DayRange, type LogRangeInput } from './tools';
import { atFrom } from './logTools';
import { joinPrevious } from '../../src/utils/workoutRoutine';
import type { SetInput } from '../../src/store/useWorkoutStore';
import { catalogExercise, exerciseName, searchExercises, type CatalogExercise } from '../../src/utils/exerciseCatalog';
import { analyzeExercise, countsForRecords, volumeUnit, type RecordSession, type RecordType } from '../../src/utils/workoutRecords';
import { recordLabel } from '../../src/utils/workoutRecordText';
import { programProgress, type ProgramProgress } from '../../src/utils/workoutProgram';
import { proposalHeadline, schemeFor, trainingMaxRaises, type SetProposal } from '../../src/utils/workoutProgression';
import { exerciseProposal, proposalRamp } from '../../src/utils/workoutProposal';

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
  /** Other names the person knows it by. list_exercises's query finds an exercise by them. */
  otherNames?: string[];
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
    ...(e.otherNames.length ? { otherNames: e.otherNames } : {}),
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
  /** The gym it was done at. */
  gym?: string;
  /** How hard it felt, 1 to 10, as the person typed it. */
  effort?: number;
  notes?: string;
  /** Written to Apple Health by the phone; its times can't be changed, nor it deleted, from here. */
  inAppleHealth?: true;
  exercises: { exerciseId: string; name: string; sets: WorkoutSetRow[] }[];
}

interface RowNames {
  rows: readonly Exercise[];
  routineName: ReadonlyMap<string, string>;
  programName: ReadonlyMap<string, string>;
  gymName: ReadonlyMap<string, string>;
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
    ...(s.gymId && names.gymName.has(s.gymId) ? { gym: names.gymName.get(s.gymId)! } : {}),
    ...(s.effort !== null ? { effort: s.effort } : {}),
    ...(s.notes ? { notes: s.notes } : {}),
    // In Apple Health: the phone wrote it there, so only the phone can move or delete it.
    ...(s.healthWorkoutId ? { inAppleHealth: true as const } : {}),
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
    gymName: new Map(replica.gyms().map(g => [g.id, g.name])),
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
  /** The heading the Routines tab lists it under. Absent for a routine in no group. */
  group?: string;
  /** Put away under Archived: still startable, out of the list and the pickers. */
  archived?: true;
  exercises: {
    exerciseId: string;
    name: string;
    supersetKey?: string;
    restSeconds?: number;
    /** The scheme chosen for moving on. next_workout reads the proposal it makes. */
    progression?: ProgressionScheme;
    /** Warm-ups are a ramp worked out from the working weight when the workout starts. */
    warmupRamp?: true;
    targets: WorkoutRoutine['items'][number]['targets'];
  }[];
}

function routineRow(r: WorkoutRoutine, rows: readonly Exercise[], programName: ReadonlyMap<string, string>): RoutineRow {
  return {
    id: r.id,
    name: r.name,
    ...(r.notes ? { notes: r.notes } : {}),
    ...(r.programId && programName.has(r.programId) ? { program: programName.get(r.programId)! } : {}),
    ...(r.groupName ? { group: r.groupName } : {}),
    ...(r.archived ? { archived: true as const } : {}),
    exercises: r.items.map(i => ({
      exerciseId: i.exerciseId,
      name: catalogExercise(rows, i.exerciseId)?.name ?? 'Unknown exercise',
      ...(i.supersetKey ? { supersetKey: i.supersetKey } : {}),
      ...(i.restSeconds !== null ? { restSeconds: i.restSeconds } : {}),
      ...(i.progression ? { progression: i.progression.scheme } : {}),
      ...(i.warmupRamp ? { warmupRamp: true as const } : {}),
      targets: i.targets,
    })),
  };
}

export interface GymRow {
  id: string;
  name: string;
  /** What the gym has. Empty means nothing was told, not that it has none. */
  equipment: ExerciseEquipment[];
  placeText?: string;
  /** Set once the person pinned the gym's place; workouts pick the gym by it. */
  hasLocation?: true;
  /** The gym a workout starts at before the phone's location says otherwise. At most one gym has it. */
  isDefault?: true;
  archived?: true;
  /** What is noted for an exercise at this gym. */
  exerciseNotes?: { exerciseId: string; name: string; notes?: string; barKg?: number; incrementKg?: number }[];
}

function gymRow(g: Gym, settings: readonly GymExerciseSetting[], rows: readonly Exercise[], defaultGymId: string | null): GymRow {
  const notes = settings.filter(s => s.gymId === g.id);
  return {
    id: g.id,
    name: g.name,
    equipment: g.equipment,
    ...(g.placeText ? { placeText: g.placeText } : {}),
    ...(g.latitude !== null && g.longitude !== null ? { hasLocation: true as const } : {}),
    ...(!g.archived && g.id === defaultGymId ? { isDefault: true as const } : {}),
    ...(g.archived ? { archived: true as const } : {}),
    ...(notes.length ? { exerciseNotes: notes.map(s => ({
      exerciseId: s.exerciseId,
      name: exerciseName(rows, s.exerciseId),
      ...(s.notes ? { notes: s.notes } : {}),
      ...(s.barKg ? { barKg: s.barKg } : {}),
      ...(s.incrementKg ? { incrementKg: s.incrementKg } : {}),
    })) } : {}),
  };
}

const WITHHELD_NOTE =
  'No workouts in this range. Workout history is part of the health record: it reaches the server only with Settings › Data & reset › Sync › Include health logs turned on, so this may mean it was never sent. Routines and programs travel either way.';

export interface ProgramRow {
  id: string;
  name: string;
  weeks?: number;
  /** Absent when the program chooses none: loads move on only for exercises whose routine chooses. */
  scheme?: ProgressionScheme;
  /** Routine names, in the order they come round. */
  rotation: string[];
  /** The routine ids, in the same order, for save_program. */
  rotationIds: string[];
  trainingMaxes?: { exerciseId: string; name: string; kg: number }[];
  startedAt?: string;
  /** Derived from its finished workouts, never stored: which pass it is on ("week"), and the routine that comes next. */
  week: number;
  workoutsDone: number;
  next?: { routineId: string; name: string };
  /** A whole cycle was just finished: the moment a percentage program's training maxes are raised. */
  cycleDone?: true;
}

function programRow(
  p: WorkoutProgram,
  progress: ProgramProgress,
  rows: readonly Exercise[],
  routineName: ReadonlyMap<string, string>,
): ProgramRow {
  return {
    id: p.id,
    name: p.name,
    ...(p.weeks !== null ? { weeks: p.weeks } : {}),
    ...(p.scheme ? { scheme: p.scheme } : {}),
    rotation: p.rotation.map(id => routineName.get(id) ?? 'A deleted routine'),
    rotationIds: [...p.rotation],
    ...(p.trainingMaxes.length ? {
      trainingMaxes: p.trainingMaxes.map(t => ({ exerciseId: t.exerciseId, name: exerciseName(rows, t.exerciseId), kg: t.kg })),
    } : {}),
    ...(p.startedAt ? { startedAt: p.startedAt } : {}),
    week: progress.week,
    workoutsDone: progress.sessionsDone,
    ...(progress.nextRoutineId ? { next: { routineId: progress.nextRoutineId, name: routineName.get(progress.nextRoutineId) ?? 'A deleted routine' } } : {}),
    ...(progress.cycleDone ? { cycleDone: true as const } : {}),
  };
}

/** Every session the replica holds, for a program's progress. */
const allSessions = (replica: Replica) => replica.workoutSessions('0000-01-01', '9999-12-31');

export function listWorkouts(
  replica: Replica,
  input: LogRangeInput = {},
): { range: DayRange; workouts: WorkoutRow[]; routines: RoutineRow[]; routineGroups: string[]; programs: ProgramRow[]; gyms: GymRow[]; note?: string } {
  const range = resolveRange(replica, input);
  const rows = replica.exercises();
  const routines = replica.workoutRoutines();
  const programs = replica.workoutPrograms();
  const routineName = new Map(routines.map(r => [r.id, r.name]));
  const programName = new Map(programs.map(p => [p.id, p.name]));
  const gyms = replica.gyms();
  const gymName = new Map(gyms.map(g => [g.id, g.name]));

  const workouts = replica.workoutSessions(range.from, range.to)
    .map(s => workoutRow(replica, s, replica.workoutSets(s.id), { rows, routineName, programName, gymName }));

  return {
    range,
    workouts,
    routines: routines.map(r => routineRow(r, rows, programName)),
    routineGroups: replica.routineGroups(),
    programs: programs.filter(p => !p.archived)
      .map(p => programRow(p, programProgress(p, allSessions(replica), routines), rows, routineName)),
    gyms: gyms.map(g => gymRow(g, replica.gymExercises(), rows, replica.defaultGymId())),
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
    .filter(st => st.sessionId === lastPoint.sessionId && st.completedAt !== null && (countsForRecords(st) || st.kind === 'warmup'))
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
  /** Warm up with a ramp worked out from the working weight, in place of warm-up sets of its own. */
  warmupRamp?: boolean;
}

export interface SaveRoutineInput {
  /** Absent to create one. */
  id?: string;
  name?: string;
  notes?: string;
  /** Files it under that group, which is made if it is new; null takes it out of its group. */
  group?: string | null;
  archived?: boolean;
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
    ...(e.warmupRamp ? { warmupRamp: true } : {}),
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
    // A ramp is worked out from a weight and moves it by plates or an
    // increment, so it only means something for a weight and reps exercise
    // (on an assisted one it would ramp the assistance).
    const rows = replica.exercises();
    const misplaced = input.exercises
      .filter(e => e.warmupRamp && (catalogExercise(rows, e.exerciseId)?.kind ?? 'weight_reps') !== 'weight_reps')
      .map(e => catalogExercise(rows, e.exerciseId)?.name ?? e.exerciseId);
    if (misplaced.length) {
      throw new Error(`A warm-up ramp is only for exercises that record weight and reps, and ${[...new Set(misplaced)].join(', ')} ${misplaced.length === 1 ? 'does' : 'do'} not. Leave warmupRamp off, or give ${misplaced.length === 1 ? 'it' : 'them'} warm-up sets of their own.`);
    }
  }
  const routine = replica.saveRoutine({
    id: input.id,
    name: input.name,
    notes: input.notes,
    items: input.exercises ? routineItemsFrom(input.exercises, supersetKey) : undefined,
    groupName: input.group,
    archived: input.archived,
  });
  const names = namesOf(replica);
  return {
    routine: routineRow(routine, names.rows, names.programName),
    note: 'A plan, not a record. A progression is the person\'s choice of how loads move on: workout mode shows the next load it proposes, and next_workout reads it, but nothing applies one unasked. To put it on their schedule, create or update a task with workoutRoutineId, or put it in a program (save_program).',
  };
}

export interface SaveGymInput {
  id?: string;
  name?: string;
  equipment?: ExerciseEquipment[];
  placeText?: string;
  isDefault?: boolean;
  exerciseNotes?: { exerciseId: string; notes?: string; barKg?: number | null; incrementKg?: number | null }[];
}

export function saveGym(replica: Replica, input: SaveGymInput): { gym: GymRow; note: string } {
  if (!input.id && !input.name?.trim()) throw new Error('A new gym needs a name.');
  if (input.exerciseNotes) {
    const unknown = unknownExercises(replica, input.exerciseNotes.map(n => n.exerciseId));
    if (unknown.length) throw unknownError(unknown);
  }
  const gym = replica.saveGym(input);
  return {
    gym: gymRow(gym, replica.gymExercises(), replica.exercises(), replica.defaultGymId()),
    note: 'A gym is where the person trains and what it has. Starting a workout picks the gym by the phone\'s location, else the default gym (isDefault), else the gym last used. An exercise the gym can\'t do is flagged with a replacement proposed, never swapped unasked. Where a gym is can only be set on the phone.',
  };
}

export function deleteGym(replica: Replica, id: string): { removed: { id: string; name: string }; note: string } {
  const gym = replica.deleteGym(id);
  return {
    removed: { id: gym.id, name: gym.name },
    note: 'Its exercise notes are deleted too. Workouts done there keep their history.',
  };
}

export function saveRoutineGroup(replica: Replica, input: { name: string; renameTo?: string }): { group: string; routineGroups: string[]; note: string } {
  const group = replica.saveRoutineGroup(input.name, input.renameTo);
  return {
    group,
    routineGroups: replica.routineGroups(),
    note: 'A group is a heading on the Routines tab. A new one is empty until a routine is filed under it (save_routine with group). Renaming one renames it on its routines, and a name another group already has joins the two.',
  };
}

export function deleteRoutineGroup(replica: Replica, name: string): { removed: string; routinesKeptUngrouped: number; note: string } {
  const held = replica.deleteRoutineGroup(name);
  return { removed: name, routinesKeptUngrouped: held, note: 'Its routines stay, in no group.' };
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

// ---------------------------------------------------------------------------
// Programs
// ---------------------------------------------------------------------------

export interface SaveProgramInput {
  /** Absent to create one. */
  id?: string;
  name?: string;
  /** Routine ids in the order they come round; a routine may come round more than once. Replaces the rotation when given. */
  routineIds?: string[];
  /** Null for none: the phone proposes no loads for exercises whose routine doesn't choose. */
  scheme?: ProgressionScheme | null;
  /** Passes through the rotation in a cycle; null for open-ended. */
  weeks?: number | null;
  /** Training maxes in kg, for a percentage scheme. Replaces them all when given. */
  trainingMaxes?: { exerciseId: string; kg: number }[];
  /**
   * Counts the program's weeks again from now, as the phone's "Start next
   * cycle" does. Without it a finished cycle stays finished after the training
   * maxes are raised, and the phone offers the raise a second time.
   */
  startNextCycle?: true;
}

export function saveProgram(replica: Replica, input: SaveProgramInput, now: Date = new Date()): { program: ProgramRow; note: string } {
  if (!input.id && !input.name?.trim()) throw new Error('A new program needs a name.');
  if (input.startNextCycle && !input.id) throw new Error('startNextCycle restarts the count of a program that exists: give its id.');
  if (input.trainingMaxes) {
    const unknown = unknownExercises(replica, input.trainingMaxes.map(t => t.exerciseId));
    if (unknown.length) throw unknownError(unknown);
  }
  const maxes: TrainingMax[] | undefined = input.trainingMaxes?.map(t => ({ exerciseId: t.exerciseId, kg: t.kg }));
  const program = replica.saveProgram({
    id: input.id,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.routineIds !== undefined ? { rotation: input.routineIds } : {}),
    ...(input.scheme !== undefined ? { scheme: input.scheme } : {}),
    ...(input.weeks !== undefined ? { weeks: input.weeks } : {}),
    ...(maxes !== undefined ? { trainingMaxes: maxes } : {}),
    ...(input.startNextCycle ? { startedAt: now.toISOString() } : {}),
  });
  const routines = replica.workoutRoutines();
  return {
    program: programRow(program, programProgress(program, allSessions(replica), routines), replica.exercises(), new Map(routines.map(r => [r.id, r.name]))),
    note: `A plan. Which week it is and which routine is next are worked out from the workouts finished in it, never set${input.startNextCycle ? ', and the count now starts again from this moment' : ''}. To put it on the schedule, create or update a task with workoutProgramId: its row then starts the next routine.`,
  };
}

export function deleteProgram(replica: Replica, id: string): { removed: { id: string; name: string }; note: string } {
  const program = replica.deleteProgram(id);
  return {
    removed: { id: program.id, name: program.name },
    note: 'Its routines stay, as routines on their own, and workouts logged from it keep their history. Tasks linked to it stop offering it.',
  };
}

export interface NextWorkoutInput {
  /** A program, for its next routine. */
  programId?: string;
  /** A routine, for its own exercises. */
  routineId?: string;
}

export interface NextExerciseRow {
  exerciseId: string;
  name: string;
  scheme?: ProgressionScheme;
  /** The proposed working sets, weights in kg. Absent when there is nothing to propose from yet. */
  proposal?: {
    move: string;
    sets: SetProposal[];
    /** The phone's own words for it ("Today 3 × 6–8 at 82.5 kg."), in the unit the phone shows. */
    headline?: string;
    /** Why, in the phone's words and unit. */
    reason: string;
    /** For a routine that warms up with a ramp: the warm-ups for the proposed weight, in kg. */
    warmups?: { weightKg: number; reps: number }[];
  };
}

/**
 * The next workout, with each exercise's proposed sets: the program's next
 * routine (derived from its finished workouts) or a routine named directly,
 * and for each weight and reps exercise what workout mode will suggest.
 * One call rather than an `exercise_history` per exercise, since "what should
 * I lift on Thursday" is about the whole workout.
 *
 * **A proposal, never a plan change.** It is computed by the phone's own
 * `exerciseProposal` (`workoutProposal.ts`, what workout mode's card and the watch read) against the person's plates and unit; nothing here
 * writes a routine, a target or a session.
 */
export function nextWorkout(replica: Replica, input: NextWorkoutInput = {}): {
  routine: { id: string; name: string };
  program?: { id: string; name: string; week: number; weeks?: number; workoutsDone: number; cycleDone?: true; trainingMaxRaises?: { exerciseId: string; name: string; fromKg: number; toKg: number }[] };
  phoneUnit: 'kg' | 'lb';
  exercises: NextExerciseRow[];
  note: string;
} {
  const routines = replica.workoutRoutines();
  const programs = replica.workoutPrograms().filter(p => !p.archived);
  const sessions = allSessions(replica);
  // "Last time" is a finished workout, as on the phone: one in progress there
  // is passed over, so its done sets are not read as the last session.
  const finished = sessions.filter(s => s.endedAt !== null);
  const rows = replica.exercises();

  let program: WorkoutProgram | null = null;
  let routine: WorkoutRoutine | null = null;
  if (input.programId) {
    program = programs.find(p => p.id === input.programId) ?? null;
    if (!program) throw new Error(`No program with id ${input.programId}. list_workouts lists the programs.`);
  } else if (input.routineId) {
    routine = routines.find(r => r.id === input.routineId) ?? null;
    if (!routine) throw new Error(`No routine with id ${input.routineId}. list_workouts lists the routines.`);
    program = routine.programId ? programs.find(p => p.id === routine!.programId) ?? null : null;
  } else {
    const running = programs.filter(p => p.rotation.length > 0);
    if (running.length !== 1) {
      throw new Error(running.length === 0
        ? 'No program to read the next workout of. Name a routineId, or make a program with save_program.'
        : `Several programs: name one with programId (${running.map(p => `${p.name}: ${p.id}`).join('; ')}).`);
    }
    program = running[0];
  }
  const progress = program ? programProgress(program, sessions, routines) : null;
  if (!routine) {
    routine = progress?.nextRoutineId ? routines.find(r => r.id === progress.nextRoutineId) ?? null : null;
    if (!routine) throw new Error('That program has no routines in its rotation. Add some with save_program.');
  }

  const { unit, plateInventory } = replica.workoutLoads();
  let withheld = false;
  const exercises: NextExerciseRow[] = routine.items.map(item => {
    const info = catalogExercise(rows, item.exerciseId);
    const name = info?.name ?? 'Unknown exercise';
    const scheme = schemeFor(item, program);
    if (!info || !scheme) return { exerciseId: item.exerciseId, name, ...(scheme ? { scheme } : {}) };
    const history = replica.workoutExerciseSets(item.exerciseId);
    if (history.length === 0 && scheme !== 'percent') withheld = true;
    // The phone's own proposal (`exerciseProposal`, what workout mode's card
    // and the Apple Watch's both read), so the three can't drift. "Last time"
    // is a finished workout, so the sessions are the finished ones.
    const shown = exerciseProposal({
      exerciseId: item.exerciseId, exercises: rows, routine, program, sessions: finished, routines, history,
      exceptSessionId: null, plateInventory, unit,
    });
    if (!shown) return { exerciseId: item.exerciseId, name, scheme };
    const p = shown.proposal;
    const headline = proposalHeadline(p, unit);
    const warmups = (proposalRamp(shown) ?? []).map(st => ({ weightKg: st.kg, reps: st.reps }));
    return {
      exerciseId: item.exerciseId, name, scheme,
      proposal: {
        move: p.move, sets: p.sets, reason: p.reason,
        ...(headline ? { headline } : {}),
        ...(warmups.length ? { warmups } : {}),
      },
    };
  });

  const raises = program && progress?.cycleDone && program.scheme === 'percent'
    ? trainingMaxRaises(program, id => catalogExercise(rows, id)?.primaryMuscles ?? [], unit)
      .map(r => ({ ...r, name: exerciseName(rows, r.exerciseId) }))
    : [];
  return {
    routine: { id: routine.id, name: routine.name },
    ...(program && progress ? {
      program: {
        id: program.id, name: program.name, week: progress.week,
        ...(progress.weeks !== null ? { weeks: progress.weeks } : {}),
        workoutsDone: progress.sessionsDone,
        ...(progress.cycleDone ? { cycleDone: true as const } : {}),
        ...(raises.length ? { trainingMaxRaises: raises } : {}),
      },
    } : {}),
    phoneUnit: unit,
    exercises,
    note: [
      'Proposals only: the person sees the same suggestion in workout mode and decides whether to use it. Never write one into a routine unasked, and never log a workout to stand for one.',
      'weightKg is kilograms; headline and reason are the phone\'s words in the unit it shows.',
      sessions.length === 0
        ? 'This replica holds no workouts, so the week and workoutsDone shown count nothing and are not known facts, and the proposals that move on from history are missing. Workout history reaches the server only with Include health logs on; with it off the week and the next routine count no workouts.'
        : withheld ? 'Some exercises have no history here. Workout history reaches the server only with Include health logs on, so with it off the week and the next routine count no workouts, and loads that move on from history are missing.' : null,
      raises.length ? 'A cycle just ended: trainingMaxRaises is what the phone proposes for the next one. Raise them with save_program only if the person agrees, passing startNextCycle: true in the same call so the count starts again and the phone does not offer the raise a second time.' : null,
    ].filter(Boolean).join(' '),
  };
}
