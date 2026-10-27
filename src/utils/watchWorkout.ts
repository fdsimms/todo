import { weightScale, type DumbbellEntry } from './dumbbellLoad';
import type {
  Exercise,
  ExerciseKind,
  PlateInventory,
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
import { plannedSetsFromHistory, restSecondsFor, sessionExercises, setBadge, setLabels, setName, walkOrder } from './workoutSession';
import { tickOutcome } from './workoutTick';
import { WEIGHT_STEP, formatWeightNumber, weightToDisplay } from './workoutData';
import { exerciseProposal, proposalRamp } from './workoutProposal';
import { proposalApplied, workingSetLogged } from './workoutProgression';
import { stepTimerRemaining, isStepTimerRunning } from './stepTimers';
import { myWorkoutStart } from './workoutSiri';
import { programProgress } from './workoutProgram';
import { currentWatchHealthRequests, recentlyFinished, type WatchHealthRequests } from './watchHealthWorkout';

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
 * **And what the watch's HealthKit session needs (phase 9):** whether a
 * workout on the watch may be measured and saved to Health at all
 * (`healthWrite`, the phone's own three switches, `workoutHealthWriteOn`),
 * when the phone's recent workouts ended (`finished`, so a measurement of the
 * phone's workout is saved ending when it did), and what the phone asks the
 * watch to retract or throw away (`retractWorkouts`, `dropSessions`;
 * `watchHealthWorkout.ts`).
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
 * about `MAX_WATCH_PLAN_SETS` sets each, cut only between whole exercises (a
 * superset as one), and `MAX_WATCH_LIVE_SETS` sets of a live workout. Both
 * carry `moreSets`, counting what was left off, so the watch never calls a
 * workout done while sets it never got are still to do. The routines are left out while a
 * workout is going on the phone: the watch logs into that one, so it has no
 * start list to show, and the plans are the expensive part to read.
 */

/** Routines on the watch's start list, "From Today" included. */
export const MAX_WATCH_ROUTINES = 8;
/**
 * Planned sets carried per routine: ten exercises of six. Whole exercises
 * only (`wholeExercises`), so a routine is cut between two exercises, never
 * partway through one.
 */
export const MAX_WATCH_PLAN_SETS = 60;
/** Sets of the phone's live workout carried to the watch. */
export const MAX_WATCH_LIVE_SETS = 100;
/** Exercises on the watch's "Add exercise" list. */
export const MAX_WATCH_RECENT = 60;
/** How far back that list reaches: what the person has logged lately. */
export const WATCH_RECENT_DAYS = 90;

/**
 * The next load for an exercise, as workout mode's card would propose it
 * (`exerciseProposal`), in the unit shown. Applied on the watch only on a tap
 * of Use, to the planned working sets (and the ramp's warm-ups) exactly as
 * `proposalWrites` would: the phone's own `applyProposal` does it for a
 * workout going on the phone.
 */
export interface WatchSuggestion {
  /** The first working set's weight, the one the button names. */
  weight: number;
  /** "Use 82.5", or "Use these" when the sets differ. */
  use: string;
  /** "All sets hit 8 last time" (`Proposal.brief`). */
  reason: string;
  /** The working sets proposed, in order. */
  sets: { weight: number; reps?: number }[];
  /** The warm-ups a ramp lays out from the new weight, when the exercise warms up with one. */
  ramp?: { weight: number; reps: number }[];
}

export interface WatchWorkoutExercise {
  id: string;
  name: string;
  /** What a set records, which the watch turns into its one or two boxes. */
  kind: ExerciseKind;
  /** The rest after one of its sets (`restSecondsFor`), which a set added on the watch takes. */
  rest: number;
  /** The suggestion card's proposal, when there is one with sets to use. */
  suggestion?: WatchSuggestion;
}

/**
 * An exercise the person has logged lately, for "Add exercise", with the sets
 * adding it lays out (`plannedSetsFromHistory` of last time), so a workout on
 * the watch alone can add it with no phone in reach.
 */
export interface WatchRecentExercise {
  id: string;
  name: string;
  kind: ExerciseKind;
  rest: number;
  sets: { kind: WorkoutSetKind; weight?: number; reps?: number; durationSeconds?: number; distanceM?: number }[];
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
  /** The note written on the set, if any. */
  note?: string;
  /** The superset it belongs to, which a workout run on the watch brings back with it. */
  supersetKey?: string;
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
  /** What starting it lays out, in walking order, whole exercises up to `MAX_WATCH_PLAN_SETS`. */
  plan: WatchWorkoutSet[];
  /**
   * Sets of the routine past the cap, left off whole exercises at a time.
   * The watch's own workout says so rather than calling itself done.
   */
  moreSets?: number;
}

export interface WatchWorkoutSnapshot {
  unit: WeightUnit;
  /** What one click of the Crown moves a weight by, in `unit` (`WEIGHT_STEP`). */
  weightStep: number;
  live: WatchLiveWorkout | null;
  /** Empty while `live` is set. */
  routines: WatchRoutine[];
  /** "Add exercise"'s list, A to Z, at most `MAX_WATCH_RECENT`. */
  recent: WatchRecentExercise[];
  /** The quiet-hours window (`"HH:MM"`), or null when it's off. */
  quietHours: { start: string; end: string } | null;
  /**
   * Whether the watch measures a workout it runs (its own, or the phone's)
   * with a HealthKit session and saves it to Health itself: Log to Health,
   * its Workouts row and the Workouts area, all on. Off, the watch runs a
   * workout as phase 8 did, with no session.
   */
  healthWrite: boolean;
  /** The phone's workouts finished in the last day, newest first (`recentlyFinished`). */
  finished: { sessionId: string; endedAt: string }[];
  /** Health workouts the watch saved that the phone asks it to retract. */
  retractWorkouts: string[];
  /** Sessions deleted on the phone whose measurement the watch should throw away. */
  dropSessions: string[];
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
  currentProgramId?: string | null;
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
    /** Rests set on exercises in this workout (`WorkoutSession.restOverrides`). */
    restOverrides?: Readonly<Record<string, number>> | null;
    /** Scales a two-dumbbell exercise's weights to a pair total where the person logs one (`dumbbellLoad.ts`). */
    dumbbellEntry?: DumbbellEntry;
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
      const outcome = tickOutcome(simulated, s.id, { routine: ctx.routine, defaultRestSeconds: ctx.defaultRestSeconds, exerciseName: name, restOverrides: ctx.restOverrides });
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
    if (s.weightKg !== null) row.weight = weightToDisplay(s.weightKg * scaleOf(ctx.exercises, s.exerciseId, ctx.dumbbellEntry), ctx.unit);
    if (s.reps !== null) row.reps = s.reps;
    if (s.durationSeconds !== null) row.durationSeconds = s.durationSeconds;
    if (s.distanceM !== null) row.distanceM = s.distanceM;
    if (s.completedAt !== null) row.doneAt = s.completedAt;
    if (s.note) row.note = s.note;
    if (s.supersetKey) row.supersetKey = s.supersetKey;
    return row;
  });
}

