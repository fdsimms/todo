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
 * **Doing the last routine again is a redo, not a skip.** Read as "later in
 * the rotation", a second Press straight after Press wrapped round into the
 * next week, skipping the rest of this one and moving every percentage on. So
 * a session of the routine the one before it was changes nothing, unless it is
 * also the next one due (a rotation of one routine). Any other earlier routine
 * still reads as the next week begun, which is how the rest of a week (a
 * deload's last days) is skipped.
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
   * A whole cycle has been done and the program is in the first week of the
   * next: the time to raise a percentage program's training maxes. It covers
   * the whole week rather than only the moment before its first workout, so a
   * skipped last day (which steps straight past that moment) still offers it.
   */
  cycleDone: boolean;
  /**
   * While `cycleDone`, when the first workout after the program's first cycle
   * was started, or null before there is one. "Start next cycle" counts from
   * here, so workouts already done past the cycle keep counting. It is the
   * first cycle's end rather than the latest because the count only restarts
   * when the next cycle is started: anything after that end is past it.
   */
  cycleStartedAt: string | null;
}

/**
 * Where "Start next cycle" counts the program from: the first workout of the
 * new cycle when one is done (so it keeps counting, as week 1's first day),
 * else now.
 */
export function nextCycleStart(progress: Pick<ProgramProgress, 'cycleStartedAt'>, now: Date = new Date()): string {
  return progress.cycleStartedAt ?? now.toISOString();
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
    return { sessionsDone: counted.length, passes: 0, nextIndex: null, nextRoutineId: null, week: 1, weeks, cycleDone: false, cycleStartedAt: null };
  }
  // `step` counts rotation slots gone through, skipped ones included. `slots`
  // is the slot each session landed on, for where the latest cycle began.
  let step = 0;
  let previous: string | null = null;
  const slots: { slot: number; startedAt: string }[] = [];
  for (const s of counted) {
    const redo = s.routineId === previous;
    previous = s.routineId;
    for (let k = 0; k < n; k++) {
      if (rotation[(step + k) % n] === s.routineId) {
        if (redo && k > 0) break;
        slots.push({ slot: step + k, startedAt: s.startedAt });
        step += k + 1;
        break;
      }
    }
  }
  const passes = Math.floor(step / n);
  const nextIndex = step % n;
  const week = weeks !== null ? (passes % weeks) + 1 : passes + 1;
  const cycleDone = weeks !== null && passes > 0 && passes % weeks === 0;
  const cycleStartedAt = cycleDone && weeks !== null ? slots.find(x => x.slot >= weeks * n)?.startedAt ?? null : null;
  return { sessionsDone: counted.length, passes, nextIndex, nextRoutineId: rotation[nextIndex], week, weeks, cycleDone, cycleStartedAt };
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
 * A cycle just finished says so in place of the week, until a workout of the
 * next one is done.
 */
export function describeProgress(
  program: Pick<WorkoutProgram, 'scheme' | 'weeks'>,
  progress: ProgramProgress,
  routineName: (id: string) => string | null,
): string {
  const parts: string[] = [];
  parts.push(progress.cycleDone && progress.nextIndex === 0 && progress.weeks !== null
    ? `${progress.weeks}-week program done`
    : weekLabel(progress));
  if (program.scheme) parts.push(PROGRESSION_LABELS[program.scheme]);
  const next = progress.nextRoutineId ? routineName(progress.nextRoutineId) : null;
  parts.push(next ? `Next: ${next}` : 'No routines yet');
  return parts.join(' · ');
}
