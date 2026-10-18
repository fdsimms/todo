import type { Task, WorkoutProgram, WorkoutRoutine, WorkoutSession } from '../types';
import { exerciseNameKey } from './workoutData';
import { programProgress } from './workoutProgram';
import type { StartWorkoutInput } from './startWorkout';

/**
 * "Start my workout" and "Start Push A", said to Siri: the routines it can
 * hear, the starts it queues, and what each one starts.
 *
 * `pantryIndex.ts` and `medicationIndex.ts` pointed at workouts.
 * `StartRoutineIntent`'s entity query matches a spoken routine against an index
 * the app writes into the App Group (`siri_workout_routines.json`), since
 * nothing in the intent's process can open SQLite, and both intents queue what
 * was said (`pending_workout_starts.json`) for `processPendingWorkoutStarts` in
 * widgetSync.ts to start on the next foreground. See docs/arch/workouts.md,
 * "Phase 6, as built".
 */

/** One routine as Siri can see it. Two fields, for the reason `PantryIndexEntry` gives. */
export interface WorkoutRoutineIndexEntry {
  id: string;
  name: string;
}

/** A ceiling for the intent process to read, not a product decision. */
export const MAX_ROUTINE_INDEX_ENTRIES = 200;

/**
 * Every routine Siri may start, sorted by name so an unchanged list writes the
 * same bytes. A routine has no archived state of its own (the Routines list
 * shows them all, and each one starts), so the only ones left out are those
 * with no name to say. Empty while the Workouts area is off: "Start Push A"
 * must not reach into an area that is switched off.
 */
