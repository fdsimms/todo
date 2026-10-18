import type {
  Exercise,
  ExerciseKind,
  RestTimer,
  Task,
  WorkoutProgram,
  WorkoutRoutine,
  WorkoutSession,
  WorkoutSet,
  WorkoutSetKind,
} from '../types';
import type { WeightUnit } from './weightLog';
import type { PlannedRoutineSet } from '../store/useWorkoutStore';
import { catalogExercise, exerciseName } from './exerciseCatalog';
import { sessionExercises, setBadge, setLabels, setName, walkOrder } from './workoutSession';
import { tickOutcome } from './workoutTick';
import { WEIGHT_STEP, weightToDisplay } from './workoutData';
import { stepTimerRemaining, isStepTimerRunning } from './stepTimers';
import { myWorkoutStart } from './workoutSiri';
import { programProgress } from './workoutProgram';

/**
 * The Apple Watch's workout (phase 8, "Watch W1"): what the watch is told, and
 * what it sends back. See docs/arch/workouts.md, "Phase 8, as built".
 *
 * **Out to the watch** (`buildWatchWorkout`): a `workout` section on the
 * watch's copy of the widget snapshot only (never the widget's own), holding
 * the workout going on the phone (`live`), or, with none going, the routines a
 * workout can be started from on the watch with no phone in reach
 * (`routines`), each with the sets `startSession` would lay out right now
 * (`plannedSetsForRoutine`), so last time's numbers and the warm-up ramp travel
 * with it. Plus the quiet-hours window, which the watch's own rest alert keeps
 * to as the phone's rest does.
 *
 * **Nothing here is a rule the watch has to know.** Each set arrives in the
 * order it is done (`walkOrder`, supersets alternated), worded ("Set 3 of 4",
 * "Warm-up", "Next: Bench press, set 4"), in the unit shown, and with the rest
 * ticking it starts, worked out here by the same `tickOutcome` workout mode
 * uses. The watch walks the list in order and reads those answers, so it has
 * no copy of the superset or rest rules to drift from them.
 *
 * **Back from the watch**: a set done on the phone's workout arrives as a quiet
 * tap with its numbers in the unit shown, and a workout the watch ran on its
 * own arrives whole when it is finished; both are read in `widgetQuietTaps.ts`
 * (`tickValuesFromWatch`, `parseWatchSession`), converted to kilograms there, once.
 *
 * **Capped**, because the watch's copy travels as one compressed
 * WatchConnectivity context: at most `MAX_WATCH_ROUTINES` routines with
 * `MAX_WATCH_PLAN_SETS` sets each, and `MAX_WATCH_LIVE_SETS` sets of a live
 * workout (`moreSets` counts the rest, so the watch can say they're on the
 * phone rather than call the workout done). The routines are left out while a
 * workout is going on the phone: the watch logs into that one, so it has no
 * start list to show, and the plans are the expensive part to read.
 */

/** Routines on the watch's start list, "From Today" included. */
export const MAX_WATCH_ROUTINES = 8;
/** Planned sets carried per routine: eight exercises of five sets. */
export const MAX_WATCH_PLAN_SETS = 40;
/** Sets of the phone's live workout carried to the watch. */
export const MAX_WATCH_LIVE_SETS = 100;

export interface WatchWorkoutExercise {
  id: string;
  name: string;
  /** What a set records, which the watch turns into its one or two boxes. */
  kind: ExerciseKind;
}

/**
 * One set as the watch draws and logs it. Optional numbers are left out of
 * the JSON rather than written as null, to keep the context small; the Swift
 * side decodes every field with `decodeIfPresent`.
 */
