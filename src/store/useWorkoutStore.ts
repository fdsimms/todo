import { create } from 'zustand';
import type {
  Exercise,
  ExerciseEquipment,
  ExerciseKind,
  MuscleGroup,
  ProgressionScheme,
  TrainingMax,
  RoutineVersionSource,
  WorkoutProgram,
  WorkoutProgramVersion,
  WorkoutRoutine,
  WorkoutRoutineItem,
  WorkoutRoutineVersion,
  WorkoutSession,
  WorkoutSet,
  WorkoutSetKind,
} from '../types';
import {
  dbCountWorkoutSetsBySession,
  dbWorkoutLiftVolumes,
  dbDeleteExercise,
  dbDeleteProgramVersion,
  dbDeleteRoutineVersion,
  dbDeleteWorkoutProgram,
  dbDeleteWorkoutRoutine,
  dbDeleteWorkoutSession,
  dbDeleteWorkoutSet,
  dbGetAllDoneWorkoutSets,
  dbGetAllExercises,
  dbGetAllProgramVersions,
  dbGetAllRoutineVersions,
  dbGetAllWorkoutPrograms,
  dbGetAllWorkoutRoutines,
  dbGetAllWorkoutSessions,
  dbGetPendingHealthWorkoutSessions,
  dbGetSetting,
  dbGetWorkoutSession,
  dbGetWorkoutSets,
  dbGetWorkoutSetsForExercise,
  dbSaveExercise,
  dbSaveProgramVersion,
  dbSaveRoutineVersion,
  dbSaveWorkoutProgram,
  dbSaveWorkoutRoutine,
  dbSaveWorkoutSession,
  dbSaveWorkoutSet,
  dbSaveWorkoutSets,
  dbSetSetting,
  dbTransaction,
} from '../db/database';
import { generateId } from '../utils/id';
import { rotationPickFor, workoutTaskEffect } from '../utils/workoutTask';
import { swappableSets } from '../utils/exerciseSwap';
import { exerciseDayNotePatches } from '../utils/exerciseDayNote';
import {
  copyLastSet,
  finishPlan,
  joinedSuperset,
  leftSuperset,
  matchPrevious,
  movedExerciseOrder,
  plannedSetsFor,
  plannedSetsFromHistory,
  previousSets,
  sessionExercises,
  type PlannedSetValues,
  type PlacedPlannedSet,
} from '../utils/workoutSession';
import { libraryExercise } from '../utils/exerciseLibrary';
import { loadContextFor, rampSteps } from '../utils/workoutProgression';
import { libraryProgram } from '../utils/workoutProgramLibrary';
import { groupNames, renamedRegistry, resolveGroupName } from '../utils/routineGroups';
import { slotUpdates } from '../utils/projectOrder';
import {
  currentProgramVersion,
  currentRoutineVersion,
  implicitProgramVersion,
  implicitRoutineVersion,
  programStructureChanged,
  programVersionTrained,
  programVersionsOf,
  routineContentChanged,
  routineVersionTrained,
  routineVersionsOf,
  sessionVersionId,
  versionCopyName,
  versionNumber,
} from '../utils/routineVersions';
import { useSettingsStore } from './useSettingsStore';
import {
  PENDING_WORKOUT_WRITE_MAX_AGE_DAYS,
  dropWatchMeasurement,
  logWorkoutToHealth,
  pendingWorkoutWriteAction,
  retractWatchWorkouts,
  retractWorkoutFromHealth,
  workoutHealthWriteOn,
  workoutSpanWritable,
  type WorkoutWriteResult,
} from '../utils/healthWorkoutSync';
import { NEW_EXERCISE_PREFIX, indexAdd, indexExisting, indexHas, type PlannedImportSession } from '../utils/workoutCsv';
import { overlappingSessions } from '../utils/watchWorkoutClash';
import { watchCopyStale, type WatchWorkoutSpan } from '../utils/watchHealthWorkout';
import { getCurrentDayStart, getLogicalDayKey } from '../utils/dateUtils';
import { useWatchClashStore } from './useWatchClashStore';
import { buildCatalog, catalogExercise } from '../utils/exerciseCatalog';
import { liftVolumeKg } from '../utils/workoutRecords';
import {
  cleanOtherNames,
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
  dumbbells?: 1 | 2 | null;
  loadEntry?: 'each' | 'pair' | null;
  notes?: string;
  /** Other names it is known by. Cleaned (`cleanOtherNames`), and refused if another exercise already goes by one. */
  otherNames?: string[];
}

/** What an edit may change. On a built-in exercise only `name`, `otherNames`, `notes`, `barKg`, `dumbbells`, `loadEntry` and `archived` take effect. */
export type ExercisePatch = Partial<Omit<ExerciseInput, 'secondaryMuscles'>> & {
  secondaryMuscles?: MuscleGroup[];
  archived?: boolean;
};

export interface RoutinePatch {
  name?: string;
  notes?: string;
  programId?: string | null;
  items?: WorkoutRoutineItem[];
  /** A name files it under that heading (spelled as an existing group is, if one matches); null or blank takes it out of its group. */
  groupName?: string | null;
  archived?: boolean;
}

export interface ProgramInput {
  name: string;
  weeks?: number | null;
  rotation?: string[];
  scheme?: ProgressionScheme | null;
  trainingMaxes?: TrainingMax[];
}

export type ProgramPatch = Partial<ProgramInput> & { startedAt?: string | null; archived?: boolean };

/**
 * How a save that changes a routine's plan (or a program's structure) is
 * kept. `new` starts a version and `amend` changes the current one in place;
 * `auto` amends until a workout has been finished on the current version and
 * starts a new one after, which is what anything that can't ask does (an
 * agent over MCP). The editor asks the person instead and passes the answer.
 */
export type VersionMode = 'auto' | 'new' | 'amend';

export interface RoutineSaveOptions {
  version?: VersionMode;
  /** What History says wrote a new version. Defaults to `edit`. */
  source?: RoutineVersionSource;
  /** When a new version was made, for the demo seed's back-dated history. Now unless given. */
  at?: Date;
}

export interface RoutineAddOptions {
  /** What History says wrote the first version. Defaults to `created`. */
  source?: RoutineVersionSource;
  /** When it was made, for the demo seed's back-dated history. Now unless given. */
  at?: Date;
}

export interface StartSessionInput {
  title?: string;
  routineId?: string | null;
  programId?: string | null;
  taskId?: string | null;
  /** The gym it is done at; null or absent for none. */
  gymId?: string | null;
  at?: Date;
  /**
   * A version of the routine to do instead of its current one ("Start a
   * workout from it" in History). Its sets are laid out and the workout
   * counts toward it. Ignored when it isn't one of the routine's versions.
   */
  routineVersionId?: string | null;
  /**
   * Sets to lay out when no routine is named, for a workout started from a
   * finished one (`repeatedSets`). One naming an exercise that has since
   * been deleted is left out.
   */
  planned?: readonly PlannedRoutineSet[];
}

export interface SessionPatch {
  title?: string;
  notes?: string;
  effort?: number | null;
  startedAt?: string;
  endedAt?: string | null;
  /** Moves the session to another gym, or to none (null). */
  gymId?: string | null;
}

export interface FinishOptions extends Omit<SessionPatch, 'endedAt'> {
  endedAt?: string;
  /**
   * Whether finishing completes the task the session was started from.
   * Default true. Workout mode passes false only when that task asks a
   * question on completion, and asks it itself (the answer-first rule).
   */
  completeLinkedTask?: boolean;
  /**
   * Leave the Health write for the next pass with the app in front
   * (`healthWritePending`, `writePendingHealthSessions`) rather than starting
   * it now: for a finish applied in the background (a watch tap that woke the
   * app), whose borrowed time ends before Health may have answered, which
   * would leave a workout in Health with no id on the row to retract it by.
   * Only while writing is on, so it is still exactly what Save would write.
   */
  deferHealthWrite?: boolean;
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
export type PlannedRoutineSet = PlacedPlannedSet;

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
    /** A note written on the set on the watch. */
    note: string | null;
    /** The superset it belonged to in the plan, kept so history shows the pair. */
    supersetKey: string | null;
  }[];
  /**
   * Set when the watch measured the workout and saved it to Health itself
   * (phase 9): the id of what it saved, null when it saved with the watch
   * locked and has no id to give. The phone then writes nothing of its own.
   * Absent when the watch measured nothing, and the phone writes it as Save does.
   */
  health?: { workoutId: string | null } | null;
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
  /**
   * The id to give the set, when the caller already has one: a set added on
   * the Apple Watch keeps the watch's id, so the watch can settle what it
   * drew by it. One already in the session is refused (`taken`), which makes
   * a repeat of the same addition a no-op.
   */
  id?: string;
}

export type SetPatch = Partial<Omit<SetInput, 'exerciseId' | 'id'>>;

/** Why a write was refused, for the caller to say in its own words. */
export type WorkoutRefusal =
  | 'blank' | 'taken' | 'notFound' | 'hasHistory' | 'live' | 'finished' | 'empty' | 'order'
  /** An other name an exercise on offer already goes by, as its name or as one of its own other names. */
  | 'otherNameTaken'
  /** A routine item asks for a warm-up ramp on an exercise that doesn't record weight and reps. */
  | 'rampKind'
  /** A routine asked to merge into itself. */
  | 'same';

