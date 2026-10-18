import { create } from 'zustand';
import type {
  Exercise,
  ExerciseEquipment,
  ExerciseKind,
  MuscleGroup,
  ProgressionScheme,
  TrainingMax,
  WorkoutProgram,
  WorkoutRoutine,
  WorkoutRoutineItem,
  WorkoutSession,
  WorkoutSet,
  WorkoutSetKind,
} from '../types';
import {
  dbCountWorkoutSetsBySession,
  dbDeleteExercise,
  dbDeleteWorkoutProgram,
  dbDeleteWorkoutRoutine,
  dbDeleteWorkoutSession,
  dbDeleteWorkoutSet,
  dbGetAllDoneWorkoutSets,
  dbGetAllExercises,
  dbGetAllWorkoutPrograms,
  dbGetAllWorkoutRoutines,
  dbGetAllWorkoutSessions,
  dbGetPendingHealthWorkoutSessions,
  dbGetWorkoutSession,
  dbGetWorkoutSets,
  dbGetWorkoutSetsForExercise,
  dbSaveExercise,
  dbSaveWorkoutProgram,
  dbSaveWorkoutRoutine,
  dbSaveWorkoutSession,
  dbSaveWorkoutSet,
  dbSaveWorkoutSets,
  dbTransaction,
} from '../db/database';
import { generateId } from '../utils/id';
import { workoutTaskEffect } from '../utils/workoutTask';
import {
  copyLastSet,
  finishPlan,
  plannedSetsFor,
  plannedSetsFromHistory,
  previousSets,
  type PlannedSetValues,
} from '../utils/workoutSession';
import { libraryExercise } from '../utils/exerciseLibrary';
import { loadContextFor, rampSteps } from '../utils/workoutProgression';
import { libraryProgram } from '../utils/workoutProgramLibrary';
import { useSettingsStore } from './useSettingsStore';
import {
  logWorkoutToHealth,
  pendingWorkoutWriteAction,
  retractWorkoutFromHealth,
  workoutHealthWriteOn,
  type WorkoutWriteResult,
} from '../utils/healthWorkoutSync';
import { NEW_EXERCISE_PREFIX, indexAdd, indexExisting, indexHas, type PlannedImportSession } from '../utils/workoutCsv';
import { overlappingSessions } from '../utils/watchWorkoutClash';
import { getLogicalDayKey } from '../utils/dateUtils';
import { useWatchClashStore } from './useWatchClashStore';
import { buildCatalog, catalogExercise } from '../utils/exerciseCatalog';
import {
  cleanWorkoutName,
  exerciseNameKey,
  freeWorkoutName,
  readMuscles,
  readRoutineItems,
  readTrainingMaxes,
  WORKOUT_EFFORT,
} from '../utils/workoutData';

/**
 * Workouts: custom exercises, routines, programs, and the sessions and sets
 * logged against them. See docs/arch/workouts.md.
 *
 * Exercises, routines, programs and sessions are loaded whole at startup: a
 * few sessions a week is a few hundred rows a year. **Sets are not.** At
 * about 25 a session they are the one table here that grows into thousands,
 * so they are loaded per session on demand (`loadSets`) and cached in
 * `setsBySession`; the live session's are loaded at startup, since that is
 * the one being added to. `setCounts` answers "how many sets" for a history
 * list without loading any.
 *
 * Every weight is kilograms. `workoutUnit` decides only what a screen shows.
 *
 * A session's `taskId` is provenance: finishing a session completes its task
 * through `completeTask` (the one direction it goes, and the one that pays
 * coins, as a person's action), and a task ticked off with no session never
 * invents one.
 *
 * **Planned sets are rows with no `completedAt`.** Starting from a routine
 * lays its sets out that way (`workoutSession.ts` decides the numbers), and
 * finishing deletes the ones never ticked.
 */

export interface ExerciseInput {
  name: string;
  kind: ExerciseKind;
  equipment: ExerciseEquipment;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles?: MuscleGroup[];
  barKg?: number | null;
  notes?: string;
}

/** What an edit may change. On a built-in exercise only `name`, `notes`, `barKg` and `archived` take effect. */
export type ExercisePatch = Partial<Omit<ExerciseInput, 'secondaryMuscles'>> & {
  secondaryMuscles?: MuscleGroup[];
  archived?: boolean;
};

export interface RoutinePatch {
  name?: string;
  notes?: string;
  programId?: string | null;
  items?: WorkoutRoutineItem[];
}

export interface ProgramInput {
  name: string;
  weeks?: number | null;
  rotation?: string[];
  scheme?: ProgressionScheme;
  trainingMaxes?: TrainingMax[];
}

export type ProgramPatch = Partial<ProgramInput> & { startedAt?: string | null; archived?: boolean };

export interface StartSessionInput {
  title?: string;
  routineId?: string | null;
  programId?: string | null;
  taskId?: string | null;
  at?: Date;
}

export interface SessionPatch {
  title?: string;
  notes?: string;
  effort?: number | null;
  startedAt?: string;
  endedAt?: string | null;
}

export interface FinishOptions extends Omit<SessionPatch, 'endedAt'> {
  endedAt?: string;
  /**
   * Whether finishing completes the task the session was started from.
   * Default true. Workout mode passes false only when that task asks a
   * question on completion, and asks it itself (the answer-first rule).
   */
  completeLinkedTask?: boolean;
}

/** A workout logged after the fact, with what was done. */
export interface FinishedSessionInput {
  title?: string;
  routineId?: string | null;
  startedAt: string;
  endedAt: string;
  notes?: string;
  effort?: number | null;
  /**
   * Leave the workout for the phone to write to Health on its next foreground
   * (`WorkoutSession.healthWritePending`). Set by the MCP server, which has no
   * HealthKit; the app's own paths write at the moment of saving instead.
   */
  healthWritePending?: boolean;
  /** In the order they were done; an exercise's sets keep its first set's place. */
  sets: (SetInput & { completedAt?: string | null })[];
}

/** A planned set of a routine, at the place `startSession` gives it. */
export interface PlannedRoutineSet {
  exerciseId: string;
  position: number;
  setIndex: number;
  values: PlannedSetValues;
}

/** A workout the watch ran on its own, as `parseWatchSession` reads it: kilograms, done sets only. */
export interface WatchSessionInput {
  id: string;
  routineId: string | null;
  programId: string | null;
  taskId: string | null;
  title: string;
  startedAt: string;
  endedAt: string;
  sets: {
    id: string;
    exerciseId: string;
    position: number;
    setIndex: number;
    kind: WorkoutSetKind;
    weightKg: number | null;
    reps: number | null;
    durationSeconds: number | null;
    distanceM: number | null;
    completedAt: string;
  }[];
}

export interface WatchSessionResult {
  session: WorkoutSession;
  sets: WorkoutSet[];
  /** The session was already in the log, so nothing was written. */
  duplicate: boolean;
  /** Other sessions whose span overlaps this one's, newest first. */
  clashesWith: string[];
}

export interface SetInput {
  exerciseId: string;
  kind?: WorkoutSetKind;
  weightKg?: number | null;
  reps?: number | null;
  durationSeconds?: number | null;
  distanceM?: number | null;
  rpe?: number | null;
  supersetKey?: string | null;
  note?: string | null;
  /** When it was done. Defaults to now; null lays the set out as planned, not done. */
  completedAt?: string | null;
}

export type SetPatch = Partial<Omit<SetInput, 'exerciseId'>>;

/** Why a write was refused, for the caller to say in its own words. */
export type WorkoutRefusal =
  | 'blank' | 'taken' | 'notFound' | 'hasHistory' | 'live' | 'finished' | 'empty' | 'order'
  /** A routine item asks for a warm-up ramp on an exercise that doesn't record weight and reps. */
  | 'rampKind';