export interface WatchWorkoutSet {
  /** The phone's set id, on a live workout's sets. A plan's sets have none; the watch makes its own. */
  id?: string;
  exerciseId: string;
  position: number;
  setIndex: number;
  kind: WorkoutSetKind;
  /** "Set 3 of 4", or "Warm-up" / "Drop set". Working sets are numbered as workout mode's SET column numbers them. */
  label: string;
  /** "W" or "D", drawn in front of the label in orange. */
  badge?: string;
  /** What the rest screen says while this is the set that's next: "Next: Bench press, set 4". */
  next: string;
  /**
   * The rest ticking this set starts, in seconds, done in walking order: more
   * than 0 starts one; 0 drops the rest going (the exercise asks for none); -1
   * leaves it as it is (mid superset round, where the partner is next).
   */
  rest: number;
  /** In the unit shown (`WatchWorkoutSnapshot.unit`). */
  weight?: number;
  reps?: number;
  durationSeconds?: number;
  distanceM?: number;
  /** When it was done, on a live workout's done sets. */
  doneAt?: string;
}

export interface WatchLiveWorkout {
  sessionId: string;
  title: string;
  startedAt: string;
  exercises: WatchWorkoutExercise[];
  /** In walking order, at most `MAX_WATCH_LIVE_SETS`. */
  sets: WatchWorkoutSet[];
  /** Sets past the cap, which only the phone shows. */
  moreSets: number;
  /** The phone's rest for this workout while it counts down or has run out, else null. */
  rest: { id: string; startedAt: string; endsAt: string } | null;
}

export interface WatchRoutine {
  /** The routine to start. For a program, its next routine. */
  id: string;
  name: string;
  exerciseCount: number;
  /** Today's workout ("From Today"), first on the list. */
  fromToday: boolean;
  /** The task occurrence it is for, which finishing completes, as starting from its row would. */
  taskId?: string;
  /** The program it counts toward. */
  programId?: string;
  exercises: WatchWorkoutExercise[];
  /** What starting it lays out, in walking order, at most `MAX_WATCH_PLAN_SETS`. */
  plan: WatchWorkoutSet[];
}

export interface WatchWorkoutSnapshot {
  unit: WeightUnit;
  /** What one click of the Crown moves a weight by, in `unit` (`WEIGHT_STEP`). */
  weightStep: number;
  live: WatchLiveWorkout | null;
  /** Empty while `live` is set. */
  routines: WatchRoutine[];
  /** The quiet-hours window (`"HH:MM"`), or null when it's off. */
  quietHours: { start: string; end: string } | null;
}

/** What "From Today" starts, resolved to a routine. */
export interface WatchTodaysWorkout {
  routineId: string;
  taskId: string | null;
  programId: string | null;
}

/**
 * Today's workout as the watch's start list shows it: `myWorkoutStart` (the
 * order Siri's "my workout" uses), with a program turned into its next routine
 * the way `startWorkout` turns one. Null when there's nothing to start.
 */
export function todaysWatchWorkout(ctx: {
  routines: readonly WorkoutRoutine[];
  programs: readonly WorkoutProgram[];
  sessions: readonly WorkoutSession[];
  todayTasks: readonly Task[];
}): WatchTodaysWorkout | null {
  const start = myWorkoutStart(ctx);
  if (!start) return null;
  if (start.programId) {
    const program = ctx.programs.find(p => p.id === start.programId);
    if (!program) return null;
    const routineId = programProgress(program, ctx.sessions, ctx.routines).nextRoutineId;
    if (!routineId || !ctx.routines.some(r => r.id === routineId)) return null;
    return { routineId, taskId: start.taskId ?? null, programId: program.id };
  }
  if (!start.routineId || !ctx.routines.some(r => r.id === start.routineId)) return null;
  const routine = ctx.routines.find(r => r.id === start.routineId)!;
  return { routineId: routine.id, taskId: start.taskId ?? null, programId: routine.programId ?? null };
}

function lowerFirst(text: string): string {
  return text ? `${text.charAt(0).toLowerCase()}${text.slice(1)}` : text;
}

const SIMULATED_DONE = '1970-01-01T00:00:00.000Z';

/**
 * A session's sets as the watch walks them: worded, in the unit shown, and
 * each with the rest ticking it starts. The rest is `tickOutcome`'s answer for
 * the set ticked after every open set before it in walking order, which is how
 * the watch does them; a set already done keeps 0.
 */