/** The setting that holds the group names the person made, so a group can exist with no routine in it. */
const ROUTINE_GROUPS_KEY = 'workoutRoutineGroups';

function readRoutineGroups(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string' && n.trim() !== '') : [];
  } catch {
    return [];
  }
}

interface WorkoutStore {
  exercises: Exercise[];
  routines: WorkoutRoutine[];
  /** Group names in the order the Routines tab lists them. Unioned with the names routines hold (`routineGroups.ts`). */
  routineGroups: string[];
  programs: WorkoutProgram[];
  /** Every stored routine version, oldest first (`routineVersions.ts` reads them). */
  routineVersions: WorkoutRoutineVersion[];
  /** Every stored program version, oldest first. */
  programVersions: WorkoutProgramVersion[];
  /** Newest first. */
  sessions: WorkoutSession[];
  /** Sets per session, for the sessions loaded so far. */
  setsBySession: Record<string, WorkoutSet[]>;
  /** How many sets each session holds, loaded or not. */
  setCounts: Record<string, number>;
  /** Kilograms lifted in each session that has any (`liftVolumeKg`), loaded or not. A session with none has no entry. */
  volumeKgBySession: Record<string, number>;
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

  /** A routine, and its first version. */
  addRoutine: (
    name: string, items?: WorkoutRoutineItem[], programId?: string | null, options?: RoutineAddOptions,
  ) => WorkoutRoutine | WorkoutRefusal;
  /**
   * Edits a routine. A change to its plan (items or notes) is kept as its
   * `options.version` says (`VersionMode`); a rename changes the current
   * version's name in place; archiving, grouping and filing touch no version.
   */
  updateRoutine: (id: string, patch: RoutinePatch, options?: RoutineSaveOptions) => WorkoutRoutine | WorkoutRefusal;
  /**
   * Also takes it out of any program's rotation, and deletes its versions.
   * Sessions keep naming it and the version they were done on, as provenance.
   */
  deleteRoutine: (id: string) => void;
  /**
   * Whether a workout has been finished on the routine's current version: the
   * question the editor asks before a save that changes the plan.
   */
  routineVersionTrained: (routineId: string) => boolean;
  /** A routine of its own made from one version of another ("Copy to a new routine"). */
  copyRoutineVersion: (versionId: string) => WorkoutRoutine | WorkoutRefusal;
  /**
   * Makes `fromId` the earlier history of `intoId`: its versions and workouts
   * become `intoId`'s (each workout keeping the version it counted toward),
   * its place in any rotation and its open tasks move over, and it is
   * deleted. Refuses while a workout from it is in progress (`live`), and a
   * routine merged into itself (`same`).
   */
  mergeRoutines: (
    fromId: string, intoId: string, options?: { moveTasks?: (fromId: string, intoId: string) => void },
  ) => WorkoutRoutine | WorkoutRefusal;
  /** Names a version ("Shoulder-friendly"); blank clears it. */
  labelRoutineVersion: (versionId: string, label: string) => WorkoutRoutineVersion | WorkoutRefusal;
  /**
   * Makes an older version's plan current again, as the newest version
   * (`source: 'restore'`), so nothing in History is rewritten. What the
   * phone's Restore then Save does, in one step, for an agent. Refuses the
   * version that is already current (`same`).
   */
  restoreRoutineVersion: (versionId: string) => WorkoutRoutine | WorkoutRefusal;
  /** Makes an empty group. Refuses a blank name, and a name a group already has (ignoring case). */
  addRoutineGroup: (name: string) => string | WorkoutRefusal;
  /** Renames a group on its routines too. A name another group already has joins the two. */
  renameRoutineGroup: (from: string, to: string) => string | WorkoutRefusal;
  /** Its routines stay, in no group. */
  deleteRoutineGroup: (name: string) => void;
  /**
   * What a drag on the Routines tab commits: the live routines in their new
   * order, each with the group it now sits in, written in one transaction.
   * Slots are handed back out the way `slotUpdates` does, so archived routines
   * and everything not in the drag keep their place.
   */
  arrangeRoutines: (placements: ReadonlyArray<{ id: string; groupName: string | null }>) => void;

  /**
   * A program. A rotation given here or to `updateProgram` also files its
   * routines under the program (`WorkoutRoutine.programId`) where they belong
   * to none, and frees the ones taken out of it, so a routine started on its
   * own from the Routines list still counts toward its program.
   */
  addProgram: (input: ProgramInput) => WorkoutProgram | WorkoutRefusal;
  /**
   * Edits a program. A change to its structure (rotation, weeks, scheme) is
   * kept as `options.version` says, the routine rule; the version records the
   * version each routine in the rotation is on.
   */
  updateProgram: (
    id: string, patch: ProgramPatch, options?: { version?: VersionMode; at?: Date },
  ) => WorkoutProgram | WorkoutRefusal;
  /** Whether a workout was finished in the program since its current version took over. */
  programVersionTrained: (programId: string) => boolean;
  /** Names a program version; blank clears it. */
  labelProgramVersion: (versionId: string, label: string) => WorkoutProgramVersion | WorkoutRefusal;
  /**
   * An older version's rotation, length and scheme made current again as the
   * newest version. A routine since deleted is left out of the rotation.
   * Refuses the version that is already current (`same`).
   */
  restoreProgramVersion: (versionId: string) => WorkoutProgram | WorkoutRefusal;
  /** Its routines stay, as routines on their own. Its versions go. */
  deleteProgram: (id: string) => void;
  /**
   * Writes a built-in program (`PROGRAM_LIBRARY`) as the person's own: its
   * routines, then the program naming them in rotation, in one transaction.
   * Refuses a key the library doesn't have (`notFound`).
   */
  addLibraryProgram: (key: string, options?: { at?: Date }) => { program: WorkoutProgram; routines: WorkoutRoutine[] } | WorkoutRefusal;

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
  plannedSetsForRoutine: (routineId: string, exceptSessionId?: string | null, versionId?: string | null) => PlannedRoutineSet[];
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
   * `deferHealthWrite` is `FinishOptions`' own.
   */
  addWatchSession: (input: WatchSessionInput, options?: { now?: Date; deferHealthWrite?: boolean }) => WatchSessionResult | WorkoutRefusal;
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
  /**
   * Writes the exercise's note for this workout, found through one of its sets
   * (what the watch knows when it dictates one). The text replaces the note,
   * kept on the exercise's first set (`exerciseDayNote.ts`), so a note dictated
   * on set 3 is the exercise's note, not set 3's.
   */
  noteExerciseOfSet: (sessionId: string, setId: string, text: string) => void;
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
   * `ids` names the sets laid out, in order, for a caller that drew them
   * already (the Apple Watch); one already in the session refuses the lot
   * (`taken`), and sets past the ids given get ids of their own.
   */
  addSessionExercise: (sessionId: string, exerciseId: string, options?: { ids?: readonly string[] }) => WorkoutSet[] | WorkoutRefusal;
  /**
   * "Swap": moves the exercise's unticked sets to another exercise, in its
   * place (or just after it when some of its sets are already done, which stay
   * where they were logged). The moved sets take the new exercise's own last
   * weights, since a bench load means nothing on a dumbbell press. Refuses an
   * exercise the workout already has (`taken`), one nobody knows or one with
   * nothing left to move (`notFound`). The routine is not touched.
   */
  swapSessionExercise: (sessionId: string, fromExerciseId: string, toExerciseId: string) => WorkoutSet[] | WorkoutRefusal;
  /**
   * "Remove exercise": deletes every set the exercise has in the session, logged
   * ones included, and closes the gap in the order. Refuses a session or an
   * exercise that isn't there (`notFound`). The routine is not touched.
   */
  removeSessionExercise: (sessionId: string, exerciseId: string) => true | WorkoutRefusal;
  /** "Add set": one more planned set like the exercise's last (`copyLastSet`), with `id` as `SetInput.id`. */
  addPlannedSet: (sessionId: string, exerciseId: string, options?: { id?: string }) => WorkoutSet | WorkoutRefusal;
  /**
   * Moves an exercise a place up or down in the session, with its sets, and a
   * superset as one block (`movedExerciseOrder`, then `reorderExercises`).
   * False when it can't move that way.
   */
  moveSessionExercise: (sessionId: string, exerciseId: string, direction: 'up' | 'down') => boolean;
  /**
   * Makes `partnerId` a superset with `exerciseId` (`joinedSuperset`): the
   * partner moves to sit below it and both carry one key, on done and planned
   * sets alike. False when they are unknown or already together.
   */
  joinSessionSuperset: (sessionId: string, exerciseId: string, partnerId: string) => boolean;
  /** Takes the exercise out of its superset (`leftSuperset`). False when it isn't in one. */
  leaveSessionSuperset: (sessionId: string, exerciseId: string) => boolean;
  /**
   * Lays warm-up steps out as planned sets ahead of the exercise's other sets,
   * which move down to make room. Refuses a session, or an exercise not in it,
   * that nobody knows (`notFound`). What "Use" does for a ramp that had no
   * weight to start from when the workout began. `ids` names the warm-ups,
   * in order, as `addSessionExercise`'s does (the Apple Watch's Use draws
   * them first): one already in the session refuses the lot (`taken`).
   */
  addPlannedWarmups: (
    sessionId: string,
    exerciseId: string,
    steps: readonly { kg: number; reps: number }[],
    options?: { ids?: readonly string[] },
  ) => WorkoutSet[] | WorkoutRefusal;

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
   * The Apple Watch started (`on`) or stopped measuring this session (phase
   * 9's `measuring` tap). Started, a session with nothing in Health yet is
   * marked `measuredOnWatch`, so its Save holds the phone's own write back
   * for the watch's. Stopped before saving (the watch's session failed, or
   * workout writing went off there), the mark comes off, and a finished
   * session is left for the pending pass to write as Save would have. A
   * session the phone has already written keeps its copy: the watch's, when
   * it comes, takes over (`recordWatchHealthWorkout`).
   */
  markWatchMeasuring: (sessionId: string, on: boolean) => void;
  /**
   * The Apple Watch saved its workout for this session to Health (phase 9's
   * `healthWorkout` tap): `workoutId` is what it saved, null when it saved
   * locked with no id to give. The row points at it from then on, and a copy
   * the phone wrote meanwhile is retracted, since the watch's has the heart
   * rate and energy. A session deleted here in the meantime has the watch's
   * workout retracted by the watch; a second watch workout for one session is
   * retracted the same way.
   *
   * `span` is the times the watch saved it at. When the copy is out of date
   * for the row (`watchCopyStale`: the person retimed it while the phone
   * waited, or the times are further apart than a Finish tapped on both
   * devices leaves them), it ends as a retime does: the phone
   * writes its own at the row's times, without heart rate or energy, and the
   * watch retracts its copy once that write lands (`recordHealthWrite`'s
   * take-over). A copy the phone already wrote at those times stays, and the
   * watch's is retracted. With writing off, or Health refusing, the watch's
   * stays at its old times: one copy, never two. An end a few minutes off on
   * a row nobody retimed is not out of date: the watch's copy is taken as it
   * is, heart rate and all, and the row keeps its own end.
   */
  recordWatchHealthWorkout: (sessionId: string, workoutId: string | null, span?: WatchWorkoutSpan | null) => void;
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
/** The dumbbell count and weight entry a row keeps: nothing for equipment that isn't a dumbbell. */
function dumbbellFields(
  equipment: ExerciseEquipment,
  dumbbells: 1 | 2 | null | undefined,
  loadEntry: 'each' | 'pair' | null | undefined,
): Pick<Exercise, 'dumbbells' | 'loadEntry'> {
  if (equipment !== 'dumbbell') return { dumbbells: null, loadEntry: null };
  return { dumbbells: dumbbells === 1 || dumbbells === 2 ? dumbbells : null, loadEntry: loadEntry ?? null };
}

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
const byCreated = <T extends { createdAt: string; id: string }>(a: T, b: T) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/**
 * A new version's time: now, or a millisecond after the newest it follows,
 * since versions are numbered by time and two saves can land in one tick.
 */
function versionTime(after: readonly { createdAt: string }[], at: Date = new Date()): string {
  const last = after.reduce((max, v) => Math.max(max, Date.parse(v.createdAt) || 0), 0);
  return new Date(Math.max(at.getTime(), last + 1)).toISOString();
}

/** Rows swapped into a list by id, or added, oldest first. */
function mergedById<T extends { createdAt: string; id: string }>(list: readonly T[], rows: readonly T[]): T[] {
  if (rows.length === 0) return list as T[];
  const byId = new Map(rows.map(r => [r.id, r]));
  return [...list.filter(r => !byId.has(r.id)), ...byId.values()].sort(byCreated);
}

/** `volumes` with one session's figure set, or dropped when it has none. */
function withVolume(volumes: Record<string, number>, sessionId: string, kilograms: number | null): Record<string, number> {
  const { [sessionId]: _old, ...rest } = volumes;
  return kilograms === null ? rest : { ...rest, [sessionId]: kilograms };
}

/** Every session's lifted volume from the database, kinds read from `exercises`. */
function volumeBySession(exercises: Exercise[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of dbWorkoutLiftVolumes()) {
    if ((catalogExercise(exercises, row.exerciseId)?.kind ?? 'weight_reps') !== 'weight_reps') continue;
    out[row.sessionId] = (out[row.sessionId] ?? 0) + row.kilograms;
  }
  return out;
}
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

const changed = (a: WorkoutSet, b: WorkoutSet) => a.position !== b.position || a.setIndex !== b.setIndex || a.supersetKey !== b.supersetKey;

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