interface WorkoutStore {
  exercises: Exercise[];
  routines: WorkoutRoutine[];
  programs: WorkoutProgram[];
  /** Newest first. */
  sessions: WorkoutSession[];
  /** Sets per session, for the sessions loaded so far. */
  setsBySession: Record<string, WorkoutSet[]>;
  /** How many sets each session holds, loaded or not. */
  setCounts: Record<string, number>;
  initialized: boolean;
  initialize: () => void;

  /** A custom exercise. Refuses a blank name or one already on offer. */
  addExercise: (input: ExerciseInput) => Exercise | WorkoutRefusal;
  /** Edits a custom exercise, or writes the person's changes over a built-in one. */
  updateExercise: (id: string, patch: ExercisePatch) => Exercise | WorkoutRefusal;
  /**
   * A custom exercise is archived rather than removed, whether or not this
   * device holds sets for it: `workout_sets` never go to iCloud, so another
   * device's sets (and the routines and programs naming it) can't be counted
   * from here, and a synced delete would leave them pointing at nothing. On a
   * built-in, removes the person's changes and puts the library's back.
   */
  deleteExercise: (id: string) => true | WorkoutRefusal;

  addRoutine: (name: string, items?: WorkoutRoutineItem[], programId?: string | null) => WorkoutRoutine | WorkoutRefusal;
  updateRoutine: (id: string, patch: RoutinePatch) => WorkoutRoutine | WorkoutRefusal;
  /** Also takes it out of any program's rotation. Sessions keep naming it, as provenance. */
  deleteRoutine: (id: string) => void;

  /**
   * A program. A rotation given here or to `updateProgram` also files its
   * routines under the program (`WorkoutRoutine.programId`) where they belong
   * to none, and frees the ones taken out of it, so a routine started on its
   * own from the Routines list still counts toward its program.
   */
  addProgram: (input: ProgramInput) => WorkoutProgram | WorkoutRefusal;
  updateProgram: (id: string, patch: ProgramPatch) => WorkoutProgram | WorkoutRefusal;
  /** Its routines stay, as routines on their own. */
  deleteProgram: (id: string) => void;
  /**
   * Writes a built-in program (`PROGRAM_LIBRARY`) as the person's own: its
   * routines, then the program naming them in rotation, in one transaction.
   * Refuses a key the library doesn't have (`notFound`).
   */
  addLibraryProgram: (key: string) => { program: WorkoutProgram; routines: WorkoutRoutine[] } | WorkoutRefusal;

  /** The session in progress, if there is one. */
  liveSession: () => WorkoutSession | null;
  /**
   * Starts a session. Refuses (`live`) while another is in progress. Started
   * from a routine, it lays the routine's sets out as planned (not done), with
   * the numbers from the routine or from last time (`plannedSetsFor`).
   */
  startSession: (input?: StartSessionInput) => WorkoutSession | WorkoutRefusal;
  /**
   * The sets starting this routine would lay out right now, in order, each
   * with the place it takes: `startSession`'s own plan, read without writing
   * anything. Last time is the newest session other than `exceptSessionId`.
   * The Apple Watch's start list carries it, so a workout started there with
   * no phone in reach lays out exactly what the phone would have.
   */
  plannedSetsForRoutine: (routineId: string, exceptSessionId?: string | null) => PlannedRoutineSet[];
  /**
   * Edits a session. Refuses a blank title, and an end before the start
   * (`order`). Moving a finished session that is in Health retracts the
   * workout and writes it again at the new times, while writing is on; with
   * it off, Health is left as it is.
   */
  updateSession: (id: string, patch: SessionPatch) => WorkoutSession | WorkoutRefusal;
  /**
   * Ends a session now (or at `endedAt`). Refuses one already finished
   * (`finished`). Deletes the planned sets never ticked and completes the
   * task it was started from (see `FinishOptions`). This is workout mode's
   * Save, a person's tap, so it is also what writes the workout to Health
   * while writing is on (`logWorkoutToHealth`).
   */
  finishSession: (id: string, patch?: FinishOptions) => WorkoutSession | WorkoutRefusal;
  /**
   * Writes a workout that already happened, finished, with its sets, in one
   * go: what an agent's `log_workout` is. Refuses one with no sets (`empty`),
   * one that ends before it starts (`order`), and a set on an exercise nobody
   * knows (`notFound`). Never completes a task: a log after the fact is a
   * record, and the task is completed (or not) on its own.
   */
  addFinishedSession: (input: FinishedSessionInput) => { session: WorkoutSession; sets: WorkoutSet[] } | WorkoutRefusal;
  /**
   * Writes the workouts an import plan names (`buildImportPlan`), and the
   * custom exercises it needs, in one transaction. A session already in the
   * log (same id, or the same start time, whatever it is called) is skipped
   * again here, so a plan made before another device synced in the same
   * workout can't double it.
   * `creates` maps each `new:<key>` reference's key to the exercise to make;
   * a name that has become taken since resolves to the exercise holding it.
   * Never written to Health: an imported workout came from an app that most
   * likely wrote it there already.
   */
  /**
   * Writes a workout the Apple Watch ran on its own (`watchWorkout.ts`), once:
   * a session id already in the log is a repeat delivery and writes nothing
   * (`duplicate`). The session and its sets keep the watch's ids, and its
   * times are the watch's stamps however late it arrives. Like `finishSession`
   * it answers the task it was started for (a target's unit only when it ended
   * today, a completion at the time it ended), writes it to Health under the
   * same switches, and leaves a task that asks a question alone for the app to
   * ask. Another session overlapping its span is recorded for the one question
   * the phone asks about it (`useWatchClashStore`), and named in `clashesWith`.
   */
  addWatchSession: (input: WatchSessionInput, now?: Date) => WatchSessionResult | WorkoutRefusal;
  importSessions: (
    sessions: PlannedImportSession[],
    creates: Record<string, ExerciseInput>,
  ) => { sessions: number; sets: number; created: number; duplicates: number };
  /**
   * Replaces every set of a session, for correcting a workout logged after the
   * fact. Refuses an unknown session or exercise (`notFound`).
   */
  replaceSets: (sessionId: string, sets: (SetInput & { completedAt?: string | null })[]) => WorkoutSet[] | WorkoutRefusal;
  /**
   * Deletes a session and its sets, live or finished, and takes back the
   * workout it wrote to Health (ungated by the write switches, like every
   * retraction).
   */
  deleteSession: (id: string) => void;
  /** Throws away the live session and its sets. */
  discardSession: () => void;

  /** A session's sets, read from the database the first time and cached after. */
  loadSets: (sessionId: string) => WorkoutSet[];
  /** Every set ever logged against one exercise, oldest first. Not cached: an exercise's page reads it once. */
  exerciseHistory: (exerciseId: string) => WorkoutSet[];
  /**
   * Every done set in every session, oldest first. Not cached here: the
   * caller holds the array (keyed on `sessions`), which is what the records'
   * own memoization is keyed on in turn.
   */
  allSets: () => WorkoutSet[];
  /**
   * Appends a set. An exercise already in the session keeps its place; a new
   * one goes after the rest. Refuses a session or exercise nobody knows.
   */
  logSet: (sessionId: string, input: SetInput) => WorkoutSet | WorkoutRefusal;
  editSet: (sessionId: string, setId: string, patch: SetPatch) => WorkoutSet | WorkoutRefusal;
  /** Removes a set and closes the gap it leaves, in its exercise and, if it was the last, in the session. */
  deleteSet: (sessionId: string, setId: string) => void;
  /** Puts a session's exercises in this order. Exercises not named keep their order, after these. */
  reorderExercises: (sessionId: string, exerciseIds: string[]) => void;
  /**
   * The sets of an exercise from the newest session that did it, other than
   * `exceptSessionId`: what PREVIOUS shows. Read from the database each time.
   */
  lastTimeFor: (exerciseId: string, exceptSessionId: string | null) => WorkoutSet[];
  /**
   * Adds an exercise to a session, laid out like last time (or as one empty
   * set). Refuses one already in it (`taken`) or nobody knows (`notFound`).
   */
  addSessionExercise: (sessionId: string, exerciseId: string) => WorkoutSet[] | WorkoutRefusal;
  /** "Add set": one more planned set like the exercise's last (`copyLastSet`). */
  addPlannedSet: (sessionId: string, exerciseId: string) => WorkoutSet | WorkoutRefusal;
  /**
   * Lays warm-up steps out as planned sets ahead of the exercise's other sets,
   * which move down to make room. Refuses a session, or an exercise not in it,
   * that nobody knows (`notFound`). What "Use" does for a ramp that had no
   * weight to start from when the workout began.
   */
  addPlannedWarmups: (sessionId: string, exerciseId: string, steps: readonly { kg: number; reps: number }[]) => WorkoutSet[] | WorkoutRefusal;

