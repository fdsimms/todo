import type { WorkoutProgram, WorkoutRoutine, WorkoutSession } from '../types';
import { PROGRESSION_LABELS } from './workoutRoutine';

/**
 * Where a program is: which routine comes next and which week it is, read off
 * the finished sessions that carry the program's id. Pure; the Workouts
 * screen, the task row's "Workout" and the MCP server's `next_workout` all ask
 * it. See docs/arch/workouts.md, phase 4.
 *
 * **Derived, never stored.** A program keeps its rotation and nothing about
 * progress: no cursor, no "current week". Deleting a session moves the program
 * back, and a session logged on another device moves it on, with nothing to
 * reconcile.
 *
 * **A week is one pass through the rotation**, not a calendar week. A program
 * moves on only by workouts done, so a week off waits rather than skipping a
 * week of the plan (a step that runs out waits, as in focus sessions). "Week 3
 * of 4" means the third time round.
 *
 * **The rotation follows what was done.** Doing the routine that is next moves
 * on by one; doing a later one in the rotation skips to just after it; doing
 * one the rotation doesn't hold (a routine taken out of it since) changes
 * nothing. A routine can come round more than once in a rotation (A, B, A),
 * which is why this walks the sessions rather than looking up the last one.
 *
 * `startedAt` is where the count starts: sessions before it don't count, which
 * is how a program starts over (a new cycle with raised training maxes).
 */

export interface ProgramProgress {
  /** Finished sessions counted. */
  sessionsDone: number;
  /** Complete passes through the rotation. */
  passes: number;
  /** Where in the rotation the next workout is, or null for an empty rotation. */
  nextIndex: number | null;
  nextRoutineId: string | null;
  /** 1-based, within the cycle when the program has a length. */
  week: number;
  weeks: number | null;
  /**
   * A whole cycle has just been done and nothing of the next one yet: the
   * moment to raise a percentage program's training maxes.
   */
  cycleDone: boolean;
}

/** The rotation with routines nobody has any more left out, when the caller knows which exist. */
export function liveRotation(
  program: Pick<WorkoutProgram, 'rotation'>,
  routines: readonly Pick<WorkoutRoutine, 'id'>[] | null,
): string[] {
  if (!routines) return [...program.rotation];
  const known = new Set(routines.map(r => r.id));
  return program.rotation.filter(id => known.has(id));
}

/** The finished sessions that count toward a program, oldest first. */
export function programSessions<S extends Pick<WorkoutSession, 'programId' | 'endedAt' | 'startedAt'>>(
  program: Pick<WorkoutProgram, 'id' | 'startedAt'>,
  sessions: readonly S[],
): S[] {
  const from = program.startedAt ? new Date(program.startedAt).getTime() : -Infinity;
  return sessions
    .filter(s => s.programId === program.id && s.endedAt !== null && new Date(s.startedAt).getTime() >= from)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function programProgress(
  program: Pick<WorkoutProgram, 'id' | 'rotation' | 'weeks' | 'startedAt'>,
  sessions: readonly Pick<WorkoutSession, 'programId' | 'routineId' | 'endedAt' | 'startedAt'>[],
  routines: readonly Pick<WorkoutRoutine, 'id'>[] | null = null,
): ProgramProgress {
  const rotation = liveRotation(program, routines);
  const counted = programSessions(program, sessions);
  const n = rotation.length;
  const weeks = program.weeks !== null && program.weeks > 0 ? program.weeks : null;
  if (n === 0) {
    return { sessionsDone: counted.length, passes: 0, nextIndex: null, nextRoutineId: null, week: 1, weeks, cycleDone: false };
  }
  // `step` counts rotation slots gone through, skipped ones included.
  let step = 0;
  for (const s of counted) {
    for (let k = 0; k < n; k++) {
      if (rotation[(step + k) % n] === s.routineId) {
        step += k + 1;
        break;
      }
    }
  }
  const passes = Math.floor(step / n);
  const nextIndex = step % n;
  const week = weeks !== null ? (passes % weeks) + 1 : passes + 1;
  const cycleDone = weeks !== null && passes > 0 && passes % weeks === 0 && nextIndex === 0;
  return { sessionsDone: counted.length, passes, nextIndex, nextRoutineId: rotation[nextIndex], week, weeks, cycleDone };
}

/** A program that can be the current one: not archived, and with something in its rotation. */
export function isRunnableProgram(program: Pick<WorkoutProgram, 'archived' | 'rotation'>): boolean {
  return !program.archived && program.rotation.length > 0;
}

/**
 * The program "my workout", `next_workout` and the Workouts screen's Start
 * default to. `currentId` is the person's pick (`currentProgramId` setting);
 * it is only a pointer, so it is **read, never trusted**: one that was
 * archived, emptied or deleted since is passed over rather than cleaned up,
 * which is what keeps it free of a migration or a sweep.
 *
 * With no usable pick, exactly one runnable program is the current one by
 * itself (nobody with a single program has to set anything), and several
 * with no pick have none, so a caller asks rather than guesses.
 */
export function currentProgram<P extends Pick<WorkoutProgram, 'id' | 'archived' | 'rotation'>>(
  programs: readonly P[],
  currentId: string | null | undefined,
): P | null {
  const runnable = programs.filter(isRunnableProgram);
  const picked = currentId ? runnable.find(p => p.id === currentId) : undefined;
  if (picked) return picked;
  return runnable.length === 1 ? runnable[0] : null;
}

/** "Week 2 of 8", "Week 3": where the program is, as its row reads. */
export function weekLabel(progress: Pick<ProgramProgress, 'week' | 'weeks'>): string {
  return progress.weeks !== null ? `Week ${progress.week} of ${progress.weeks}` : `Week ${progress.week}`;
}

/**
 * The line under a program's name: "Week 2 of 8 · Rep range · Next: Lower A".
 * A cycle just finished says so in place of the week.
 */
export function describeProgress(
  program: Pick<WorkoutProgram, 'scheme' | 'weeks'>,
  progress: ProgramProgress,
  routineName: (id: string) => string | null,
): string {
  const parts: string[] = [];
  parts.push(progress.cycleDone && progress.weeks !== null
    ? `${progress.weeks}-week program done`
    : weekLabel(progress));
  if (program.scheme) parts.push(PROGRESSION_LABELS[program.scheme]);
  const next = progress.nextRoutineId ? routineName(progress.nextRoutineId) : null;
  parts.push(next ? `Next: ${next}` : 'No routines yet');
  return parts.join(' · ');
}