/**
 * What an exercise's stored one-dumbbell weights are multiplied by for the
 * watch: the watch is sent shown weights and sends them back, and
 * `planQuietTaps` puts them back (`dumbbellLoad.ts`).
 */
function scaleOf(exercises: readonly Exercise[], exerciseId: string, entry: DumbbellEntry | undefined): number {
  return weightScale(catalogExercise(exercises, exerciseId), entry ?? 'each');
}

/** What the exercises of one workout are read against, for their rest and their suggestion. */
interface ExerciseContext {
  exercises: readonly Exercise[];
  unit: WeightUnit;
  dumbbellEntry?: DumbbellEntry;
  routine: WorkoutRoutine | null;
  program: WorkoutProgram | null;
  sessions: readonly WorkoutSession[];
  routines: readonly WorkoutRoutine[];
  plateInventory: PlateInventory;
  defaultRestSeconds: number;
  restOverrides?: Readonly<Record<string, number>> | null;
  historyFor: (exerciseId: string) => readonly WorkoutSet[];
  /** The workout the suggestions are for, whose own sets aren't history yet. */
  exceptSessionId: string | null;
}

/**
 * The suggestion for an exercise, in the unit shown, or none: nothing
 * proposed, a proposal with no sets to use (a percentage program with no
 * training max yet, whose card only says so), or one `exerciseSets` already
 * ask for.
 */