export function watchSetRows(
  sets: readonly WorkoutSet[],
  ctx: {
    exercises: readonly Exercise[];
    unit: WeightUnit;
    routine: Pick<WorkoutRoutine, 'items'> | null;
    defaultRestSeconds: number;
  },
): WatchWorkoutSet[] {
  const walk = walkOrder(sets);
  const order = new Map(walk.map((s, i) => [s.id, i]));
  const labels = new Map<string, string>();
  const workingCount = new Map<string, number>();
  for (const ex of sessionExercises(sets)) {
    for (const [id, label] of setLabels(ex.sets)) labels.set(id, label);
    workingCount.set(ex.exerciseId, ex.sets.filter(s => setBadge(s.kind) === null).length);
  }
  return walk.map((s, i): WatchWorkoutSet => {
    const label = labels.get(s.id) ?? '';
    const badge = setBadge(s.kind);
    const name = exerciseName(ctx.exercises, s.exerciseId);
    const which = badge === null ? `Set ${label} of ${workingCount.get(s.exerciseId) ?? 0}` : setName(s.kind, label);
    const short = badge === null ? `set ${label}` : lowerFirst(setName(s.kind, label));
    let rest = 0;
    if (s.completedAt === null) {
      const simulated = sets.map(x => (x.completedAt === null && (order.get(x.id) ?? Infinity) <= i ? { ...x, completedAt: SIMULATED_DONE } : x));
      const outcome = tickOutcome(simulated, s.id, { routine: ctx.routine, defaultRestSeconds: ctx.defaultRestSeconds, exerciseName: name });
      const plan = outcome?.restPlan;
      rest = !plan ? 0 : plan.kind === 'start' ? plan.seconds : plan.kind === 'keep' ? -1 : 0;
    }
    const row: WatchWorkoutSet = {
      id: s.id,
      exerciseId: s.exerciseId,
      position: s.position,
      setIndex: s.setIndex,
      kind: s.kind,
      label: which,
      next: `Next: ${name}, ${short}`,
      rest,
    };
    if (badge !== null) row.badge = badge;
    if (s.weightKg !== null) row.weight = weightToDisplay(s.weightKg, ctx.unit);
    if (s.reps !== null) row.reps = s.reps;
    if (s.durationSeconds !== null) row.durationSeconds = s.durationSeconds;
    if (s.distanceM !== null) row.distanceM = s.distanceM;
    if (s.completedAt !== null) row.doneAt = s.completedAt;
    return row;
  });
}

function exercisesOf(sets: readonly { exerciseId: string }[], exercises: readonly Exercise[]): WatchWorkoutExercise[] {
  const seen = new Set<string>();
  const out: WatchWorkoutExercise[] = [];
  for (const s of sets) {
    if (seen.has(s.exerciseId)) continue;
    seen.add(s.exerciseId);
    out.push({
      id: s.exerciseId,
      name: exerciseName(exercises, s.exerciseId),
      kind: catalogExercise(exercises, s.exerciseId)?.kind ?? 'weight_reps',
    });
  }
  return out;
}

/** A plan's rows as unsaved sets, so the session rules can read them. */
function plannedAsSets(plan: readonly PlannedRoutineSet[]): WorkoutSet[] {
  return plan.map((p, i) => ({
    id: `plan-${i}`,
    sessionId: '',
    exerciseId: p.exerciseId,
    position: p.position,
    setIndex: p.setIndex,
    kind: p.values.kind,
    weightKg: p.values.weightKg,
    reps: p.values.reps,
    durationSeconds: p.values.durationSeconds,
    distanceM: p.values.distanceM,
    rpe: null,
    completedAt: null,
    supersetKey: p.values.supersetKey,
    note: null,
  }));
}