export function buildRoutineIndex(
  routines: readonly Pick<WorkoutRoutine, 'id' | 'name'>[],
  workoutsEnabled: boolean,
): WorkoutRoutineIndexEntry[] {
  if (!workoutsEnabled) return [];
  return routines
    .filter(r => r.name.trim() !== '')
    .map(r => ({ id: r.id, name: r.name.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .slice(0, MAX_ROUTINE_INDEX_ENTRIES);
}

/** One start as an intent queued it. Both null: "start my workout". */
export interface QueuedWorkoutStart {
  routineId: string | null;
  name: string | null;
  /** The moment Siri was asked, when it parsed as one. */
  at: Date | null;
}

/**
 * The native drain's JSON, with anything malformed dropped silently: the file
 * was written by another process, and a drain must never fail a launch.
 */
export function parseQueuedWorkoutStarts(json: string): QueuedWorkoutStart[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: QueuedWorkoutStart[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { routineId, name, at } = entry as Record<string, unknown>;
    if (routineId !== undefined && routineId !== null && typeof routineId !== 'string') continue;
    if (name !== undefined && name !== null && typeof name !== 'string') continue;
    const when = typeof at === 'string' ? new Date(at) : null;
    out.push({
      routineId: typeof routineId === 'string' && routineId.trim() !== '' ? routineId : null,
      name: typeof name === 'string' && name.trim() !== '' ? name.trim() : null,
      at: when && !Number.isNaN(when.getTime()) ? when : null,
    });
  }
  return out;
}

/**
 * The one queued start that acts: the newest. Several in the queue only mean
 * the app was closed while Siri was asked more than once, and starting each
 * would start several workouts, of which the store keeps one anyway. The
 * intents only ever append, at the moment they are asked, so the newest is the
 * last one in the file.
 */
export function newestWorkoutStart(queued: readonly QueuedWorkoutStart[]): QueuedWorkoutStart | null {
  return queued.length > 0 ? queued[queued.length - 1] : null;
}

/** What a queued start does. */
export type WorkoutStartPlan =
  /** Nothing: the Workouts area is off, or nothing was queued. */
  | { kind: 'none' }
  /** A workout is already going: open it. */
  | { kind: 'showLive' }
  | { kind: 'start'; input: StartWorkoutInput }
  /** Nothing to start on its own: open the Workouts screen to pick one. */
  | { kind: 'openWorkouts' };

/**
 * How long a queued start stays good. The intent brings the app forward as it
 * queues, so a start drained much later is one that waited out demo mode or a
 * launch that never drained it, and starting a workout then, hours after it
 * was asked for, is starting one nobody asked for now.
 */
export const QUEUED_START_MAX_AGE_MS = 5 * 60_000;

type ProgramRow = Pick<WorkoutProgram, 'id' | 'rotation' | 'weeks' | 'startedAt' | 'archived'>;
type SessionRow = Pick<WorkoutSession, 'programId' | 'routineId' | 'endedAt' | 'startedAt'>;

/**
 * The first workout task on Today, in Today's order, that has something to
 * start: a routine that still exists, or a program in use with a next routine.
 */
function firstWorkoutTask(
  todayTasks: readonly Task[],
  routines: readonly Pick<WorkoutRoutine, 'id'>[],
  programs: readonly ProgramRow[],
  sessions: readonly SessionRow[],
  routineId: string | null = null,
): Task | null {
  return todayTasks.find(t => {
    if (t.completed || t.archived) return false;
    if (routineId !== null) return t.workoutRoutineId === routineId;
    if (t.workoutProgramId) {
      const program = programs.find(p => p.id === t.workoutProgramId);
      return !!program && !program.archived && programProgress(program, sessions, routines).nextRoutineId !== null;
    }
    if (t.workoutRoutineId) return routines.some(r => r.id === t.workoutRoutineId);
    return false;
  }) ?? null;
}

/**
 * What the newest queued start does.
 *
 * **A routine** ("Start Push A") resolves by the id the entity query picked,
 * then by the spoken name with the area's own name key (`exerciseNameKey`), in
 * case the id has gone since the index was written. It starts that routine,
 * for the first task on Today that names it if there is one, so finishing the
 * workout completes that task the way the task's own Workout button would.
 * A name nothing matches opens the Workouts screen.
 *
 * **"My workout"**, in order:
 * 1. the workout already going;
 * 2. the first workout task on Today (its routine, or its program's next
 *    routine), started for that task so finishing completes it;
 * 3. with exactly one program in use, its next routine;
 * 4. otherwise nothing is started, and the Workouts screen opens.
 *
 * A routine asked for while another workout is going is left to `startWorkout`,
 * which says so rather than replacing it; the same routine asked for again
 * just opens it. A start asked for more than `QUEUED_START_MAX_AGE_MS` ago is
 * dropped.
 */
export function resolveQueuedWorkoutStart(
  queued: readonly QueuedWorkoutStart[],
  ctx: {
    workoutsEnabled: boolean;
    live: Pick<WorkoutSession, 'id' | 'routineId'> | null;
    routines: readonly Pick<WorkoutRoutine, 'id' | 'name'>[];
    programs: readonly ProgramRow[];
    sessions: readonly SessionRow[];
    /** What Today shows, in its order (`visibleTasks()`). */
    todayTasks: readonly Task[];
    now: Date;
  },
): WorkoutStartPlan {
  if (!ctx.workoutsEnabled) return { kind: 'none' };
  const entry = newestWorkoutStart(queued);
  if (!entry) return { kind: 'none' };
  // The intent always stamps when it was asked; one without a time, or asked
  // too long ago, is dropped rather than acted on late (QUEUED_START_MAX_AGE_MS).
  if (entry.at === null || ctx.now.getTime() - entry.at.getTime() > QUEUED_START_MAX_AGE_MS) return { kind: 'none' };

  if (entry.routineId !== null || entry.name !== null) {
    const routine = (entry.routineId ? ctx.routines.find(r => r.id === entry.routineId) : undefined)
      ?? (entry.name ? ctx.routines.find(r => exerciseNameKey(r.name) === exerciseNameKey(entry.name as string)) : undefined);
    if (!routine) return { kind: 'openWorkouts' };
    // The routine asked for is the one already going: open it, rather than
    // have startWorkout ask about a workout in progress that is this one.
    if (ctx.live && ctx.live.routineId === routine.id) return { kind: 'showLive' };
    const task = firstWorkoutTask(ctx.todayTasks, ctx.routines, ctx.programs, ctx.sessions, routine.id);
    return { kind: 'start', input: { routineId: routine.id, taskId: task?.id ?? null } };
  }

  if (ctx.live) return { kind: 'showLive' };

  const mine = myWorkoutStart(ctx);
  return mine ? { kind: 'start', input: mine } : { kind: 'openWorkouts' };
}

/**
 * Today's workout, in the order "my workout" picks it (steps 2 and 3 above):
 * the first workout task on Today, else the next routine of the one program in
 * use. Null when neither has anything to start. Shared with the Apple Watch's
 * start list (`watchWorkout.ts`), whose "From Today" row is this answer, so the
 * watch and Siri can't come to disagree about what today's workout is.
 */
export function myWorkoutStart(ctx: {
  routines: readonly Pick<WorkoutRoutine, 'id'>[];
  programs: readonly ProgramRow[];
  sessions: readonly SessionRow[];
  todayTasks: readonly Task[];
}): StartWorkoutInput | null {
  const task = firstWorkoutTask(ctx.todayTasks, ctx.routines, ctx.programs, ctx.sessions);
  if (task) {
    return task.workoutProgramId
      ? { programId: task.workoutProgramId, taskId: task.id }
      : { routineId: task.workoutRoutineId, taskId: task.id };
  }
  const inUse = ctx.programs.filter(p => !p.archived);
  if (inUse.length === 1 && programProgress(inUse[0], ctx.sessions, ctx.routines).nextRoutineId) {
    return { programId: inUse[0].id };
  }
  return null;
}