  /**
   * Whether another exercise on offer already goes by one of these names, as its
   * own name or as one of its other names. Two exercises answering to one name
   * would leave a search, and an import's name match, with no way to say which.
   */
  const otherNameTaken = (names: readonly string[], exceptId: string | null): boolean => {
    const keys = new Set(names.map(exerciseNameKey));
    return buildCatalog(get().exercises).some(e =>
      e.id !== exceptId && !e.archived
      && [e.name, ...e.otherNames].some(n => keys.has(exerciseNameKey(n))));
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

  /** Weighted lifts are the default kind, as everywhere else an exercise can't be found. */
  const kindOfExercise = (id: string) => catalogExercise(get().exercises, id)?.kind ?? 'weight_reps';

  const putSets = (sessionId: string, sets: WorkoutSet[]) => {
    set({
      setsBySession: { ...get().setsBySession, [sessionId]: sets },
      setCounts: { ...get().setCounts, [sessionId]: sets.length },
      volumeKgBySession: withVolume(get().volumeKgBySession, sessionId, liftVolumeKg(sets, kindOfExercise)),
    });
  };

  const exerciseKnown = (id: string) => !!libraryExercise(id) || get().exercises.some(e => e.id === id);

  /** Writes a row's Health fields back as it stands now, on disk and in memory. */
  const stampHealth = (
    fresh: WorkoutSession,
    fields: Pick<WorkoutSession, 'healthWorkoutId' | 'healthWritePending'> & Partial<Pick<WorkoutSession, 'measuredOnWatch'>>,
  ) => {
    putSession({ ...fresh, ...fields });
  };

  /**
   * Retracts a workout this row points at, from whichever device saved it:
   * the phone's own through the bridge, the watch's by asking the watch
   * (`retractWatchWorkouts`), since the phone may not be allowed to delete
   * what its watch app saved. True when it is gone or on its way out.
   */
  const retractFor = async (row: Pick<WorkoutSession, 'measuredOnWatch'>, ids: string[]): Promise<boolean> => {
    if (ids.length === 0) return true;
    if (row.measuredOnWatch) {
      retractWatchWorkouts(ids);
      return true;
    }
    return retractWorkoutFromHealth(ids);
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
   * are always empty here (no energy is passed); a workout the watch measured
   * carries its energy itself, saved by the watch, and the watch retracts it.
   *
   * **The watch's copy wins.** A row the Apple Watch measured whose watch
   * workout has arrived (`measuredOnWatch` with an id) keeps it, and this
   * write, the phone's, is taken back out: the watch's has the heart rate and
   * energy. Except when this write is a retime's rewrite *replacing* that
   * workout (`replacing`, the id it retracted first), which is the person
   * moving it on purpose. A phone write landing on a row still waiting for
   * the watch's (the fallback after `WATCH_WORKOUT_WAIT_MINUTES`) is kept, and
   * the row says the workout in Health is the phone's from then on.
   */
  const recordHealthWrite = (written: WorkoutSession, result: WorkoutWriteResult, replacing: string | null = null) => {
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
      // Not when the watch's own workout has arrived meanwhile: that is the
      // one Health keeps.
      if (ids.length > 0) void retractWorkoutFromHealth(ids);
      const watchHas = fresh.measuredOnWatch && fresh.healthWorkoutId !== null && fresh.healthWorkoutId !== replacing;
      if (fresh.endedAt !== null && !watchHas) void logWorkoutToHealth(fresh).then(next => recordHealthWrite(fresh, next, replacing));
      return;
    }
    if (fresh.measuredOnWatch && fresh.healthWorkoutId !== null && fresh.healthWorkoutId !== replacing
      && fresh.healthWorkoutId !== result.workoutId) {
      // The watch's workout, with its heart rate and energy, is in Health
      // already: this copy is the duplicate the phone must never leave there.
      if (ids.length > 0) void retractWorkoutFromHealth(ids);
      if (fresh.healthWritePending) stampHealth(fresh, { healthWorkoutId: fresh.healthWorkoutId, healthWritePending: false });
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
      //
      // The watch's copy is a different case: it has no sync identifier, so
      // the phone's write sat beside it rather than replacing it, and it is
      // retracted by the watch either way. A locked save of the phone's
      // replacing it leaves the row with nothing to point at, as any locked
      // save does.
      if (result.workoutId === null) {
        if (fresh.measuredOnWatch && fresh.healthWorkoutId === replacing) {
          void retractFor(fresh, [fresh.healthWorkoutId]);
          stampHealth(fresh, { healthWorkoutId: null, healthWritePending: false, measuredOnWatch: false });
        }
        return;
      }
      void retractFor(fresh, [fresh.healthWorkoutId]);
    }
    // A null id is a workout saved while the phone was locked: in Health, with
    // nothing to keep. The flag still clears, or the pending pass would write
    // it a second time. What Health holds for the row is the phone's copy from
    // here on, with no heart rate or energy, whatever measured it before.
    stampHealth(fresh, { healthWorkoutId: result.workoutId, healthWritePending: false, measuredOnWatch: false });
  };

  /**
   * Fired after a save; the session is already on disk, so nothing waits on
   * Health. Deferred, it is only flagged for the next pass in front, and only
   * when the write would happen now (see `FinishOptions.deferHealthWrite`).
   *
   * **A workout the Apple Watch measured is always deferred**: the watch saves
   * its own copy, with the heart rate and energy, and the pending pass writes
   * the phone's only if none has arrived `WATCH_WORKOUT_WAIT_MINUTES` after it
   * ended (`pendingWorkoutWriteAction`). One already holding an id (the
   * watch's arrived before the finish did) writes nothing.
   */
  const writeToHealth = (session: WorkoutSession, defer = false) => {
    if (session.healthWorkoutId !== null) return;
    if (session.measuredOnWatch) defer = true;
    if (!defer) {
      void logWorkoutToHealth(session).then(result => recordHealthWrite(session, result));
      return;
    }
    if (!workoutHealthWriteOn() || !workoutSpanWritable(session)) return;
    const fresh = dbGetWorkoutSession(session.id);
    if (fresh && fresh.healthWorkoutId === null) stampHealth(fresh, { healthWorkoutId: null, healthWritePending: true });
  };

  /** A set row from planned values, at a place the caller has worked out. */
  const plannedRow = (
    sessionId: string,
    exerciseId: string,
    position: number,
    setIndex: number,
    v: PlannedSetValues,
    id: string = generateId(),
  ): WorkoutSet => ({
    id,
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

  /**
   * A routine whose current version is a stored row, and the rows that makes:
   * one saved before versions were kept gets its implicit first version
   * written, from its content before this change, under the id every device
   * derives. One naming a version this device hasn't received yet is left as
   * it is, since pointing it elsewhere would overwrite the other device's.
   */
  const withVersion = (routine: WorkoutRoutine): { routine: WorkoutRoutine; rows: WorkoutRoutineVersion[] } => {
    if (routine.currentVersionId) return { routine, rows: [] };
    const own = get().routineVersions.filter(v => v.routineId === routine.id);
    if (own.length > 0) return { routine: { ...routine, currentVersionId: own[own.length - 1].id }, rows: [] };
    const first = implicitRoutineVersion(routine);
    return { routine: { ...routine, currentVersionId: first.id }, rows: [first] };
  };

  /** The program twin of `withVersion`. */
  const withProgramVersion = (program: WorkoutProgram): { program: WorkoutProgram; rows: WorkoutProgramVersion[] } => {
    if (program.currentVersionId) return { program, rows: [] };
    const own = get().programVersions.filter(v => v.programId === program.id);
    if (own.length > 0) return { program: { ...program, currentVersionId: own[own.length - 1].id }, rows: [] };
    const first = { ...implicitProgramVersion(program), routineVersionIds: routineVersionMap(program.rotation) };
    return { program: { ...program, currentVersionId: first.id }, rows: [first] };
  };

  /** The version each routine in a rotation is on, which a program version records. */
  const routineVersionMap = (rotation: readonly string[], routines = get().routines): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const id of new Set(rotation)) {
      const r = routines.find(x => x.id === id);
      if (r) out[id] = r.currentVersionId ?? currentRoutineVersion(r, routineVersionsOf(r, get().routineVersions)).id;
    }
    return out;
  };

  const newRoutineVersion = (
    routine: WorkoutRoutine, source: RoutineVersionSource, after: readonly { createdAt: string }[], at?: Date,
  ): WorkoutRoutineVersion => ({
    id: generateId(),
    routineId: routine.id,
    createdAt: versionTime(after, at),
    name: routine.name,
    notes: routine.notes,
    items: routine.items,
    source,
    label: null,
  });

  const newProgramVersion = (
    program: WorkoutProgram, after: readonly { createdAt: string }[], routines = get().routines, at?: Date,
  ): WorkoutProgramVersion => ({
    id: generateId(),
    programId: program.id,
    createdAt: versionTime(after, at),
    name: program.name,
    weeks: program.weeks,
    rotation: program.rotation,
    scheme: program.scheme,
    routineVersionIds: routineVersionMap(program.rotation, routines),
    label: null,
  });

  /** A stored program version, or the implicit first one of a program that has none stored. */
  const findProgramVersion = (versionId: string): WorkoutProgramVersion | undefined =>
    get().programVersions.find(v => v.id === versionId)
    ?? get().programs.map(p => programVersionsOf(p, get().programVersions)).flat().find(v => v.id === versionId);

  /** A stored version, or the implicit first one of a routine that has none stored. */
  const findRoutineVersion = (versionId: string): WorkoutRoutineVersion | undefined =>
    get().routineVersions.find(v => v.id === versionId)
    ?? get().routines.map(r => routineVersionsOf(r, get().routineVersions)).flat().find(v => v.id === versionId);

  return {
    exercises: [],
    routines: [],
    routineGroups: [],
    programs: [],
    routineVersions: [],
    programVersions: [],
    sessions: [],
    setsBySession: {},
    setCounts: {},
    volumeKgBySession: {},
    initialized: false,
    pendingHealthWriteRefusal: false,

    initialize() {
      const sessions = dbGetAllWorkoutSessions().sort(byStartedDesc);
      const live = sessions.find(s => s.endedAt === null);
      const exercises = dbGetAllExercises();
      set({
        exercises,
        routines: dbGetAllWorkoutRoutines(),
        routineGroups: readRoutineGroups(dbGetSetting(ROUTINE_GROUPS_KEY)),
        programs: dbGetAllWorkoutPrograms(),
        routineVersions: dbGetAllRoutineVersions(),
        programVersions: dbGetAllProgramVersions(),
        sessions,
        // Dropped wholesale on every load: a cache from the database before a
        // sync, a restore or the demo swap describes rows that may not exist.
        setsBySession: live ? { [live.id]: dbGetWorkoutSets(live.id) } : {},
        setCounts: dbCountWorkoutSetsBySession(),
        volumeKgBySession: volumeBySession(exercises),
        initialized: true,
      });
    },

    addExercise(input) {
      const name = cleanWorkoutName(input.name);
      if (!name) return 'blank';
      if (nameTaken(name, null)) return 'taken';
      const otherNames = cleanOtherNames(input.otherNames ?? [], name);
      if (otherNameTaken(otherNames, null)) return 'otherNameTaken';
      const row: Exercise = {
        id: generateId(),
        name,
        otherNames,
        kind: input.kind,
        primaryMuscles: readMuscles(input.primaryMuscles),
        secondaryMuscles: readMuscles(input.secondaryMuscles ?? []),
        equipment: input.equipment,
        barKg: amount(input.barKg) || null,
        ...dumbbellFields(input.equipment, input.dumbbells, input.loadEntry),
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
      // Cleaned against the name it ends up with, since renaming to one of its own other names makes that one redundant.
      const otherNames = cleanOtherNames(patch.otherNames ?? existing?.otherNames ?? [], name);
      if (patch.otherNames !== undefined && otherNameTaken(otherNames, id)) return 'otherNameTaken';
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
        dumbbells: null,
        loadEntry: null,
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
        otherNames,
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
      Object.assign(row, dumbbellFields(
        row.equipment,
        patch.dumbbells !== undefined ? patch.dumbbells : base.dumbbells,
        patch.loadEntry !== undefined ? patch.loadEntry : base.loadEntry,
      ));
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

    addRoutine(name, items = [], programId = null, options = {}) {
      const clean = cleanWorkoutName(name);
      if (!clean) return 'blank';
      const routines = get().routines;
      const read = readRoutineItems(items);
      if (rampMisplaced(read)) return 'rampKind';
      const base: WorkoutRoutine = {
        id: generateId(),
        name: clean,
        notes: '',
        programId,
        sortOrder: routines.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1,
        items: read,
        createdAt: (options.at ?? new Date()).toISOString(),
        groupName: null,
        archived: false,
      };
      const version = newRoutineVersion(base, options.source ?? 'created', [], options.at);
      const row: WorkoutRoutine = { ...base, currentVersionId: version.id };
      dbTransaction(() => {
        dbSaveWorkoutRoutine(row);
        dbSaveRoutineVersion(version);
      });
      set({ routines: [...routines, row], routineVersions: mergedById(get().routineVersions, [version]) });
      return row;
    },

    updateRoutine(id, patch, options = {}) {
      const existing = get().routines.find(r => r.id === id);
      if (!existing) return 'notFound';
      let name = existing.name;
      if (patch.name !== undefined) {
        name = cleanWorkoutName(patch.name);
        if (!name) return 'blank';
      }
      const items = patch.items !== undefined ? readRoutineItems(patch.items) : existing.items;
      if (patch.items !== undefined && rampMisplaced(items)) return 'rampKind';
      const changedRow: WorkoutRoutine = {
        ...existing,
        name,
        notes: patch.notes !== undefined ? patch.notes.trim() : existing.notes,
        programId: patch.programId !== undefined ? patch.programId : existing.programId,
        items,
        groupName: patch.groupName !== undefined ? resolveGroupName(patch.groupName, get().routines, get().routineGroups) : existing.groupName,
        archived: patch.archived ?? existing.archived,
      };
      let row: WorkoutRoutine = changedRow;
      const planChanged = routineContentChanged(existing, row);
      const versions: WorkoutRoutineVersion[] = [];
      if (planChanged || row.name !== existing.name) {
        const ensured = withVersion(existing);
        versions.push(...ensured.rows);
        row = { ...row, currentVersionId: ensured.routine.currentVersionId };
        const known = mergedById(get().routineVersions, ensured.rows);
        const current = known.find(v => v.id === row.currentVersionId);
        if (planChanged) {
          const mode = options.version ?? 'auto';
          const fresh = !current || mode === 'new'
            || (mode === 'auto' && routineVersionTrained(ensured.routine, known, get().sessions));
          if (fresh) {
            const v = newRoutineVersion(row, options.source ?? 'edit', known.filter(x => x.routineId === id), options.at);
            versions.push(v);
            row = { ...row, currentVersionId: v.id };
          } else {
            versions.push({ ...current, name: row.name, notes: row.notes, items: row.items });
          }
        } else if (current) {
          versions.push({ ...current, name: row.name });
        }
      }
      dbTransaction(() => {
        dbSaveWorkoutRoutine(row);
        for (const v of versions) dbSaveRoutineVersion(v);
      });
      set({
        routines: get().routines.map(r => (r.id === id ? row : r)),
        routineVersions: mergedById(get().routineVersions, versions),
      });
      return row;
    },

    deleteRoutine(id) {
      const touched = get().programs
        .filter(p => p.rotation.includes(id))
        .map(p => ({ ...p, rotation: p.rotation.filter(r => r !== id) }));
      const versions = get().routineVersions.filter(v => v.routineId === id);
      dbTransaction(() => {
        dbDeleteWorkoutRoutine(id);
        for (const v of versions) dbDeleteRoutineVersion(v.id);
        for (const p of touched) dbSaveWorkoutProgram(p);
      });
      const byId = new Map(touched.map(p => [p.id, p]));
      set({
        routines: get().routines.filter(r => r.id !== id),
        routineVersions: get().routineVersions.filter(v => v.routineId !== id),
        programs: get().programs.map(p => byId.get(p.id) ?? p),
      });
    },

    routineVersionTrained(routineId) {
      const routine = get().routines.find(r => r.id === routineId);
      return routine ? routineVersionTrained(routine, get().routineVersions, get().sessions) : false;
    },

    copyRoutineVersion(versionId) {
      const version = findRoutineVersion(versionId);
      if (!version) return 'notFound';
      const source = get().routines.find(r => r.id === version.routineId);
      const number = source ? versionNumber(routineVersionsOf(source, get().routineVersions), versionId) : 1;
      const name = freeWorkoutName(versionCopyName(source?.name ?? version.name, number), get().routines.map(r => r.name));
      const made = get().addRoutine(name, version.items, null, { source: 'copy' });
      if (typeof made === 'string') return made;
      if (!version.notes && !source?.groupName) return made;
      return get().updateRoutine(made.id, { notes: version.notes, groupName: source?.groupName ?? null }, { version: 'amend' });
    },

    mergeRoutines(fromId, intoId, options = {}) {
      if (fromId === intoId) return 'same';
      const from = get().routines.find(r => r.id === fromId);
      const into = get().routines.find(r => r.id === intoId);
      if (!from || !into) return 'notFound';
      if (get().sessions.some(s => s.endedAt === null && s.routineId === fromId)) return 'live';
      const a = withVersion(from);
      const b = withVersion(into);
      const known = mergedById(get().routineVersions, [...a.rows, ...b.rows]);
      const fromVersions = routineVersionsOf(a.routine, known);
      // Each workout keeps the version it counted toward, worked out before
      // the move: under the new routine, time alone would count it toward
      // whichever of the merged versions was newest then.
      const movedVersions = fromVersions.map(v => ({ ...v, routineId: intoId }));
      const movedSessions = get().sessions
        .filter(s => s.routineId === fromId)
        .map(s => ({ ...s, routineId: intoId, routineVersionId: sessionVersionId(s, fromVersions) }));
      const programs = get().programs
        .filter(p => p.rotation.includes(fromId))
        .map(p => ({ ...p, rotation: p.rotation.map(r => (r === fromId ? intoId : r)) }));
      const intoRow = b.routine;
      dbTransaction(() => {
        dbDeleteWorkoutRoutine(fromId);
        dbSaveWorkoutRoutine(intoRow);
        for (const v of [...b.rows, ...movedVersions]) dbSaveRoutineVersion(v);
        for (const s of movedSessions) dbSaveWorkoutSession(s);
        for (const p of programs) dbSaveWorkoutProgram(p);
      });
      const sessionById = new Map(movedSessions.map(s => [s.id, s]));
      const programById = new Map(programs.map(p => [p.id, p]));
      set({
        routines: get().routines.filter(r => r.id !== fromId).map(r => (r.id === intoId ? intoRow : r)),
        routineVersions: mergedById(get().routineVersions, [...b.rows, ...movedVersions]),
        sessions: get().sessions.map(s => sessionById.get(s.id) ?? s),
        programs: get().programs.map(p => programById.get(p.id) ?? p),
      });
      // A task still to do starts the merged routine now. A finished one keeps
      // naming the old routine, as a session does: it is a record of what ran.
      // The MCP replica passes `moveTasks` to do this through its own task
      // writes, since it never loads the task store (see `taskStore`).
      if (options.moveTasks) {
        options.moveTasks(fromId, intoId);
      } else {
        const tasks = taskStore();
        for (const t of tasks.tasks) {
          if (t.workoutRoutineId === fromId && !t.completed) tasks.updateTask(t.id, { workoutRoutineId: intoId });
        }
      }
      return intoRow;
    },

    restoreRoutineVersion(versionId) {
      const version = findRoutineVersion(versionId);
      const routine = version && get().routines.find(r => r.id === version.routineId);
      if (!version || !routine) return 'notFound';
      if (currentRoutineVersion(routine, routineVersionsOf(routine, get().routineVersions)).id === versionId) return 'same';
      return get().updateRoutine(routine.id, { items: version.items, notes: version.notes }, { version: 'new', source: 'restore' });
    },

    labelRoutineVersion(versionId, label) {
      const version = findRoutineVersion(versionId);
      const routine = version && get().routines.find(r => r.id === version.routineId);
      if (!version || !routine) return 'notFound';
      const ensured = withVersion(routine);
      const row: WorkoutRoutineVersion = { ...version, label: cleanWorkoutName(label) || null };
      dbTransaction(() => {
        if (ensured.rows.length > 0) dbSaveWorkoutRoutine(ensured.routine);
        for (const v of [...ensured.rows, row]) dbSaveRoutineVersion(v);
      });
      set({
        routines: ensured.rows.length > 0 ? get().routines.map(r => (r.id === routine.id ? ensured.routine : r)) : get().routines,
        routineVersions: mergedById(get().routineVersions, [...ensured.rows, row]),
      });
      return row;
    },

    addRoutineGroup(name) {
      const clean = cleanWorkoutName(name);
      if (!clean) return 'blank';
      const { routines, routineGroups } = get();
      if (groupNames(routines, routineGroups).some(n => n.toLowerCase() === clean.toLowerCase())) return 'taken';
      const next = [...routineGroups, clean];
      dbSetSetting(ROUTINE_GROUPS_KEY, JSON.stringify(next));
      set({ routineGroups: next });
      return clean;
    },

    renameRoutineGroup(from, to) {
      const clean = cleanWorkoutName(to);
      if (!clean) return 'blank';
      const { routines, routineGroups } = get();
      const fromKey = from.trim().toLowerCase();
      const target = resolveGroupName(clean, routines.filter(r => r.groupName?.trim().toLowerCase() !== fromKey), routineGroups.filter(n => n.trim().toLowerCase() !== fromKey)) ?? clean;
      const next = renamedRegistry(routineGroups, from, target);
      const moved = routines
        .filter(r => r.groupName?.trim().toLowerCase() === fromKey)
        .map(r => ({ ...r, groupName: target }));
      dbTransaction(() => {
        dbSetSetting(ROUTINE_GROUPS_KEY, JSON.stringify(next));
        for (const r of moved) dbSaveWorkoutRoutine(r);
      });
      const byId = new Map(moved.map(r => [r.id, r]));
      set({ routineGroups: next, routines: get().routines.map(r => byId.get(r.id) ?? r) });
      return target;
    },

    deleteRoutineGroup(name) {
      const key = name.trim().toLowerCase();
      const next = get().routineGroups.filter(n => n.trim().toLowerCase() !== key);
      const freed = get().routines
        .filter(r => r.groupName?.trim().toLowerCase() === key)
        .map(r => ({ ...r, groupName: null }));
      dbTransaction(() => {
        dbSetSetting(ROUTINE_GROUPS_KEY, JSON.stringify(next));
        for (const r of freed) dbSaveWorkoutRoutine(r);
      });
      const byId = new Map(freed.map(r => [r.id, r]));
      set({ routineGroups: next, routines: get().routines.map(r => byId.get(r.id) ?? r) });
    },

    arrangeRoutines(placements) {
      const all = get().routines;
      const slots = new Map(slotUpdates(all, placements.map(p => p.id)).map(u => [u.id, u.sortOrder]));
      const groupOf = new Map(placements.map(p => [p.id, p.groupName]));
      const changed: WorkoutRoutine[] = [];
      for (const r of all) {
        if (!groupOf.has(r.id)) continue;
        const groupName = groupOf.get(r.id) ?? null;
        const sortOrder = slots.get(r.id) ?? r.sortOrder;
        if (groupName !== r.groupName || sortOrder !== r.sortOrder) changed.push({ ...r, groupName, sortOrder });
      }
      if (changed.length === 0) return;
      dbTransaction(() => { for (const r of changed) dbSaveWorkoutRoutine(r); });
      const byId = new Map(changed.map(r => [r.id, r]));
      set({ routines: all.map(r => byId.get(r.id) ?? r) });
    },

    addProgram(input) {
      const name = cleanWorkoutName(input.name);
      if (!name) return 'blank';
      const base: WorkoutProgram = {
        id: generateId(),
        name,
        weeks: input.weeks && input.weeks > 0 ? Math.round(input.weeks) : null,
        rotation: (input.rotation ?? []).filter(Boolean),
        scheme: input.scheme === undefined ? 'double' : input.scheme,
        trainingMaxes: readTrainingMaxes(input.trainingMaxes ?? []),
        startedAt: null,
        archived: false,
        createdAt: nowIso(),
      };
      const version = newProgramVersion(base, []);
      const row: WorkoutProgram = { ...base, currentVersionId: version.id };
      const filed = input.rotation !== undefined ? fileRotation(row, null) : [];
      dbTransaction(() => {
        dbSaveWorkoutProgram(row);
        dbSaveProgramVersion(version);
        for (const r of filed) dbSaveWorkoutRoutine(r);
      });
      set({
        programs: [...get().programs, row],
        programVersions: mergedById(get().programVersions, [version]),
        routines: withRoutines(filed),
      });
      return row;
    },

    addLibraryProgram(key, options = {}) {
      const createdAt = (options.at ?? new Date()).toISOString();
      const lib = libraryProgram(key);
      if (!lib) return 'notFound';
      const programId = generateId();
      let order = get().routines.reduce((max, r) => Math.max(max, r.sortOrder), -1);
      // Adding one a second time makes a second set of routines and a second
      // program, so a name already held gets "(2)" rather than a twin.
      const heldRoutines = get().routines.map(r => r.name);
      const routineVersions: WorkoutRoutineVersion[] = [];
      const routines: WorkoutRoutine[] = lib.routines.map(r => {
        const base: WorkoutRoutine = {
          id: generateId(),
          name: (() => { const free = freeWorkoutName(r.name, heldRoutines); heldRoutines.push(free); return free; })(),
          notes: '',
          programId,
          sortOrder: ++order,
          items: readRoutineItems(r.items),
          createdAt,
          groupName: null,
          archived: false,
        };
        const version = newRoutineVersion(base, 'created', [], options.at);
        routineVersions.push(version);
        return { ...base, currentVersionId: version.id };
      });
      const base: WorkoutProgram = {
        id: programId,
        name: freeWorkoutName(lib.name, get().programs.map(p => p.name)),
        weeks: lib.weeks,
        rotation: routines.map(r => r.id),
        scheme: lib.scheme,
        trainingMaxes: [],
        startedAt: null,
        archived: false,
        createdAt,
      };
      const version = newProgramVersion(base, [], routines, options.at);
      const program: WorkoutProgram = { ...base, currentVersionId: version.id };
      dbTransaction(() => {
        for (const r of routines) dbSaveWorkoutRoutine(r);
        for (const v of routineVersions) dbSaveRoutineVersion(v);
        dbSaveWorkoutProgram(program);
        dbSaveProgramVersion(version);
      });
      set({
        routines: [...get().routines, ...routines],
        routineVersions: mergedById(get().routineVersions, routineVersions),
        programs: [...get().programs, program],
        programVersions: mergedById(get().programVersions, [version]),
      });
      return { program, routines };
    },

    updateProgram(id, patch, options = {}) {
      const existing = get().programs.find(p => p.id === id);
      if (!existing) return 'notFound';
      let name = existing.name;
      if (patch.name !== undefined) {
        name = cleanWorkoutName(patch.name);
        if (!name) return 'blank';
      }
      const changedRow: WorkoutProgram = {
        ...existing,
        name,
        weeks: patch.weeks !== undefined ? (patch.weeks && patch.weeks > 0 ? Math.round(patch.weeks) : null) : existing.weeks,
        rotation: patch.rotation !== undefined ? patch.rotation.filter(Boolean) : existing.rotation,
        scheme: patch.scheme !== undefined ? patch.scheme : existing.scheme,
        trainingMaxes: patch.trainingMaxes !== undefined ? readTrainingMaxes(patch.trainingMaxes) : existing.trainingMaxes,
        startedAt: patch.startedAt !== undefined ? patch.startedAt : existing.startedAt,
        archived: patch.archived ?? existing.archived,
      };
      let row: WorkoutProgram = changedRow;
      const structural = programStructureChanged(existing, row);
      const versions: WorkoutProgramVersion[] = [];
      if (structural || row.name !== existing.name) {
        const ensured = withProgramVersion(existing);
        versions.push(...ensured.rows);
        row = { ...row, currentVersionId: ensured.program.currentVersionId };
        const known = mergedById(get().programVersions, ensured.rows);
        const current = known.find(v => v.id === row.currentVersionId);
        if (structural) {
          const mode = options.version ?? 'auto';
          const fresh = !current || mode === 'new'
            || (mode === 'auto' && programVersionTrained(ensured.program, known, get().sessions));
          if (fresh) {
            const v = newProgramVersion(row, known.filter(x => x.programId === id), undefined, options.at);
            versions.push(v);
            row = { ...row, currentVersionId: v.id };
          } else {
            versions.push({
              ...current, name: row.name, weeks: row.weeks, rotation: row.rotation, scheme: row.scheme,
              routineVersionIds: routineVersionMap(row.rotation),
            });
          }
        } else if (current) {
          versions.push({ ...current, name: row.name });
        }
      }
      const filed = patch.rotation !== undefined ? fileRotation(row, existing) : [];
      dbTransaction(() => {
        dbSaveWorkoutProgram(row);
        for (const v of versions) dbSaveProgramVersion(v);
        for (const r of filed) dbSaveWorkoutRoutine(r);
      });
      set({
        programs: get().programs.map(p => (p.id === id ? row : p)),
        programVersions: mergedById(get().programVersions, versions),
        routines: withRoutines(filed),
      });
      return row;
    },

    programVersionTrained(programId) {
      const program = get().programs.find(p => p.id === programId);
      return program ? programVersionTrained(program, get().programVersions, get().sessions) : false;
    },

    labelProgramVersion(versionId, label) {
      const version = findProgramVersion(versionId);
      const program = version && get().programs.find(p => p.id === version.programId);
      if (!version || !program) return 'notFound';
      const ensured = withProgramVersion(program);
      const row: WorkoutProgramVersion = { ...version, label: cleanWorkoutName(label) || null };
      dbTransaction(() => {
        if (ensured.rows.length > 0) dbSaveWorkoutProgram(ensured.program);
        for (const v of [...ensured.rows, row]) dbSaveProgramVersion(v);
      });
      set({
        programs: ensured.rows.length > 0 ? get().programs.map(p => (p.id === program.id ? ensured.program : p)) : get().programs,
        programVersions: mergedById(get().programVersions, [...ensured.rows, row]),
      });
      return row;
    },

    restoreProgramVersion(versionId) {
      const version = findProgramVersion(versionId);
      const program = version && get().programs.find(p => p.id === version.programId);
      if (!version || !program) return 'notFound';
      if (currentProgramVersion(program, programVersionsOf(program, get().programVersions)).id === versionId) return 'same';
      const live = new Set(get().routines.map(r => r.id));
      return get().updateProgram(
        program.id,
        { rotation: version.rotation.filter(id => live.has(id)), weeks: version.weeks, scheme: version.scheme },
        { version: 'new' },
      );
    },

    deleteProgram(id) {
      const freed = get().routines.filter(r => r.programId === id).map(r => ({ ...r, programId: null }));
      const versions = get().programVersions.filter(v => v.programId === id);
      dbTransaction(() => {
        dbDeleteWorkoutProgram(id);
        for (const v of versions) dbDeleteProgramVersion(v.id);
        for (const r of freed) dbSaveWorkoutRoutine(r);
      });
      const byId = new Map(freed.map(r => [r.id, r]));
      set({
        programs: get().programs.filter(p => p.id !== id),
        programVersions: get().programVersions.filter(v => v.programId !== id),
        routines: get().routines.map(r => byId.get(r.id) ?? r),
      });
    },

    liveSession() {
      return get().sessions.find(s => s.endedAt === null) ?? null;
    },

    startSession(input = {}) {
      if (get().liveSession()) return 'live';
      const routine = input.routineId ? get().routines.find(r => r.id === input.routineId) : undefined;
      // The version it is done on. A routine with none stored is on its
      // implicit first one, whose id is derived, so nothing is written here.
      const versions = routine ? routineVersionsOf(routine, get().routineVersions) : [];
      const routineVersionId = !routine ? null
        : input.routineVersionId && versions.some(v => v.id === input.routineVersionId) ? input.routineVersionId
        : currentRoutineVersion(routine, versions).id;
      const row: WorkoutSession = {
        id: generateId(),
        routineId: input.routineId ?? null,
        programId: input.programId ?? routine?.programId ?? null,
        taskId: input.taskId ?? null,
        gymId: input.gymId ?? null,
        routineVersionId,
        title: cleanWorkoutName(input.title ?? '') || routine?.name || 'Workout',
        startedAt: (input.at ?? new Date()).toISOString(),
        endedAt: null,
        notes: '',
        effort: null,
        healthWorkoutId: null,
        healthWritePending: false,
        measuredOnWatch: false,
        timesEdited: false,
      };
      putSession(row);
      const planned = (routine
        ? get().plannedSetsForRoutine(routine.id, row.id, routineVersionId)
        : (input.planned ?? []).filter(p => exerciseKnown(p.exerciseId))
      ).map(p => plannedRow(row.id, p.exerciseId, p.position, p.setIndex, p.values));
      if (planned.length > 0) dbSaveWorkoutSets(planned);
      putSets(row.id, planned);
      return row;
    },

    plannedSetsForRoutine(routineId, exceptSessionId = null, versionId = null) {
      const routine = get().routines.find(r => r.id === routineId);
      const version = routine && versionId
        ? routineVersionsOf(routine, get().routineVersions).find(v => v.id === versionId)
        : undefined;
      const planned: PlannedRoutineSet[] = [];
      for (const item of (version ?? routine)?.items ?? []) {
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
        gymId: patch.gymId !== undefined ? patch.gymId : existing.gymId ?? null,
      };
      if (row.endedAt !== null && new Date(row.endedAt).getTime() < new Date(row.startedAt).getTime()) return 'order';
      // A patch that changes nothing writes nothing. Saving the row anyway
      // restamps it as a local change, and a sync then sends this copy over
      // one a peer has changed since (an agent's sets-only edit sending a
      // stale, unwritten copy over the phone's Health id is how a workout got
      // into Health twice).
      if (row.title === existing.title && row.notes === existing.notes && row.effort === existing.effort && (row.gymId ?? null) === (existing.gymId ?? null) && sameSpan(row, existing)) {
        return existing;
      }
      // Recorded, since nothing else says the times were moved by a person
      // rather than ended a little off by a watch (`watchCopyStale`). A start
      // moved at any point counts; an end only once there was one, because
      // `finishSession` writes the first end through here and that is the
      // finish, not an edit.
      if (row.startedAt !== existing.startedAt || (existing.endedAt !== null && row.endedAt !== existing.endedAt)) {
        row.timesEdited = true;
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
      //
      // **A workout the Apple Watch saved is rewritten as the phone's own**,
      // without its heart rate and energy: Health can't move a workout, so the
      // phone writes the new times and the watch retracts its copy. The
      // workout page says so before the change. Not retracted up front, as
      // the phone's own is: the watch's carries no sync identifier, so the
      // new write can't replace it, and a write Health then refused would
      // leave neither. `recordHealthWrite`'s take-over asks the watch once
      // the phone's copy is in; until then, and for good if it never lands,
      // the watch's stays.
      const stale = existing.healthWorkoutId;
      const retimed = existing.endedAt !== null && row.endedAt !== null && !sameSpan(existing, row);
      const rewrite = retimed && stale !== null && workoutHealthWriteOn();
      putSession(row);
      if (rewrite) {
        void (async () => {
          // In that order, and the write happens either way: a retract that
          // fails leaves the old workout for the person to remove in Health,
          // which beats Health holding neither.
          const retracted = existing.measuredOnWatch ? false : await retractFor(existing, [stale]);
          const result = await logWorkoutToHealth(row);
          recordHealthWrite(row, result, stale);
          if (result.outcome === 'written' || !retracted) return;
          const fresh = dbGetWorkoutSession(row.id);
          if (fresh && fresh.healthWorkoutId === stale) {
            stampHealth(fresh, { healthWorkoutId: null, healthWritePending: fresh.healthWritePending, measuredOnWatch: false });
          }
        })();
      }
      return row;
    },

    finishSession(id, options = {}) {
      const existing = get().sessions.find(s => s.id === id);
      if (!existing) return 'notFound';
      if (existing.endedAt !== null) return 'finished';
      const { completeLinkedTask = true, deferHealthWrite = false, ...patch } = options;
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
        const member = rotationPickFor(task, finished, getCurrentDayStart(), useSettingsStore.getState().weekStartsOn);
        const effect = workoutTaskEffect(task, member);
        if (effect === 'complete') tasks.completeTask(task!.id);
        else if (effect === 'log-unit') tasks.logQuotaUnit(task!.id);
        else if (effect === 'pick') tasks.logRotationUnit(task!.id, member!.id);
      }
      writeToHealth(finished, deferHealthWrite);
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
        measuredOnWatch: false,
        timesEdited: false,
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

    addWatchSession(input, { now = new Date(), deferHealthWrite = false } = {}) {
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
        // Saved by the watch with what it measured, when it measured anything;
        // the phone then writes nothing of its own (below).
        healthWorkoutId: input.health ? input.health.workoutId : null,
        healthWritePending: false,
        measuredOnWatch: !!input.health,
        timesEdited: false,
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
        supersetKey: st.supersetKey?.trim() || null,
        note: st.note?.trim() || null,
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
        const { dayResetTime, weekStartsOn } = useSettingsStore.getState();
        const member = rotationPickFor(task, session, getCurrentDayStart(), weekStartsOn);
        const effect = workoutTaskEffect(task, member);
        const endedToday = getLogicalDayKey(new Date(endedAt), dayResetTime) === getLogicalDayKey(now, dayResetTime);
        if (effect === 'complete') tasks.completeTask(task!.id, { completedAt: endedAt });
        else if (effect === 'log-unit' && endedToday) tasks.logQuotaUnit(task!.id);
        else if (effect === 'pick' && endedToday) tasks.logRotationUnit(task!.id, member!.id);
      }
      // A workout that reaches the phone more than a week after it ended is
      // history, not something to write now: the same answer the background
      // path gets, where the pending pass drops a flag that old
      // (`pendingWorkoutWriteAction`), so when it arrives decides nothing.
      // One the watch saved itself is in Health already, and the phone never
      // writes a second copy.
      if (!input.health && now.getTime() - endMs <= PENDING_WORKOUT_WRITE_MAX_AGE_DAYS * 86_400_000) {
        writeToHealth(session, deferHealthWrite);
      }
      return { session: get().sessions.find(x => x.id === session.id) ?? session, sets, duplicate: false, clashesWith };
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
          ...dumbbellFields(input.equipment, input.dumbbells, input.loadEntry),
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
          healthWritePending: planned.healthWritePending === true,
          measuredOnWatch: false,
          timesEdited: false,
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
      // A workout the Apple Watch saved is the watch's to retract; one it is
      // still measuring, or hasn't sent yet, it is told to throw away.
      const row = dbGetWorkoutSession(id);
      if (row?.healthWorkoutId) void retractFor(row, [row.healthWorkoutId]);
      else if (row?.measuredOnWatch) dropWatchMeasurement(row.id);
      dbDeleteWorkoutSession(id);
      const { [id]: _sets, ...setsBySession } = get().setsBySession;
      const { [id]: _count, ...setCounts } = get().setCounts;
      const { [id]: _volume, ...volumeKgBySession } = get().volumeKgBySession;
      set({ sessions: get().sessions.filter(s => s.id !== id), setsBySession, setCounts, volumeKgBySession });
    },

    discardSession() {
      const live = get().liveSession();
      if (live) get().deleteSession(live.id);
    },

    async writePendingHealthSessions() {
      if (pendingHealthWriteRunning) return;
      pendingHealthWriteRunning = true;
      try {
        for (const listed of dbGetPendingHealthWorkoutSessions()) {
          // Read again: the list was read before the first write's round
          // trip, and by now a row further down may have been deleted,
          // written by another pass, or given the watch's copy (all of which
          // clear the flag), or retimed. `recordHealthWrite` reads it once
          // more after its own write.
          const session = dbGetWorkoutSession(listed.id);
          if (!session?.healthWritePending) continue;
          const action = pendingWorkoutWriteAction(session);
          if (action === 'drop') {
            stampHealth(session, { healthWorkoutId: session.healthWorkoutId, healthWritePending: false });
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

    markWatchMeasuring(sessionId, on) {
      const fresh = dbGetWorkoutSession(sessionId);
      if (!fresh || fresh.healthWorkoutId !== null) return;
      if (on) {
        if (!fresh.measuredOnWatch) stampHealth(fresh, { healthWorkoutId: null, healthWritePending: fresh.healthWritePending, measuredOnWatch: true });
        return;
      }
      if (!fresh.measuredOnWatch) return;
      // Finished and held back for the watch's copy: the pending pass writes
      // it now, under Save's switches, since no watch workout is coming.
      const pending = fresh.healthWritePending
        || (fresh.endedAt !== null && workoutHealthWriteOn() && workoutSpanWritable(fresh));
      stampHealth(fresh, { healthWorkoutId: null, healthWritePending: pending, measuredOnWatch: false });
    },

    recordWatchHealthWorkout(sessionId, workoutId, span = null) {
      const fresh = dbGetWorkoutSession(sessionId);
      if (!fresh) {
        // Deleted here before the watch's workout arrived: it has nothing to
        // point at, so the watch takes it back out.
        if (workoutId) retractWatchWorkouts([workoutId]);
        return;
      }
      if (workoutId !== null && fresh.healthWorkoutId === workoutId) return;
      if (fresh.measuredOnWatch && fresh.healthWorkoutId !== null) {
        // A second watch workout for one session: the first one stands.
        if (workoutId) retractWatchWorkouts([workoutId]);
        return;
      }
      // Out of date for the row: retimed while the phone waited, or further
      // apart than a Finish tapped on both devices leaves them.
      const stale = workoutId !== null && watchCopyStale(fresh, span);
      if (fresh.healthWorkoutId !== null) {
        // The phone's own copy, written meanwhile (the fallback, or a write
        // started before the watch said it was measuring), is at the row's
        // times. It is the duplicate now, unless the watch's is the one out
        // of date, which the watch then retracts.
        if (stale) {
          retractWatchWorkouts([workoutId!]);
          return;
        }
        void retractWorkoutFromHealth([fresh.healthWorkoutId]);
      }
      stampHealth(fresh, { healthWorkoutId: workoutId, healthWritePending: false, measuredOnWatch: true });
      if (!stale || !workoutHealthWriteOn() || !workoutSpanWritable(fresh)) return;
      // The retime's own outcome, as though it had come after the watch's
      // copy: the phone writes the row's times, and the take-over has the
      // watch retract its copy once that lands.
      const holding = dbGetWorkoutSession(sessionId);
      if (!holding) return;
      void logWorkoutToHealth(holding).then(result => recordHealthWrite(holding, result, workoutId));
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
      if (input.id !== undefined && (input.id.trim() === '' || sets.some(s => s.id === input.id))) return 'taken';
      const same = sets.filter(s => s.exerciseId === input.exerciseId);
      const position = same.length > 0
        ? same[0].position
        : sets.reduce((max, s) => Math.max(max, s.position), -1) + 1;
      const row: WorkoutSet = {
        id: input.id ?? generateId(),
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

    noteExerciseOfSet(sessionId, setId, text) {
      const sets = get().loadSets(sessionId);
      const target = sets.find(s => s.id === setId);
      if (!target) return;
      const ofExercise = sets.filter(s => s.exerciseId === target.exerciseId);
      for (const p of exerciseDayNotePatches(ofExercise, text)) get().editSet(sessionId, p.setId, { note: p.note });
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

    removeSessionExercise(sessionId, exerciseId) {
      if (!get().sessions.some(s => s.id === sessionId)) return 'notFound';
      const sets = get().loadSets(sessionId);
      const dropped = sets.filter(s => s.exerciseId === exerciseId);
      if (dropped.length === 0) return 'notFound';
      const before = new Map(sets.map(s => [s.id, s]));
      const next = renumber(sets.filter(s => s.exerciseId !== exerciseId));
      dbTransaction(() => {
        for (const s of dropped) dbDeleteWorkoutSet(s.id);
        dbSaveWorkoutSets(next.filter(s => changed(s, before.get(s.id)!)));
      });
      putSets(sessionId, next);
      return true;
    },

    lastTimeFor(exerciseId, exceptSessionId) {
      return previousSets(dbGetWorkoutSetsForExercise(exerciseId), get().sessions, exceptSessionId);
    },

    addSessionExercise(sessionId, exerciseId, options = {}) {
      if (!get().sessions.some(s => s.id === sessionId)) return 'notFound';
      if (!exerciseKnown(exerciseId)) return 'notFound';
      const sets = get().loadSets(sessionId);
      if (sets.some(s => s.exerciseId === exerciseId)) return 'taken';
      const ids = (options.ids ?? []).filter(id => typeof id === 'string' && id.trim() !== '');
      if (ids.some(id => sets.some(s => s.id === id)) || new Set(ids).size !== ids.length) return 'taken';
      const position = sets.reduce((max, s) => Math.max(max, s.position), -1) + 1;
      const added = plannedSetsFromHistory(get().lastTimeFor(exerciseId, sessionId))
        .map((v, i) => plannedRow(sessionId, exerciseId, position, i, v, ids[i]));
      dbSaveWorkoutSets(added);
      putSets(sessionId, [...sets, ...added].sort(bySetOrder));
      return added;
    },

    swapSessionExercise(sessionId, fromExerciseId, toExerciseId) {
      if (!get().sessions.some(s => s.id === sessionId)) return 'notFound';
      if (!exerciseKnown(toExerciseId)) return 'notFound';
      const sets = get().loadSets(sessionId);
      if (fromExerciseId === toExerciseId || sets.some(s => s.exerciseId === toExerciseId)) return 'taken';
      const moving = swappableSets(sets, fromExerciseId).sort((a, b) => a.setIndex - b.setIndex);
      if (moving.length === 0) return 'notFound';
      const fromHasDone = sets.some(s => s.exerciseId === fromExerciseId && s.completedAt !== null);
      const order = sessionExercises(sets).flatMap(e =>
        e.exerciseId === fromExerciseId ? (fromHasDone ? [fromExerciseId, toExerciseId] : [toExerciseId]) : [e.exerciseId]);
      const positionOf = new Map<string, number>(order.map((id, i) => [id, i]));
      const last = matchPrevious(moving, get().lastTimeFor(toExerciseId, sessionId));
      const movedAt = new Map(moving.map((s, i) => [s.id, i]));
      const before = new Map(sets.map(s => [s.id, s]));
      const next = sets.map(s => {
        const i = movedAt.get(s.id);
        const prev = i === undefined ? null : last.get(s.id) ?? null;
        const base: WorkoutSet = i === undefined ? s : {
          ...s,
          exerciseId: toExerciseId,
          setIndex: i,
          weightKg: prev?.weightKg ?? null,
          reps: prev?.reps ?? s.reps,
          durationSeconds: prev?.durationSeconds ?? s.durationSeconds,
          distanceM: prev?.distanceM ?? s.distanceM,
        };
        return { ...base, position: positionOf.get(base.exerciseId)! };
      }).sort(bySetOrder);
      dbSaveWorkoutSets(next.filter(s => {
        const b = before.get(s.id)!;
        return changed(s, b) || s.exerciseId !== b.exerciseId || s.weightKg !== b.weightKg || s.reps !== b.reps;
      }));
      putSets(sessionId, next);
      return next.filter(s => s.exerciseId === toExerciseId);
    },

    addPlannedSet(sessionId, exerciseId, options = {}) {
      const sets = get().loadSets(sessionId);
      const mine = sets.filter(s => s.exerciseId === exerciseId);
      if (mine.length === 0) return 'notFound';
      const v = copyLastSet(mine);
      return get().logSet(sessionId, {
        ...(options.id !== undefined ? { id: options.id } : {}),
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

    addPlannedWarmups(sessionId, exerciseId, steps, options = {}) {
      if (!get().sessions.some(s => s.id === sessionId)) return 'notFound';
      const sets = get().loadSets(sessionId);
      const mine = sets.filter(s => s.exerciseId === exerciseId);
      if (mine.length === 0) return 'notFound';
      if (steps.length === 0) return [];
      const ids = (options.ids ?? []).filter(id => typeof id === 'string' && id.trim() !== '');
      if (ids.some(id => sets.some(s => s.id === id)) || new Set(ids).size !== ids.length) return 'taken';
      const added = steps.map((step, i) => plannedRow(sessionId, exerciseId, mine[0].position, i, {
        kind: 'warmup', weightKg: step.kg, reps: step.reps, durationSeconds: null, distanceM: null, supersetKey: mine[0].supersetKey,
      }, ids[i]));
      const shifted = sets.map(s => (s.exerciseId === exerciseId ? { ...s, setIndex: s.setIndex + steps.length } : s));
      dbSaveWorkoutSets([...added, ...shifted.filter(s => s.exerciseId === exerciseId)]);
      putSets(sessionId, [...shifted, ...added].sort(bySetOrder));
      return added;
    },

    moveSessionExercise(sessionId, exerciseId, direction) {
      if (!get().sessions.some(s => s.id === sessionId)) return false;
      const order = movedExerciseOrder(get().loadSets(sessionId), exerciseId, direction);
      if (!order) return false;
      get().reorderExercises(sessionId, order);
      return true;
    },

    joinSessionSuperset(sessionId, exerciseId, partnerId) {
      if (!get().sessions.some(s => s.id === sessionId)) return false;
      const sets = get().loadSets(sessionId);
      const next = joinedSuperset(sets, exerciseId, partnerId, generateId());
      if (!next) return false;
      const before = new Map(sets.map(s => [s.id, s]));
      dbSaveWorkoutSets(next.filter(s => changed(s, before.get(s.id)!)));
      putSets(sessionId, next);
      return true;
    },

    leaveSessionSuperset(sessionId, exerciseId) {
      if (!get().sessions.some(s => s.id === sessionId)) return false;
      const sets = get().loadSets(sessionId);
      const next = leftSuperset(sets, exerciseId);
      if (!next) return false;
      const before = new Map(sets.map(s => [s.id, s]));
      dbSaveWorkoutSets(next.filter(s => changed(s, before.get(s.id)!)));
      putSets(sessionId, next);
      return true;
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