  /**
   * Writes to Health the workouts an agent logged over MCP
   * (`WorkoutSession.healthWritePending`), which cannot reach HealthKit
   * itself. The food log's `writePendingHealthEntries`, for sessions: the same
   * guards a saved workout gets, a flag older than
   * `PENDING_WORKOUT_WRITE_MAX_AGE_DAYS` dropped unwritten, and one pass at a
   * time. Callers gate on the app being in front (`runPendingHealthWorkoutWrites`).
   */
  writePendingHealthSessions: () => Promise<void>;
  /**
   * True when Health has just refused a workout and the person has not been
   * told. Watched by `HealthWriteRefusedNotice`, which says it once; whether it
   * has already been said is `healthWorkoutWriteRefusalSeen` in settings.
   */
  pendingHealthWriteRefusal: boolean;
  setPendingHealthWriteRefusal: (pending: boolean) => void;
}

const nowIso = () => new Date().toISOString();

/** A finite number at or above zero, or null. */
const amount = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;

/** A whole number at or above zero, or null. */
const whole = (v: number | null | undefined): number | null => (amount(v) === null ? null : Math.round(v!));

/** RPE is 1 to 10, in half steps at most; anything else reads as unrated. */
const rpeOf = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 10 ? Math.round(v * 2) / 2 : null;

/** Effort is a whole number 1 to 10 (`WORKOUT_EFFORT`), as typed. */
const effortOf = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= WORKOUT_EFFORT.min && v <= WORKOUT_EFFORT.max ? Math.round(v) : null;

const byStartedDesc = (a: WorkoutSession, b: WorkoutSession) => b.startedAt.localeCompare(a.startedAt);
const bySetOrder = (a: WorkoutSet, b: WorkoutSet) => a.position - b.position || a.setIndex - b.setIndex;

/**
 * Positions 0..n in order of first appearance, and each exercise's set indexes
 * 0..k. Only the sets of one session are ever passed, which is the whole of
 * that number space, so renumbering it cannot collide with anything hidden.
 */
function renumber(sets: WorkoutSet[]): WorkoutSet[] {
  const sorted = [...sets].sort(bySetOrder);
  const positionOf = new Map<string, number>();
  const nextIndex = new Map<string, number>();
  return sorted.map(s => {
    if (!positionOf.has(s.exerciseId)) positionOf.set(s.exerciseId, positionOf.size);
    const setIndex = nextIndex.get(s.exerciseId) ?? 0;
    nextIndex.set(s.exerciseId, setIndex + 1);
    return { ...s, position: positionOf.get(s.exerciseId)!, setIndex };
  });
}

const changed = (a: WorkoutSet, b: WorkoutSet) => a.position !== b.position || a.setIndex !== b.setIndex;

/**
 * The task store, required when first used rather than imported:
 * `useTaskStore` reloads this store (so a top-level import would be a cycle),
 * and it drags in the notification and native bridges, which this store,
 * otherwise rows and arithmetic, has no reason to load. The MCP replica loads
 * this store in Node and never finishes a session, so it never reaches it.
 *
 * The rest timer is deliberately not reached from here at all: a rest belongs
 * to the live session, and `WorkoutModeHost` drops any rest whose session is
 * no longer live, however it stopped being (finished, discarded, deleted on
 * another device).
 */
function taskStore() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('./useTaskStore') as typeof import('./useTaskStore')).useTaskStore.getState();
}

let pendingHealthWriteRunning = false;

const sameSpan = (a: WorkoutSession, b: WorkoutSession) => a.startedAt === b.startedAt && a.endedAt === b.endedAt;