export function watchSuggestion(exerciseId: string, ctx: ExerciseContext, exerciseSets: readonly WorkoutSet[] = []): WatchSuggestion | undefined {
  const p = exerciseProposal({
    exerciseId,
    exercises: ctx.exercises,
    routine: ctx.routine,
    program: ctx.program,
    sessions: ctx.sessions,
    routines: ctx.routines,
    history: ctx.historyFor(exerciseId),
    exceptSessionId: ctx.exceptSessionId,
    plateInventory: ctx.plateInventory,
    unit: ctx.unit,
    dumbbellEntry: ctx.dumbbellEntry,
  });
  if (!p || p.proposal.sets.length === 0) return undefined;
  const scale = scaleOf(ctx.exercises, exerciseId, ctx.dumbbellEntry);
  if (exerciseSets.length > 0 && proposalApplied(exerciseSets, p.proposal, ctx.unit)) return undefined;
  const shown = p.proposal.sets.map(s => formatWeightNumber(s.weightKg * scale, ctx.unit));
  const out: WatchSuggestion = {
    weight: weightToDisplay(p.proposal.sets[0].weightKg * scale, ctx.unit),
    use: shown.every(w => w === shown[0]) ? `Use ${shown[0]}` : 'Use these',
    reason: p.proposal.brief,
    sets: p.proposal.sets.map(s => (s.reps === null
      ? { weight: weightToDisplay(s.weightKg * scale, ctx.unit) }
      : { weight: weightToDisplay(s.weightKg * scale, ctx.unit), reps: s.reps })),
  };
  const ramp = proposalRamp(p);
  if (ramp && ramp.length > 0) out.ramp = ramp.map(step => ({ weight: weightToDisplay(step.kg * scale, ctx.unit), reps: step.reps }));
  return out;
}

/**
 * The exercises of the rows shown, in order. Each carries its suggestion only
 * while workout mode's card would offer it for these sets: none once a
 * working set is logged, or once the planned working sets already ask for it
 * (`workingSetLogged`, `proposalApplied`). The watch keeps to the same two
 * rules as its own sets change.
 */
function exercisesOf(rows: readonly { exerciseId: string }[], sets: readonly WorkoutSet[], ctx: ExerciseContext): WatchWorkoutExercise[] {
  const seen = new Set<string>();
  const out: WatchWorkoutExercise[] = [];
  for (const s of rows) {
    if (seen.has(s.exerciseId)) continue;
    seen.add(s.exerciseId);
    const entry: WatchWorkoutExercise = {
      id: s.exerciseId,
      name: exerciseName(ctx.exercises, s.exerciseId),
      kind: catalogExercise(ctx.exercises, s.exerciseId)?.kind ?? 'weight_reps',
      rest: restSecondsFor(ctx.routine, s.exerciseId, ctx.defaultRestSeconds, ctx.restOverrides),
    };
    const own = sets.filter(x => x.exerciseId === s.exerciseId);
    if (!workingSetLogged(own)) {
      const suggestion = watchSuggestion(s.exerciseId, ctx, own);
      if (suggestion) entry.suggestion = suggestion;
    }
    out.push(entry);
  }
  return out;
}

/**
 * "Add exercise"'s list: the exercises logged lately, A to Z, each with the
 * sets adding it lays out, in the unit shown.
 */