/** The phone's rest for this session, as two fixed instants, while it is running. */
function liveRest(rest: RestTimer | null, sessionId: string): WatchLiveWorkout['rest'] {
  if (!rest || rest.sessionId !== sessionId || !isStepTimerRunning(rest)) return null;
  const startedMs = Date.parse(rest.startedAt as string);
  if (!Number.isFinite(startedMs)) return null;
  // Measured at its own start, as the Live Activity does, so the end is fixed.
  const endsMs = Math.max(startedMs, startedMs + stepTimerRemaining(rest, startedMs) * 1000);
  return { id: rest.id, startedAt: new Date(startedMs).toISOString(), endsAt: new Date(endsMs).toISOString() };
}

export interface WatchWorkoutInput {
  workoutsEnabled: boolean;
  unit: WeightUnit;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  exercises: readonly Exercise[];
  defaultRestSeconds: number;
  /** The phone's workout in progress, with its sets, routine and rest. */
  live: {
    session: WorkoutSession;
    sets: readonly WorkoutSet[];
    routine: WorkoutRoutine | null;
    rest: RestTimer | null;
  } | null;
  routines: readonly WorkoutRoutine[];
  /** `todaysWatchWorkout`. */
  todays: WatchTodaysWorkout | null;
  /** `plannedSetsForRoutine`, read only when there is no live workout. */
  planFor: (routineId: string) => readonly PlannedRoutineSet[];
}

/**
 * Pure. The watch's workout section, or null when the Workouts area is off
 * (demo mode never gets this far: `widgetBridge()` sends nothing then).
 */
export function buildWatchWorkout(input: WatchWorkoutInput): WatchWorkoutSnapshot | null {
  if (!input.workoutsEnabled) return null;
  const quietHours = input.quietHoursStart && input.quietHoursEnd && input.quietHoursStart !== input.quietHoursEnd
    ? { start: input.quietHoursStart, end: input.quietHoursEnd }
    : null;
  const base = { unit: input.unit, weightStep: WEIGHT_STEP[input.unit], quietHours };

  if (input.live && input.live.session.endedAt === null) {
    const { session, sets, routine, rest } = input.live;
    const rows = watchSetRows(sets, { exercises: input.exercises, unit: input.unit, routine, defaultRestSeconds: input.defaultRestSeconds });
    const shown = rows.slice(0, MAX_WATCH_LIVE_SETS);
    return {
      ...base,
      live: {
        sessionId: session.id,
        title: session.title,
        startedAt: session.startedAt,
        exercises: exercisesOf(shown, input.exercises),
        sets: shown,
        moreSets: rows.length - shown.length,
        rest: liveRest(rest, session.id),
      },
      routines: [],
    };
  }

  const ordered: { routine: WorkoutRoutine; today: WatchTodaysWorkout | null }[] = [];
  const todays = input.todays ? input.routines.find(r => r.id === input.todays!.routineId) : undefined;
  if (todays) ordered.push({ routine: todays, today: input.todays });
  const rest = input.routines
    .filter(r => r.id !== todays?.id)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  for (const routine of rest) ordered.push({ routine, today: null });

  const routines: WatchRoutine[] = [];
  for (const { routine, today } of ordered) {
    if (routines.length >= MAX_WATCH_ROUTINES) break;
    const planned = plannedAsSets(input.planFor(routine.id));
    // A routine with nothing in it has nothing to log on the watch.
    if (planned.length === 0) continue;
    const plan = watchSetRows(planned, {
      exercises: input.exercises, unit: input.unit, routine, defaultRestSeconds: input.defaultRestSeconds,
    }).slice(0, MAX_WATCH_PLAN_SETS).map(({ id: _id, doneAt: _doneAt, ...row }) => row);
    const entry: WatchRoutine = {
      id: routine.id,
      name: routine.name,
      exerciseCount: new Set(planned.map(p => p.exerciseId)).size,
      fromToday: today !== null,
      exercises: exercisesOf(plan, input.exercises),
      plan,
    };
    if (today?.taskId) entry.taskId = today.taskId;
    const programId = today ? today.programId : routine.programId;
    if (programId) entry.programId = programId;
    routines.push(entry);
  }
  return { ...base, live: null, routines };
}
