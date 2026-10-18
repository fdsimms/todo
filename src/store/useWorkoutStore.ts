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
  dbGetAllExercises,
  dbGetAllWorkoutPrograms,
  dbGetAllWorkoutRoutines,
  dbGetAllWorkoutSessions,
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
import { libraryExercise } from '../utils/exerciseLibrary';
import { buildCatalog } from '../utils/exerciseCatalog';
import {
  cleanWorkoutName,
  exerciseNameKey,
  readMuscles,
  readRoutineItems,
  readTrainingMaxes,
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
 * (phase 2 wires that through `completeTask`, the one direction it goes), and
 * a task ticked off with no session never invents one.
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
export type WorkoutRefusal = 'blank' | 'taken' | 'notFound' | 'hasHistory' | 'live' | 'finished';

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

  addProgram: (input: ProgramInput) => WorkoutProgram | WorkoutRefusal;
  updateProgram: (id: string, patch: ProgramPatch) => WorkoutProgram | WorkoutRefusal;
  /** Its routines stay, as routines on their own. */
  deleteProgram: (id: string) => void;

  /** The session in progress, if there is one. */
  liveSession: () => WorkoutSession | null;
  /** Starts a session. Refuses (`live`) while another is in progress. */
  startSession: (input?: StartSessionInput) => WorkoutSession | WorkoutRefusal;
  updateSession: (id: string, patch: SessionPatch) => WorkoutSession | WorkoutRefusal;
  /** Ends a session now (or at `endedAt`). Refuses one already finished (`finished`). */
  finishSession: (id: string, patch?: Omit<SessionPatch, 'endedAt'> & { endedAt?: string }) => WorkoutSession | WorkoutRefusal;
  /** Deletes a session and its sets, live or finished. */
  deleteSession: (id: string) => void;
  /** Throws away the live session and its sets. */
  discardSession: () => void;

  /** A session's sets, read from the database the first time and cached after. */
  loadSets: (sessionId: string) => WorkoutSet[];
  /** Every set ever logged against one exercise, oldest first. Not cached: an exercise's page reads it once. */
  exerciseHistory: (exerciseId: string) => WorkoutSet[];
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

/** Effort is a whole number 1 to 10, as typed. */
const effortOf = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 10 ? Math.round(v) : null;

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

  return {
    exercises: [],
    routines: [],
    programs: [],
    sessions: [],
    setsBySession: {},
    setCounts: {},
    initialized: false,

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
      const row: WorkoutRoutine = {
        id: generateId(),
        name: clean,
        notes: '',
        programId,
        sortOrder: routines.reduce((max, r) => Math.max(max, r.sortOrder), -1) + 1,
        items: readRoutineItems(items),
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
      const row: WorkoutRoutine = {
        ...existing,
        name,
        notes: patch.notes !== undefined ? patch.notes.trim() : existing.notes,
        programId: patch.programId !== undefined ? patch.programId : existing.programId,
        items: patch.items !== undefined ? readRoutineItems(patch.items) : existing.items,
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
      dbSaveWorkoutProgram(row);
      set({ programs: [...get().programs, row] });
      return row;
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
      dbSaveWorkoutProgram(row);
      set({ programs: get().programs.map(p => (p.id === id ? row : p)) });
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
      putSets(row.id, []);
      return row;
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
      putSession(row);
      return row;
    },

    finishSession(id, patch = {}) {
      const existing = get().sessions.find(s => s.id === id);
      if (!existing) return 'notFound';
      if (existing.endedAt !== null) return 'finished';
      return get().updateSession(id, { ...patch, endedAt: patch.endedAt ?? nowIso() });
    },

    deleteSession(id) {
      dbDeleteWorkoutSession(id);
      const { [id]: _sets, ...setsBySession } = get().setsBySession;
      const { [id]: _count, ...setCounts } = get().setCounts;
      set({ sessions: get().sessions.filter(s => s.id !== id), setsBySession, setCounts });
    },

    discardSession() {
      const live = get().liveSession();
      if (live) get().deleteSession(live.id);
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