export function watchRecentExercises(
  recent: readonly { exerciseId: string; lastTime: readonly WorkoutSet[] }[],
  ctx: { exercises: readonly Exercise[]; unit: WeightUnit; defaultRestSeconds: number; dumbbellEntry?: DumbbellEntry },
): WatchRecentExercise[] {
  return recent
    .map(({ exerciseId, lastTime }): WatchRecentExercise => ({
      id: exerciseId,
      name: exerciseName(ctx.exercises, exerciseId),
      kind: catalogExercise(ctx.exercises, exerciseId)?.kind ?? 'weight_reps',
      rest: ctx.defaultRestSeconds,
      sets: plannedSetsFromHistory(lastTime).map(v => {
        const set: WatchRecentExercise['sets'][number] = { kind: v.kind };
        if (v.weightKg !== null) set.weight = weightToDisplay(v.weightKg * scaleOf(ctx.exercises, exerciseId, ctx.dumbbellEntry), ctx.unit);
        if (v.reps !== null) set.reps = v.reps;
        if (v.durationSeconds !== null) set.durationSeconds = v.durationSeconds;
        if (v.distanceM !== null) set.distanceM = v.distanceM;
        return set;
      }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, MAX_WATCH_RECENT);
}

/**
 * The rows of the first exercises that fit in `cap` sets, whole: a routine is
 * cut between two exercises, never partway through one, and a superset (its
 * exercises' sets alternate in the walk) is cut as one. The first exercise is
 * kept even if it alone is over the cap, so no routine comes back empty.
 */
export function wholeExercises<T extends { exerciseId: string }>(rows: readonly T[], cap: number): T[] {
  const lastIndex = new Map<string, number>();
  rows.forEach((row, i) => lastIndex.set(row.exerciseId, i));
  let end = -1;
  let kept = 0;
  for (let i = 0; i < rows.length; i++) {
    end = Math.max(end, lastIndex.get(rows[i].exerciseId)!);
    if (i === end) {
      // A block closes here: rows kept..i are one exercise, or one superset.
      if (i + 1 > cap && kept > 0) break;
      kept = i + 1;
    }
  }
  return rows.slice(0, kept);
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
  /** `workoutHealthWriteOn()`. */
  healthWrite: boolean;
  /** What the phone is asking of the watch's Health session (`useWatchHealthStore`). */
  watchRequests: WatchHealthRequests;
  /** Now, for which workouts finished lately and which requests still stand. */
  now: Date;
  unit: WeightUnit;
  dumbbellEntry?: DumbbellEntry;
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
  programs: readonly WorkoutProgram[];
  sessions: readonly WorkoutSession[];
  plateInventory: PlateInventory;
  /** `todaysWatchWorkout`. */
  todays: WatchTodaysWorkout | null;
  /** `plannedSetsForRoutine`, read only when there is no live workout. */
  planFor: (routineId: string) => readonly PlannedRoutineSet[];
  /** An exercise's sets from any session (`exerciseHistory`), for its suggestion. */
  historyFor: (exerciseId: string) => readonly WorkoutSet[];
  /** The exercises logged in the last `WATCH_RECENT_DAYS`, each with last time's sets. */
  recent: readonly { exerciseId: string; lastTime: readonly WorkoutSet[] }[];
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
  const requests = currentWatchHealthRequests(input.watchRequests, input.now);
  const base = {
    unit: input.unit,
    weightStep: WEIGHT_STEP[input.unit],
    quietHours,
    recent: watchRecentExercises(input.recent, input),
    healthWrite: input.healthWrite,
    finished: recentlyFinished(input.sessions, input.now),
    retractWorkouts: requests.retract.map(r => r.id),
    dropSessions: requests.drop.map(d => d.id),
  };
  const contextFor = (routine: WorkoutRoutine | null, programId: string | null, exceptSessionId: string | null, restOverrides: Readonly<Record<string, number>> | null = null): ExerciseContext => ({
    exercises: input.exercises,
    unit: input.unit,
    dumbbellEntry: input.dumbbellEntry,
    routine,
    program: programId ? input.programs.find(p => p.id === programId) ?? null : null,
    sessions: input.sessions,
    routines: input.routines,
    plateInventory: input.plateInventory,
    defaultRestSeconds: input.defaultRestSeconds,
    restOverrides,
    historyFor: input.historyFor,
    exceptSessionId,
  });

  if (input.live && input.live.session.endedAt === null) {
    const { session, sets, routine, rest } = input.live;
    const rows = watchSetRows(sets, { exercises: input.exercises, unit: input.unit, routine, defaultRestSeconds: input.defaultRestSeconds, restOverrides: session.restOverrides, dumbbellEntry: input.dumbbellEntry });
    const shown = rows.slice(0, MAX_WATCH_LIVE_SETS);
    return {
      ...base,
      live: {
        sessionId: session.id,
        title: session.title,
        startedAt: session.startedAt,
        exercises: exercisesOf(shown, sets, contextFor(routine, session.programId, session.id, session.restOverrides)),
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
    const rows = watchSetRows(planned, {
      exercises: input.exercises, unit: input.unit, routine, defaultRestSeconds: input.defaultRestSeconds, dumbbellEntry: input.dumbbellEntry,
    });
    const plan = wholeExercises(rows, MAX_WATCH_PLAN_SETS).map(({ id: _id, doneAt: _doneAt, ...row }) => row);
    const programId = today ? today.programId : routine.programId;
    const entry: WatchRoutine = {
      id: routine.id,
      name: routine.name,
      exerciseCount: new Set(planned.map(p => p.exerciseId)).size,
      fromToday: today !== null,
      exercises: exercisesOf(plan, planned, contextFor(routine, programId, null)),
      plan,
    };
    if (today?.taskId) entry.taskId = today.taskId;
    if (programId) entry.programId = programId;
    if (rows.length > plan.length) entry.moreSets = rows.length - plan.length;
    routines.push(entry);
  }
  return { ...base, live: null, routines };
}