export const useWorkoutStore = create<WorkoutStore>((set, get) => {
  /**
   * Whether a name is already somebody's: an exercise on offer goes by it, or
   * a custom exercise does even archived. The second is the database's own
   * rule (a custom name is unique, `idx_exercises_name_key`), since archiving
   * keeps the exercise and its history; bringing it back is the way to reuse it.
   */
  const nameTaken = (name: string, exceptId: string | null): boolean => {
    const key = exerciseNameKey(name);
    return buildCatalog(get().exercises).some(e =>
      e.id !== exceptId && (!e.archived || e.isCustom) && exerciseNameKey(e.name) === key);
  };

  const putExercise = (row: Exercise) => {
    dbSaveExercise(row);
    const rest = get().exercises.filter(e => e.id !== row.id);
    set({ exercises: [...rest, row] });
  };

  const putSession = (row: WorkoutSession) => {
    dbSaveWorkoutSession(row);
    set({ sessions: [...get().sessions.filter(s => s.id !== row.id), row].sort(byStartedDesc) });
  };

  const putSets = (sessionId: string, sets: WorkoutSet[]) => {
    set({
      setsBySession: { ...get().setsBySession, [sessionId]: sets },
      setCounts: { ...get().setCounts, [sessionId]: sets.length },
    });
  };

  const exerciseKnown = (id: string) => !!libraryExercise(id) || get().exercises.some(e => e.id === id);

  /** Writes a row's Health fields back as it stands now, on disk and in memory. */
  const stampHealth = (fresh: WorkoutSession, fields: Pick<WorkoutSession, 'healthWorkoutId' | 'healthWritePending'>) => {
    putSession({ ...fresh, ...fields });
  };

  /**
   * Files what Health said about one write: the workout's id, or the one
   * refusal worth saying out loud. `recordHealthWrite` in `useFoodLogStore`,
   * for sessions, and for the same reasons.
   *
   * **The row is read again first**, since the write is a round trip and the
   * session can be deleted, edited or written by another pass meanwhile. A
   * row that is gone, already holds an id, or now spans other times takes the
   * workout just written back out; a re-timed one with no id is then written
   * again at its new times, since nothing else will.
   *
   * Only `healthWorkoutId` is kept. The sample ids the bridge can hand back
   * are always empty here (no energy is passed), so there is no column for
   * them; the watch phase that passes measured energy adds one.
   */
  const recordHealthWrite = (written: WorkoutSession, result: WorkoutWriteResult) => {
    const settings = useSettingsStore.getState();
    if (result.outcome === 'refused') {
      if (!settings.healthWorkoutWriteRefusalSeen) {
        settings.setHealthWorkoutWriteRefusalSeen(true);
        set({ pendingHealthWriteRefusal: true });
      }
      return;
    }
    // Off, unavailable, refused and a span the bridge would refuse all leave
    // the row as it is. The last matters for a workout an agent logged with no
    // length: its pending flag stays, so a length added later is written by
    // the next pass (`pendingWorkoutWriteAction` waits on it, and the limit
    // ages it out).
    if (result.outcome !== 'written') return;
    if (settings.healthWorkoutWriteRefusalSeen) settings.setHealthWorkoutWriteRefusalSeen(false);

    const ids = [result.workoutId, ...result.sampleIds].filter((id): id is string => !!id);
    const fresh = dbGetWorkoutSession(written.id);
    if (!fresh) {
      if (ids.length > 0) void retractWorkoutFromHealth(ids);
      return;
    }
    if (!sameSpan(fresh, written)) {
      // Written at times the row no longer has. Taken back out, and the row
      // written again at its own times, which replaces whatever this session
      // has in Health under its sync identifier (see `logWorkoutToHealth`).
      if (ids.length > 0) void retractWorkoutFromHealth(ids);
      if (fresh.endedAt !== null) void logWorkoutToHealth(fresh).then(next => recordHealthWrite(fresh, next));
      return;
    }
    if (fresh.healthWorkoutId !== null && fresh.healthWorkoutId !== result.workoutId) {
      // Another pass or device wrote this session meanwhile, or this is a
      // retime's rewrite landing on the row that still holds the id it
      // replaces. Both writes carry the session's id as their sync identifier,
      // so the one with the later version replaced the other rather than
      // joining it: retracting this one, as an unrelated duplicate would be,
      // would leave Health with neither. The row moves to this id, and the
      // older id is still retracted, which matches nothing once replaced and
      // removes the copy if the replacement didn't happen. A locked save has
      // no id to move to, so the row keeps the one it has.
      //
      // The version is the writing device's clock, not the order results
      // land in, so across two devices writing one session at once this can
      // pick the copy Health has already replaced. That needs both a phone and
      // an iPad running the pending pass for the same workout within one
      // round trip; returning the written version from the bridge and
      // comparing would close it.
      if (result.workoutId === null) return;
      void retractWorkoutFromHealth([fresh.healthWorkoutId]);
    }
    // A null id is a workout saved while the phone was locked: in Health, with
    // nothing to keep. The flag still clears, or the pending pass would write
    // it a second time.
    stampHealth(fresh, { healthWorkoutId: result.workoutId, healthWritePending: false });
  };

  /** Fired after a save; the session is already on disk, so nothing waits on Health. */
  const writeToHealth = (session: WorkoutSession) => {
    void logWorkoutToHealth(session).then(result => recordHealthWrite(session, result));
  };

  /** A set row from planned values, at a place the caller has worked out. */
  const plannedRow = (
    sessionId: string,
    exerciseId: string,
    position: number,
    setIndex: number,
    v: PlannedSetValues,
  ): WorkoutSet => ({
    id: generateId(),
    sessionId,
    exerciseId,
    position,
    setIndex,
    kind: v.kind,
    weightKg: amount(v.weightKg),
    reps: whole(v.reps),
    durationSeconds: whole(v.durationSeconds),
    distanceM: amount(v.distanceM),
    rpe: null,
    completedAt: null,
    supersetKey: v.supersetKey,
    note: null,
  });

  /** One set row from an input, at a place the caller has worked out. */
  const inputRow = (sessionId: string, position: number, setIndex: number, input: SetInput): WorkoutSet => ({
    id: generateId(),
    sessionId,
    exerciseId: input.exerciseId,
    position,
    setIndex,
    kind: input.kind ?? 'working',
    weightKg: amount(input.weightKg),
    reps: whole(input.reps),
    durationSeconds: whole(input.durationSeconds),
    distanceM: amount(input.distanceM),
    rpe: rpeOf(input.rpe),
    completedAt: input.completedAt === undefined ? nowIso() : input.completedAt,
    supersetKey: input.supersetKey ?? null,
    note: input.note?.trim() || null,
  });

  /**
   * Rows for a list of inputs in the order given: each exercise takes the
   * place of its first set, and its sets count from 0.
   */
  const rowsFor = (sessionId: string, inputs: SetInput[]): WorkoutSet[] => {
    const positionOf = new Map<string, number>();
    const nextIndex = new Map<string, number>();
    return inputs.map(input => {
      if (!positionOf.has(input.exerciseId)) positionOf.set(input.exerciseId, positionOf.size);
      const setIndex = nextIndex.get(input.exerciseId) ?? 0;
      nextIndex.set(input.exerciseId, setIndex + 1);
      return inputRow(sessionId, positionOf.get(input.exerciseId)!, setIndex, input);
    });
  };

  /**
   * The routines a rotation change re-files: those in the rotation that belong
   * to no program join this one, and this one's routines taken out of it are
   * freed. A routine filed under another program stays there.
   */
  const fileRotation = (program: WorkoutProgram, before: WorkoutProgram | null): WorkoutRoutine[] => {
    const inRotation = new Set(program.rotation);
    const was = new Set(before?.rotation ?? []);
    const out: WorkoutRoutine[] = [];
    for (const r of get().routines) {
      if (inRotation.has(r.id) && r.programId === null) out.push({ ...r, programId: program.id });
      else if (!inRotation.has(r.id) && was.has(r.id) && r.programId === program.id) out.push({ ...r, programId: null });
    }
    return out;
  };

  /** The routines with these rows swapped in. */
  const withRoutines = (changed: WorkoutRoutine[]): WorkoutRoutine[] => {
    if (changed.length === 0) return get().routines;
    const byId = new Map(changed.map(r => [r.id, r]));
    return get().routines.map(r => byId.get(r.id) ?? r);
  };

  /**
   * The ramp an item's warm-ups are laid out from, for an exercise: worked out
   * against the person's plates and unit, read when the workout starts.
   */
  const rampFor = (exerciseId: string, item: WorkoutRoutineItem) => {
    const info = catalogExercise(get().exercises, exerciseId);
    // A ramp is refused on any other kind when a routine is saved, but a kind
    // changed afterwards (before any set) can leave one on an item: on an
    // assisted exercise the weight is the help, and ramping it would be harder.
    if (!info || info.kind !== 'weight_reps') return () => [];
    const settings = useSettingsStore.getState();
    const ctx = loadContextFor(info, settings.plateInventory, settings.workoutUnit, item);
    return (workingKg: number | null) => rampSteps(workingKg, ctx);
  };

  /**
   * Whether any item asks for a warm-up ramp on an exercise known not to
   * record weight and reps. A ramp is a share of a working weight, so on an
   * assisted exercise it would ramp the assistance. An exercise this device
   * doesn't know yet (a custom one still syncing in) is let through.
   */
  const rampMisplaced = (items: readonly WorkoutRoutineItem[]): boolean =>
    items.some(i => i.warmupRamp === true && (catalogExercise(get().exercises, i.exerciseId)?.kind ?? 'weight_reps') !== 'weight_reps');

  return {
    exercises: [],
    routines: [],
    programs: [],
    sessions: [],
    setsBySession: {},
    setCounts: {},
    initialized: false,
    pendingHealthWriteRefusal: false,

    initialize() {
      const sessions = dbGetAllWorkoutSessions().sort(byStartedDesc);
      const live = sessions.find(s => s.endedAt === null);
      set({
        exercises: dbGetAllExercises(),
        routines: dbGetAllWorkoutRoutines(),
        programs: dbGetAllWorkoutPrograms(),
        sessions,
        // Dropped wholesale on every load: a cache from the database before a
        // sync, a restore or the demo swap describes rows that may not exist.
        setsBySession: live ? { [live.id]: dbGetWorkoutSets(live.id) } : {},
        setCounts: dbCountWorkoutSetsBySession(),
        initialized: true,
      });
    },

    addExercise(input) {
      const name = cleanWorkoutName(input.name);
      if (!name) return 'blank';
      if (nameTaken(name, null)) return 'taken';
      const row: Exercise = {
        id: generateId(),
        name,
        kind: input.kind,
        primaryMuscles: readMuscles(input.primaryMuscles),
        secondaryMuscles: readMuscles(input.secondaryMuscles ?? []),
        equipment: input.equipment,
        barKg: amount(input.barKg) || null,
        notes: input.notes?.trim() ?? '',
        archived: false,
        isCustom: true,
        createdAt: nowIso(),
      };
      putExercise(row);
      return row;
    },

    updateExercise(id, patch) {
      const lib = libraryExercise(id);
      const existing = get().exercises.find(e => e.id === id);
      if (!lib && !existing) return 'notFound';
      let name = existing?.name ?? lib!.name;
      if (patch.name !== undefined) {
        name = cleanWorkoutName(patch.name);
        if (!name) return 'blank';
        if (nameTaken(name, id)) return 'taken';
      }
      const base: Exercise = existing ?? {
        // The first change to a built-in writes the row that carries it, with
        // the library's description of the movement beside the person's words.
        id,
        name: lib!.name,
        kind: lib!.kind,
        primaryMuscles: [...lib!.primaryMuscles],
        secondaryMuscles: [...lib!.secondaryMuscles],
        equipment: lib!.equipment,
        barKg: null,
        notes: '',
        archived: false,
        isCustom: false,
        createdAt: nowIso(),
      };
      const custom = base.isCustom;
      // What a set records is fixed once a set exists: a logged 60 kg × 8 read
      // as a duration or a distance would have nothing to show, and the
      // records, volume and progression all read the old shape. The sets of
      // another device are not here to be counted, the same limit
      // `deleteExercise` has.
      if (custom && patch.kind !== undefined && patch.kind !== base.kind && dbGetWorkoutSetsForExercise(id).length > 0) {
        return 'hasHistory';
      }
      const row: Exercise = {
        ...base,
        name,
        notes: patch.notes !== undefined ? patch.notes.trim() : base.notes,
        barKg: patch.barKg !== undefined ? amount(patch.barKg) || null : base.barKg,
        archived: patch.archived ?? base.archived,
        // What the movement is belongs to the library for a built-in.
        ...(custom ? {
          kind: patch.kind ?? base.kind,
          equipment: patch.equipment ?? base.equipment,
          primaryMuscles: patch.primaryMuscles ? readMuscles(patch.primaryMuscles) : base.primaryMuscles,
          secondaryMuscles: patch.secondaryMuscles ? readMuscles(patch.secondaryMuscles) : base.secondaryMuscles,
        } : {}),
      };
      putExercise(row);
      return row;
    },

    deleteExercise(id) {
      const existing = get().exercises.find(e => e.id === id);
      if (!existing) return libraryExercise(id) ? true : 'notFound';
      if (existing.isCustom) {
        if (!existing.archived) putExercise({ ...existing, archived: true });
        return true;
      }
      dbDeleteExercise(id);
      set({ exercises: get().exercises.filter(e => e.id !== id) });
      return true;
    },

    addRoutine(name, items = [], programId = null) {
      const clean = cleanWorkoutName(name);
      if (!clean) return 'blank';
      const routines = get().routines;
      const read = readRoutineItems(items);
      if (rampMisplaced(read)) return 'rampKind';
      const row: WorkoutRoutine = {
        id: generateId(),
        name: clean,
        notes: '',
        programId,
        sortOrder: routines.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1,
        items: read,
        createdAt: nowIso(),
      };
      dbSaveWorkoutRoutine(row);
      set({ routines: [...routines, row] });
      return row;
    },

    updateRoutine(id, patch) {
      const existing = get().routines.find(r => r.id === id);
      if (!existing) return 'notFound';
      let name = existing.name;
      if (patch.name !== undefined) {
        name = cleanWorkoutName(patch.name);
        if (!name) return 'blank';
      }
      const items = patch.items !== undefined ? readRoutineItems(patch.items) : existing.items;
      if (patch.items !== undefined && rampMisplaced(items)) return 'rampKind';
      const row: WorkoutRoutine = {
        ...existing,
        name,
        notes: patch.notes !== undefined ? patch.notes.trim() : existing.notes,
        programId: patch.programId !== undefined ? patch.programId : existing.programId,
        items,
      };
      dbSaveWorkoutRoutine(row);
      set({ routines: get().routines.map(r => (r.id === id ? row : r)) });
      return row;
    },

    deleteRoutine(id) {
      const touched = get().programs
        .filter(p => p.rotation.includes(id))
        .map(p => ({ ...p, rotation: p.rotation.filter(r => r !== id) }));
      dbTransaction(() => {
        dbDeleteWorkoutRoutine(id);
        for (const p of touched) dbSaveWorkoutProgram(p);
      });
      const byId = new Map(touched.map(p => [p.id, p]));
      set({
        routines: get().routines.filter(r => r.id !== id),
        programs: get().programs.map(p => byId.get(p.id) ?? p),
      });
    },

    addProgram(input) {
      const name = cleanWorkoutName(input.name);
      if (!name) return 'blank';
      const row: WorkoutProgram = {
        id: generateId(),
        name,
        weeks: input.weeks && input.weeks > 0 ? Math.round(input.weeks) : null,
        rotation: (input.rotation ?? []).filter(Boolean),
        scheme: input.scheme ?? 'double',
        trainingMaxes: readTrainingMaxes(input.trainingMaxes ?? []),
        startedAt: null,
        archived: false,
        createdAt: nowIso(),
      };
      const filed = input.rotation !== undefined ? fileRotation(row, null) : [];
      dbTransaction(() => {
        dbSaveWorkoutProgram(row);
        for (const r of filed) dbSaveWorkoutRoutine(r);
      });
      set({ programs: [...get().programs, row], routines: withRoutines(filed) });
      return row;
    },

    addLibraryProgram(key) {
      const lib = libraryProgram(key);
      if (!lib) return 'notFound';
      const programId = generateId();
      let order = get().routines.reduce((max, r) => Math.max(max, r.sortOrder), -1);
      // Adding one a second time makes a second set of routines and a second
      // program, so a name already held gets "(2)" rather than a twin.
      const heldRoutines = get().routines.map(r => r.name);
      const routines: WorkoutRoutine[] = lib.routines.map(r => ({
        id: generateId(),
        name: (() => { const free = freeWorkoutName(r.name, heldRoutines); heldRoutines.push(free); return free; })(),
        notes: '',
        programId,
        sortOrder: ++order,
        items: readRoutineItems(r.items),
        createdAt: nowIso(),
      }));
      const program: WorkoutProgram = {
        id: programId,
        name: freeWorkoutName(lib.name, get().programs.map(p => p.name)),
        weeks: lib.weeks,
        rotation: routines.map(r => r.id),
        scheme: lib.scheme,
        trainingMaxes: [],
        startedAt: null,
        archived: false,
        createdAt: nowIso(),
      };
      dbTransaction(() => {
        for (const r of routines) dbSaveWorkoutRoutine(r);
        dbSaveWorkoutProgram(program);
      });
      set({ routines: [...get().routines, ...routines], programs: [...get().programs, program] });
      return { program, routines };
    },

    updateProgram(id, patch) {
      const existing = get().programs.find(p => p.id === id);
      if (!existing) return 'notFound';
      let name = existing.name;
      if (patch.name !== undefined) {
        name = cleanWorkoutName(patch.name);
        if (!name) return 'blank';
      }
      const row: WorkoutProgram = {
        ...existing,
        name,
        weeks: patch.weeks !== undefined ? (patch.weeks && patch.weeks > 0 ? Math.round(patch.weeks) : null) : existing.weeks,
        rotation: patch.rotation !== undefined ? patch.rotation.filter(Boolean) : existing.rotation,
        scheme: patch.scheme ?? existing.scheme,
        trainingMaxes: patch.trainingMaxes !== undefined ? readTrainingMaxes(patch.trainingMaxes) : existing.trainingMaxes,
        startedAt: patch.startedAt !== undefined ? patch.startedAt : existing.startedAt,
        archived: patch.archived ?? existing.archived,
      };
      const filed = patch.rotation !== undefined ? fileRotation(row, existing) : [];
      dbTransaction(() => {
        dbSaveWorkoutProgram(row);
        for (const r of filed) dbSaveWorkoutRoutine(r);
      });
      set({ programs: get().programs.map(p => (p.id === id ? row : p)), routines: withRoutines(filed) });
      return row;
    },

    deleteProgram(id) {
      const freed = get().routines.filter(r => r.programId === id).map(r => ({ ...r, programId: null }));
      dbTransaction(() => {
        dbDeleteWorkoutProgram(id);
        for (const r of freed) dbSaveWorkoutRoutine(r);
      });
      const byId = new Map(freed.map(r => [r.id, r]));
      set({
        programs: get().programs.filter(p => p.id !== id),
        routines: get().routines.map(r => byId.get(r.id) ?? r),
      });
    },

    liveSession() {
      return get().sessions.find(s => s.endedAt === null) ?? null;
    },

    startSession(input = {}) {
      if (get().liveSession()) return 'live';
      const routine = input.routineId ? get().routines.find(r => r.id === input.routineId) : undefined;
      const row: WorkoutSession = {
        id: generateId(),
        routineId: input.routineId ?? null,
        programId: input.programId ?? routine?.programId ?? null,
        taskId: input.taskId ?? null,
        title: cleanWorkoutName(input.title ?? '') || routine?.name || 'Workout',
        startedAt: (input.at ?? new Date()).toISOString(),
        endedAt: null,
        notes: '',
        effort: null,
        healthWorkoutId: null,
        healthWritePending: false,
      };
      putSession(row);
      const planned = routine
        ? get().plannedSetsForRoutine(routine.id, row.id).map(p => plannedRow(row.id, p.exerciseId, p.position, p.setIndex, p.values))
        : [];
      if (planned.length > 0) dbSaveWorkoutSets(planned);
      putSets(row.id, planned);
      return row;
    },

    plannedSetsForRoutine(routineId, exceptSessionId = null) {
      const routine = get().routines.find(r => r.id === routineId);
      const planned: PlannedRoutineSet[] = [];
      for (const item of routine?.items ?? []) {
        if (!exerciseKnown(item.exerciseId) || planned.some(p => p.exerciseId === item.exerciseId)) continue;
        const position = planned.length === 0 ? 0 : planned[planned.length - 1].position + 1;
        const last = previousSets(dbGetWorkoutSetsForExercise(item.exerciseId), get().sessions, exceptSessionId);
        const ramp = item.warmupRamp ? rampFor(item.exerciseId, item) : undefined;
        plannedSetsFor(item, last, ramp).forEach((values, setIndex) =>
          planned.push({ exerciseId: item.exerciseId, position, setIndex, values }));
      }
      return planned;
    },

    updateSession(id, patch) {
      const existing = get().sessions.find(s => s.id === id);
      if (!existing) return 'notFound';
      let title = existing.title;
      if (patch.title !== undefined) {
        title = cleanWorkoutName(patch.title);
        if (!title) return 'blank';
      }
      const row: WorkoutSession = {
        ...existing,
        title,
        notes: patch.notes !== undefined ? patch.notes.trim() : existing.notes,
        effort: patch.effort !== undefined ? effortOf(patch.effort) : existing.effort,
        startedAt: patch.startedAt ?? existing.startedAt,
        endedAt: patch.endedAt !== undefined ? patch.endedAt : existing.endedAt,
      };
      if (row.endedAt !== null && new Date(row.endedAt).getTime() < new Date(row.startedAt).getTime()) return 'order';
      // A patch that changes nothing writes nothing. Saving the row anyway
      // restamps it as a local change, and a sync then sends this copy over
      // one a peer has changed since (an agent's sets-only edit sending a
      // stale, unwritten copy over the phone's Health id is how a workout got
      // into Health twice).
      if (row.title === existing.title && row.notes === existing.notes && row.effort === existing.effort && sameSpan(row, existing)) {
        return existing;
      }
      // Health holds the span and nothing else, so only a finished workout in
      // Health whose times moved is rewritten, and only while writing is on:
      // with it off an edit leaves Health alone. A workout never written stays
      // unwritten (an imported one, or one saved with the switch off), since
      // an edit is not the person asking for it to be shared.
      //
      // **The row keeps the old id until the rewrite lands.** Cleared up
      // front, the workout read as not in Health for the round trip: a second
      // edit in that window started no rewrite of its own and skipped the
      // page's one-day check, and a rewrite Health then refused left the old
      // workout there with nothing pointing at it. `recordHealthWrite` moves
      // the row to the new id when the write lands (its take-over branch);
      // when it doesn't, the old id goes only if the retract took it out.
      const stale = existing.healthWorkoutId;
      const retimed = existing.endedAt !== null && row.endedAt !== null && !sameSpan(existing, row);
      const rewrite = retimed && stale !== null && workoutHealthWriteOn();
      putSession(row);
      if (rewrite) {
        void (async () => {
          // In that order, and the write happens either way: a retract that
          // fails leaves the old workout for the person to remove in Health,
          // which beats Health holding neither.
          const retracted = await retractWorkoutFromHealth([stale]);
          const result = await logWorkoutToHealth(row);
          recordHealthWrite(row, result);
          if (result.outcome === 'written' || !retracted) return;
          const fresh = dbGetWorkoutSession(row.id);
          if (fresh && fresh.healthWorkoutId === stale) stampHealth(fresh, { healthWorkoutId: null, healthWritePending: fresh.healthWritePending });
        })();
      }
      return row;
    },

    finishSession(id, options = {}) {
      const existing = get().sessions.find(s => s.id === id);
      if (!existing) return 'notFound';
      if (existing.endedAt !== null) return 'finished';
      const { completeLinkedTask = true, ...patch } = options;
      // Refuse an end before the start (or a start after the end) before the
      // plan's unfinished sets are deleted, or a refused finish leaves the
      // session live with its plan gone.
      const endedAt = patch.endedAt ?? nowIso();
      if (new Date(endedAt).getTime() < new Date(patch.startedAt ?? existing.startedAt).getTime()) return 'order';
      const sets = get().loadSets(id);
      const { dropSetIds } = finishPlan(sets);
      if (dropSetIds.length > 0) {
        const before = new Map(sets.map(s => [s.id, s]));
        const kept = renumber(sets.filter(s => !dropSetIds.includes(s.id)));
        dbTransaction(() => {
          for (const setId of dropSetIds) dbDeleteWorkoutSet(setId);
          dbSaveWorkoutSets(kept.filter(s => changed(s, before.get(s.id)!)));
        });
        putSets(id, kept);
      }
      const finished = get().updateSession(id, { ...patch, endedAt });
      if (typeof finished === 'string') return finished;
      // The task occurrence it was started from, answered the way its own
      // checkbox would answer it (`workoutTaskEffect`): completed, with coins,
      // streak and successor, or one unit logged on a target. A task already
      // ticked, archived or deleted since is left alone, and so is one that
      // asks a question, unless workout mode has asked it.
      if (completeLinkedTask && existing.taskId) {
        const tasks = taskStore();
        const task = tasks.tasks.find(t => t.id === existing.taskId) ?? null;
        const effect = workoutTaskEffect(task);
        if (effect === 'complete') tasks.completeTask(task!.id);
        else if (effect === 'log-unit') tasks.logQuotaUnit(task!.id);
      }
      writeToHealth(finished);
      return finished;
    },

    addFinishedSession(input) {
      if (input.sets.length === 0) return 'empty';
      if (input.sets.some(st => !exerciseKnown(st.exerciseId))) return 'notFound';
      if (new Date(input.endedAt).getTime() < new Date(input.startedAt).getTime()) return 'order';
      const routine = input.routineId ? get().routines.find(r => r.id === input.routineId) : undefined;
      const session: WorkoutSession = {
        id: generateId(),
        routineId: routine?.id ?? null,
        programId: routine?.programId ?? null,
        taskId: null,
        title: cleanWorkoutName(input.title ?? '') || routine?.name || 'Workout',
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        notes: input.notes?.trim() ?? '',
        effort: effortOf(input.effort),
        healthWorkoutId: null,
        healthWritePending: input.healthWritePending === true,
      };
      // Done when it ended unless a set says otherwise: a set logged after the
      // fact was done, and a planned set has no place in a record.
      const sets = rowsFor(session.id, input.sets.map(st => ({ ...st, completedAt: st.completedAt ?? input.endedAt })));
      dbTransaction(() => {
        dbSaveWorkoutSession(session);
        dbSaveWorkoutSets(sets);
      });
      set({ sessions: [...get().sessions, session].sort(byStartedDesc) });
      putSets(session.id, sets);
      return { session, sets };
    },

    addWatchSession(input, now = new Date()) {
      // A repeat delivery (the watch sends a finished workout once, but a
      // transfer and the message that wakes the phone can both arrive).
      const existing = get().sessions.find(s => s.id === input.id) ?? dbGetWorkoutSession(input.id);
      if (existing) return { session: existing, sets: [], duplicate: true, clashesWith: [] };
      if (input.sets.length === 0) return 'empty';
      const startMs = Date.parse(input.startedAt);
      const endMs = Date.parse(input.endedAt);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 'order';
      const routine = input.routineId ? get().routines.find(r => r.id === input.routineId) : undefined;
      // A watch clock that read an end before its start loses nothing: the
      // workout is kept, as long as it took no time.
      const endedAt = new Date(Math.max(startMs, endMs)).toISOString();
      const session: WorkoutSession = {
        id: input.id,
        // Provenance, kept as the watch sent it even when the routine has gone
        // since: every reader resolves it or shrugs.
        routineId: input.routineId,
        programId: input.programId ?? routine?.programId ?? null,
        taskId: input.taskId,
        title: cleanWorkoutName(input.title) || routine?.name || 'Workout',
        startedAt: new Date(startMs).toISOString(),
        endedAt,
        notes: '',
        effort: null,
        healthWorkoutId: null,
        healthWritePending: false,
      };
      const sets = renumber(input.sets.map((st): WorkoutSet => ({
        id: st.id,
        sessionId: session.id,
        exerciseId: st.exerciseId,
        position: st.position,
        setIndex: st.setIndex,
        kind: st.kind,
        weightKg: amount(st.weightKg),
        reps: whole(st.reps),
        durationSeconds: whole(st.durationSeconds),
        distanceM: amount(st.distanceM),
        rpe: null,
        completedAt: st.completedAt,
        supersetKey: null,
        note: null,
      })));
      const clashesWith = overlappingSessions(session, get().sessions, now);
      dbTransaction(() => {
        dbSaveWorkoutSession(session);
        dbSaveWorkoutSets(sets);
      });
      set({ sessions: [...get().sessions, session].sort(byStartedDesc) });
      putSets(session.id, sets);
      const clashes = useWatchClashStore.getState();
      for (const otherSessionId of clashesWith) clashes.record({ watchSessionId: session.id, otherSessionId });
      // The task it was started for, answered as `finishSession` answers it,
      // with two differences for a workout that can arrive days late: a
      // completion is stamped when the workout ended, and a target's unit is
      // logged only when it ended today, since the rollover has already closed
      // an earlier day's count. A task that asks a question is the caller's to
      // hand to the app (planQuietTaps does), since nothing here can ask.
      if (session.taskId) {
        const tasks = taskStore();
        const task = tasks.tasks.find(t => t.id === session.taskId) ?? null;
        const effect = workoutTaskEffect(task);
        const { dayResetTime } = useSettingsStore.getState();
        const endedToday = getLogicalDayKey(new Date(endedAt), dayResetTime) === getLogicalDayKey(now, dayResetTime);
        if (effect === 'complete') tasks.completeTask(task!.id, { completedAt: endedAt });
        else if (effect === 'log-unit' && endedToday) tasks.logQuotaUnit(task!.id);
      }
      writeToHealth(session);
      return { session, sets, duplicate: false, clashesWith };
    },

    importSessions(sessions, creates) {
      // Exercises first, in memory: a set names one by the id it will have.
      const created: Exercise[] = [];
      const idForKey = new Map<string, string>();
      const resolve = (ref: string): string | null => {
        if (!ref.startsWith(NEW_EXERCISE_PREFIX)) return exerciseKnown(ref) ? ref : null;
        const key = ref.slice(NEW_EXERCISE_PREFIX.length);
        const known = idForKey.get(key);
        if (known) return known;
        const input = creates[key];
        if (!input) return null;
        const name = cleanWorkoutName(input.name);
        if (!name) return null;
        const holder = buildCatalog(get().exercises).find(e => exerciseNameKey(e.name) === exerciseNameKey(name));
        if (holder) { idForKey.set(key, holder.id); return holder.id; }
        const row: Exercise = {
          id: generateId(),
          name,
          kind: input.kind,
          primaryMuscles: readMuscles(input.primaryMuscles),
          secondaryMuscles: readMuscles(input.secondaryMuscles ?? []),
          equipment: input.equipment,
          barKg: null,
          notes: input.notes?.trim() ?? '',
          archived: false,
          isCustom: true,
          createdAt: nowIso(),
        };
        created.push(row);
        idForKey.set(key, row.id);
        return row.id;
      };

      const index = indexExisting(get().sessions);
      const rows: WorkoutSession[] = [];
      const setRows: WorkoutSet[][] = [];
      let duplicates = 0;
      for (const planned of sessions) {
        if (indexHas(index, planned)) { duplicates++; continue; }
        const inputs: SetInput[] = [];
        for (const st of planned.sets) {
          const exerciseId = resolve(st.exerciseRef);
          if (!exerciseId) continue;
          inputs.push({
            exerciseId, kind: st.kind, weightKg: st.weightKg, reps: st.reps,
            durationSeconds: st.durationSeconds, distanceM: st.distanceM, rpe: st.rpe,
            supersetKey: st.supersetKey, note: st.note, completedAt: planned.endedAt,
          });
        }
        if (inputs.length === 0) continue;
        indexAdd(index, planned.id, planned.startedAt);
        rows.push({
          id: planned.id,
          routineId: null,
          programId: null,
          taskId: null,
          title: cleanWorkoutName(planned.title) || 'Workout',
          startedAt: planned.startedAt,
          endedAt: planned.endedAt,
          notes: planned.notes.trim(),
          effort: null,
          healthWorkoutId: null,
          healthWritePending: false,
        });
        setRows.push(rowsFor(planned.id, inputs));
      }
      if (rows.length === 0) return { sessions: 0, sets: 0, created: 0, duplicates };

      dbTransaction(() => {
        for (const e of created) dbSaveExercise(e);
        rows.forEach((session, i) => {
          dbSaveWorkoutSession(session);
          dbSaveWorkoutSets(setRows[i]);
        });
      });
      set({
        exercises: [...get().exercises, ...created],
        sessions: [...get().sessions, ...rows].sort(byStartedDesc),
      });
      rows.forEach((session, i) => putSets(session.id, setRows[i]));
      return { sessions: rows.length, sets: setRows.reduce((n, r) => n + r.length, 0), created: created.length, duplicates };
    },

    replaceSets(sessionId, inputs) {
      const session = get().sessions.find(s => s.id === sessionId);
      if (!session) return 'notFound';
      if (inputs.some(st => !exerciseKnown(st.exerciseId))) return 'notFound';
      const old = get().loadSets(sessionId);
      const done = session.endedAt ?? nowIso();
      const sets = rowsFor(sessionId, inputs.map(st => ({ ...st, completedAt: st.completedAt ?? done })));
      dbTransaction(() => {
        for (const s of old) dbDeleteWorkoutSet(s.id);
        dbSaveWorkoutSets(sets);
      });
      putSets(sessionId, sets);
      return sets;
    },

    deleteSession(id) {
      // Read from the database before the row goes, since the id is on it:
      // a workout left in Health with nothing pointing at it is a record the
      // person deleted here and still has there. Nothing is awaited and nothing
      // is undone on failure; Health's own record is theirs to delete there.
      const written = dbGetWorkoutSession(id)?.healthWorkoutId ?? null;
      if (written) void retractWorkoutFromHealth([written]);
      dbDeleteWorkoutSession(id);
      const { [id]: _sets, ...setsBySession } = get().setsBySession;
      const { [id]: _count, ...setCounts } = get().setCounts;
      set({ sessions: get().sessions.filter(s => s.id !== id), setsBySession, setCounts });
    },

    discardSession() {
      const live = get().liveSession();
      if (live) get().deleteSession(live.id);
    },

    async writePendingHealthSessions() {
      if (pendingHealthWriteRunning) return;
      pendingHealthWriteRunning = true;
      try {
        for (const session of dbGetPendingHealthWorkoutSessions()) {
          const action = pendingWorkoutWriteAction(session);
          if (action === 'drop') {
            const fresh = dbGetWorkoutSession(session.id);
            if (fresh?.healthWritePending) stampHealth(fresh, { healthWorkoutId: fresh.healthWorkoutId, healthWritePending: false });
            continue;
          }
          // No length yet: flagged until one arrives or the limit passes.
          if (action === 'wait') continue;
          // Off, unavailable and refused leave the flag, so turning writing on
          // the same week still sends it.
          recordHealthWrite(session, await logWorkoutToHealth(session));
        }
      } finally {
        pendingHealthWriteRunning = false;
      }
    },

    setPendingHealthWriteRefusal(pending) {
      set({ pendingHealthWriteRefusal: pending });
    },

    loadSets(sessionId) {
      const cached = get().setsBySession[sessionId];
      if (cached) return cached;
      const sets = dbGetWorkoutSets(sessionId);
      putSets(sessionId, sets);
      return sets;
    },

    exerciseHistory(exerciseId) {
      return dbGetWorkoutSetsForExercise(exerciseId);
    },

    allSets() {
      return dbGetAllDoneWorkoutSets();
    },

    logSet(sessionId, input) {
      if (!get().sessions.some(s => s.id === sessionId)) return 'notFound';
      if (!exerciseKnown(input.exerciseId)) return 'notFound';
      const sets = get().loadSets(sessionId);
      const same = sets.filter(s => s.exerciseId === input.exerciseId);
      const position = same.length > 0
        ? same[0].position
        : sets.reduce((max, s) => Math.max(max, s.position), -1) + 1;
      const row: WorkoutSet = {
        id: generateId(),
        sessionId,
        exerciseId: input.exerciseId,
        position,
        setIndex: same.reduce((max, s) => Math.max(max, s.setIndex), -1) + 1,
        kind: input.kind ?? 'working',
        weightKg: amount(input.weightKg),
        reps: whole(input.reps),
        durationSeconds: whole(input.durationSeconds),
        distanceM: amount(input.distanceM),
        rpe: rpeOf(input.rpe),
        completedAt: input.completedAt === undefined ? nowIso() : input.completedAt,
        supersetKey: input.supersetKey ?? null,
        note: input.note?.trim() || null,
      };
      dbSaveWorkoutSet(row);
      putSets(sessionId, [...sets, row].sort(bySetOrder));
      return row;
    },

    editSet(sessionId, setId, patch) {
      const sets = get().loadSets(sessionId);
      const existing = sets.find(s => s.id === setId);
      if (!existing) return 'notFound';
      const row: WorkoutSet = {
        ...existing,
        kind: patch.kind ?? existing.kind,
        weightKg: patch.weightKg !== undefined ? amount(patch.weightKg) : existing.weightKg,
        reps: patch.reps !== undefined ? whole(patch.reps) : existing.reps,
        durationSeconds: patch.durationSeconds !== undefined ? whole(patch.durationSeconds) : existing.durationSeconds,
        distanceM: patch.distanceM !== undefined ? amount(patch.distanceM) : existing.distanceM,
        rpe: patch.rpe !== undefined ? rpeOf(patch.rpe) : existing.rpe,
        supersetKey: patch.supersetKey !== undefined ? patch.supersetKey : existing.supersetKey,
        note: patch.note !== undefined ? patch.note?.trim() || null : existing.note,
        completedAt: patch.completedAt !== undefined ? patch.completedAt : existing.completedAt,
      };
      dbSaveWorkoutSet(row);
      putSets(sessionId, sets.map(s => (s.id === setId ? row : s)));
      return row;
    },

    deleteSet(sessionId, setId) {
      const sets = get().loadSets(sessionId);
      if (!sets.some(s => s.id === setId)) return;
      const before = new Map(sets.map(s => [s.id, s]));
      const next = renumber(sets.filter(s => s.id !== setId));
      dbTransaction(() => {
        dbDeleteWorkoutSet(setId);
        dbSaveWorkoutSets(next.filter(s => changed(s, before.get(s.id)!)));
      });
      putSets(sessionId, next);
    },

    lastTimeFor(exerciseId, exceptSessionId) {
      return previousSets(dbGetWorkoutSetsForExercise(exerciseId), get().sessions, exceptSessionId);
    },

    addSessionExercise(sessionId, exerciseId) {
      if (!get().sessions.some(s => s.id === sessionId)) return 'notFound';
      if (!exerciseKnown(exerciseId)) return 'notFound';
      const sets = get().loadSets(sessionId);
      if (sets.some(s => s.exerciseId === exerciseId)) return 'taken';
      const position = sets.reduce((max, s) => Math.max(max, s.position), -1) + 1;
      const added = plannedSetsFromHistory(get().lastTimeFor(exerciseId, sessionId))
        .map((v, i) => plannedRow(sessionId, exerciseId, position, i, v));
      dbSaveWorkoutSets(added);
      putSets(sessionId, [...sets, ...added].sort(bySetOrder));
      return added;
    },

    addPlannedSet(sessionId, exerciseId) {
      const sets = get().loadSets(sessionId);
      const mine = sets.filter(s => s.exerciseId === exerciseId);
      if (mine.length === 0) return 'notFound';
      const v = copyLastSet(mine);
      return get().logSet(sessionId, {
        exerciseId,
        kind: v.kind,
        weightKg: v.weightKg,
        reps: v.reps,
        durationSeconds: v.durationSeconds,
        distanceM: v.distanceM,
        supersetKey: v.supersetKey,
        completedAt: null,
      });
    },

    addPlannedWarmups(sessionId, exerciseId, steps) {
      if (!get().sessions.some(s => s.id === sessionId)) return 'notFound';
      const sets = get().loadSets(sessionId);
      const mine = sets.filter(s => s.exerciseId === exerciseId);
      if (mine.length === 0) return 'notFound';
      if (steps.length === 0) return [];
      const added = steps.map((step, i) => plannedRow(sessionId, exerciseId, mine[0].position, i, {
        kind: 'warmup', weightKg: step.kg, reps: step.reps, durationSeconds: null, distanceM: null, supersetKey: mine[0].supersetKey,
      }));
      const shifted = sets.map(s => (s.exerciseId === exerciseId ? { ...s, setIndex: s.setIndex + steps.length } : s));
      dbSaveWorkoutSets([...added, ...shifted.filter(s => s.exerciseId === exerciseId)]);
      putSets(sessionId, [...shifted, ...added].sort(bySetOrder));
      return added;
    },

    reorderExercises(sessionId, exerciseIds) {
      const sets = get().loadSets(sessionId);
      const rank = new Map(exerciseIds.map((id, i) => [id, i]));
      const present = [...new Set([...sets].sort(bySetOrder).map(s => s.exerciseId))];
      const order = [
        ...present.filter(id => rank.has(id)).sort((a, b) => rank.get(a)! - rank.get(b)!),
        ...present.filter(id => !rank.has(id)),
      ];
      const positionOf = new Map(order.map((id, i) => [id, i]));
      const before = new Map(sets.map(s => [s.id, s]));
      const next = sets.map(s => ({ ...s, position: positionOf.get(s.exerciseId)! })).sort(bySetOrder);
      dbSaveWorkoutSets(next.filter(s => changed(s, before.get(s.id)!)));
      putSets(sessionId, next);
    },
  };
});

/**
 * How many things the person made in the Workouts area: sessions, routines,
 * programs and custom exercises. What simplified mode reads to decide whether
 * the screen holds anything it would strand (see `screenShown`). A selector,
 * so a caller subscribing to it re-renders only when the number moves.
 */
export function workoutContentCount(s: Pick<WorkoutStore, 'sessions' | 'routines' | 'programs' | 'exercises'>): number {
  return s.sessions.length + s.routines.length + s.programs.length + s.exercises.filter(e => e.isCustom).length;
}
