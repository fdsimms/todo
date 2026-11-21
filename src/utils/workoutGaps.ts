import type { Exercise, Gym, MuscleGroup, WorkoutSession, WorkoutSet } from '../types';
import { buildCatalog } from './exerciseCatalog';
import { equipmentAvailable } from './gyms';
import { MUSCLE_LABELS } from './workoutData';
import {
  SECONDARY_MUSCLE_WEIGHT, countsForRecords, type MuscleInfo, type MuscleWeek,
} from './workoutRecords';

/**
 * Muscles a workout isn't hitting, and the exercises that would, for the
 * picker's "Fills a gap" section. A proposal only: nothing here is stored, and
 * nothing is added until the person taps a row (`docs/arch/workouts.md`, "Gap
 * suggestions").
 *
 * "Not hit" is measured against what the person usually does:
 *
 * - **The routine's own history** when the workout started from a routine that
 *   has finished sessions: the muscles its last few sessions trained and this
 *   one doesn't, which is what a swap or a skipped exercise leaves behind.
 * - **This week's volume** otherwise: the muscles that went at least a few sets
 *   a week over the previous weeks and are well behind this week.
 *
 * Both are "usual sets" against "sets so far", credited the way Stats credits a
 * week (a primary muscle 1 set, a helping one `SECONDARY_MUSCLE_WEIGHT`).
 */

/** Past sessions of a routine that set what is usual for it. */
export const GAP_ROUTINE_SESSIONS = 3;
/** Previous weeks that set what is usual for a week. */
export const GAP_WEEKS = 4;
/** A muscle needs at least this many usual sets before missing it counts: a stray helping set is not a habit. */
export const GAP_MIN_USUAL = 2;
/** A muscle is a gap when it has less than this share of its usual sets. */
export const GAP_SHARE = 0.5;
/** Muscles offered at once, biggest shortfall first. */
export const GAP_MAX_MUSCLES = 3;

/** What a muscle read needs from a set: the working sets of a workout, planned or done. */
type SetLike = Pick<WorkoutSet, 'exerciseId' | 'kind' | 'completedAt'>;

export type GapSource = 'routine' | 'week';

export interface MuscleGap {
  muscle: MuscleGroup;
  /** Sets the person usually does for it, from the routine's last sessions or the previous weeks. */
  usual: number;
  /** Sets credited so far: this workout's, plus the week's earlier ones for a weekly gap. */
  have: number;
}

export interface GapContext {
  /** The routine's name, for the reason line; null for a workout with none. */
  routineName: string | null;
  /** Sets of the routine's earlier finished sessions, one array per session, newest first. */
  routineSessions: readonly (readonly SetLike[])[];
  /** The previous weeks' muscle totals, newest first (`priorWeeks`). */
  weeks: readonly ReadonlyMap<MuscleGroup, MuscleWeek>[];
  /** The running week's totals from finished workouts, not counting this one. */
  thisWeek: ReadonlyMap<MuscleGroup, MuscleWeek> | undefined;
}

/** Sets credited to each muscle by `sets` (primary 1, helping `SECONDARY_MUSCLE_WEIGHT`). Warm-ups never count. */
export function muscleCredit(
  sets: readonly Pick<WorkoutSet, 'exerciseId' | 'kind'>[],
  infoOf: (exerciseId: string) => MuscleInfo | null,
): Map<MuscleGroup, number> {
  const out = new Map<MuscleGroup, number>();
  const add = (m: MuscleGroup, n: number) => out.set(m, (out.get(m) ?? 0) + n);
  for (const s of sets) {
    if (s.kind === 'warmup') continue;
    const info = infoOf(s.exerciseId);
    if (!info) continue;
    for (const m of info.primaryMuscles) add(m, 1);
    for (const m of info.secondaryMuscles) if (!info.primaryMuscles.includes(m)) add(m, SECONDARY_MUSCLE_WEIGHT);
  }
  return out;
}

/** The mean of each muscle's credit over `credits`, a muscle missing from one counting as 0 there. */
function meanCredit(credits: readonly ReadonlyMap<MuscleGroup, number>[]): Map<MuscleGroup, number> {
  const total = new Map<MuscleGroup, number>();
  for (const c of credits) for (const [m, n] of c) total.set(m, (total.get(m) ?? 0) + n);
  return new Map([...total].map(([m, n]) => [m, n / credits.length]));
}

/** The muscles whose `have` is under `GAP_SHARE` of a usual of at least `GAP_MIN_USUAL`, biggest shortfall first. */
function gapsOf(usual: ReadonlyMap<MuscleGroup, number>, have: ReadonlyMap<MuscleGroup, number>): MuscleGap[] {
  const out: MuscleGap[] = [];
  for (const [muscle, u] of usual) {
    const h = have.get(muscle) ?? 0;
    if (u >= GAP_MIN_USUAL && h < u * GAP_SHARE) out.push({ muscle, usual: u, have: h });
  }
  return out
    .sort((a, b) => (b.usual - b.have) - (a.usual - a.have) || a.muscle.localeCompare(b.muscle))
    .slice(0, GAP_MAX_MUSCLES);
}

/**
 * The muscles `current` (the workout's working sets, planned or done) isn't
 * hitting, from the routine's history when it has any and this week's volume
 * when it doesn't. Empty when neither has enough history to say what is usual.
 */
export function findGaps(
  current: readonly Pick<WorkoutSet, 'exerciseId' | 'kind'>[],
  ctx: GapContext,
  infoOf: (exerciseId: string) => MuscleInfo | null,
): { source: GapSource; gaps: MuscleGap[] } {
  const have = muscleCredit(current, infoOf);
  if (ctx.routineName !== null && ctx.routineSessions.length > 0) {
    const past = ctx.routineSessions.slice(0, GAP_ROUTINE_SESSIONS).map(sets => muscleCredit(sets.filter(countsForRecords), infoOf));
    return { source: 'routine', gaps: gapsOf(meanCredit(past), have) };
  }
  // Only weeks that had any training say what a week usually holds: a holiday week is not a habit of zero.
  const trained = ctx.weeks.slice(0, GAP_WEEKS).filter(w => w.size > 0);
  if (trained.length < 2) return { source: 'week', gaps: [] };
  const usual = meanCredit(trained.map(w => new Map([...w].map(([m, v]) => [m, v.sets]))));
  const weekHave = new Map(have);
  for (const [m, v] of ctx.thisWeek ?? []) weekHave.set(m, (weekHave.get(m) ?? 0) + v.sets);
  return { source: 'week', gaps: gapsOf(usual, weekHave) };
}

/** The weeks before `thisWeekKey`, newest first, at most `GAP_WEEKS` of them. */
export function priorWeeks(
  weeks: ReadonlyMap<string, ReadonlyMap<MuscleGroup, MuscleWeek>>,
  thisWeekKey: string,
): ReadonlyMap<MuscleGroup, MuscleWeek>[] {
  return [...weeks.keys()]
    .filter(k => k < thisWeekKey)
    .sort((a, b) => (a < b ? 1 : -1))
    .slice(0, GAP_WEEKS)
    .map(k => weeks.get(k)!);
}

/** The ids of the routine's most recent finished sessions before `exceptId`, newest first. */
export function routineSessionIds(
  sessions: readonly Pick<WorkoutSession, 'id' | 'routineId' | 'startedAt' | 'endedAt'>[],
  routineId: string,
  exceptId: string,
): string[] {
  return sessions
    .filter(s => s.routineId === routineId && s.id !== exceptId && s.endedAt !== null)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
    .slice(0, GAP_ROUTINE_SESSIONS)
    .map(s => s.id);
}

/** A set count in a sentence: whole when it is, one decimal otherwise ("2.5"). */
function fmtSets(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/** The line under a suggested exercise: which muscle it covers and how far behind that muscle is. */
export function gapReason(gap: MuscleGap, source: GapSource, routineName: string | null): string {
  const label = MUSCLE_LABELS[gap.muscle];
  const usual = Math.round(gap.usual);
  if (source === 'routine') return `${label}: usually ${usual} ${usual === 1 ? 'set' : 'sets'} in ${routineName ?? 'this routine'}`;
  return gap.have === 0
    ? `${label}: none yet this week`
    : `${label}: ${fmtSets(gap.have)} of your usual ${usual} sets this week`;
}

export interface GapSuggestion {
  exerciseId: string;
  muscle: MuscleGroup;
  /** The row's second line, with a swap's cost appended when there is one. */
  reason: string;
}

export interface GapSuggestionOptions {
  /** Exercises the workout already has, never offered twice. */
  exceptIds: readonly string[];
  /** The gym the workout is at; an exercise it can't do isn't offered. */
  gym?: Pick<Gym, 'equipment'> | null;
  /** Exercises the person has logged before: an exercise they know leads one they don't. */
  knownIds?: ReadonlySet<string>;
  /**
   * For a swap, the exercise being swapped out and the credit the workout keeps
   * without its unticked sets. A suggestion that leaves one of its main muscles
   * at nothing says so.
   */
  leaving?: { info: MuscleInfo; haveAfter: ReadonlyMap<MuscleGroup, number> };
}

/** Weighted and bodyweight-rep lifts only: a run or a plank doesn't fill a muscle's sets the way these do. */
const FILLS_SETS: ReadonlySet<Exercise['kind']> = new Set(['weight_reps', 'bodyweight_reps']);

/**
 * One exercise per gap muscle: the person's own before the library's, then the
 * one that also covers another gap, then the name. An exercise is offered for
 * one muscle only, so two gaps never list the same row twice.
 */
export function gapSuggestions(
  rows: readonly Exercise[],
  gaps: readonly MuscleGap[],
  source: GapSource,
  routineName: string | null,
  opts: GapSuggestionOptions,
): GapSuggestion[] {
  const catalog = buildCatalog(rows).filter(
    e => !e.archived && FILLS_SETS.has(e.kind) && !opts.exceptIds.includes(e.id) && equipmentAvailable(opts.gym, e.equipment),
  );
  const gapMuscles = new Set(gaps.map(g => g.muscle));
  const taken = new Set<string>();
  const out: GapSuggestion[] = [];
  for (const gap of gaps) {
    const best = catalog
      .filter(e => !taken.has(e.id) && e.primaryMuscles.includes(gap.muscle))
      .map(e => ({ e, also: e.primaryMuscles.filter(m => m !== gap.muscle && gapMuscles.has(m)).length }))
      .sort((a, b) =>
        Number(opts.knownIds?.has(b.e.id) ?? false) - Number(opts.knownIds?.has(a.e.id) ?? false)
        || b.also - a.also
        || a.e.name.localeCompare(b.e.name))[0]?.e;
    if (!best) continue;
    taken.add(best.id);
    let reason = gapReason(gap, source, routineName);
    if (opts.leaving) {
      const covers = new Set([...best.primaryMuscles, ...best.secondaryMuscles]);
      const dropped = opts.leaving.info.primaryMuscles.filter(m => (opts.leaving!.haveAfter.get(m) ?? 0) === 0 && !covers.has(m));
      if (dropped.length > 0) {
        const names = dropped.map((m, i) => (i === 0 ? MUSCLE_LABELS[m] : MUSCLE_LABELS[m].toLowerCase()));
        reason += `. ${names.join(' and ')} would drop to 0`;
      }
    }
    out.push({ exerciseId: best.id, muscle: gap.muscle, reason });
  }
  return out;
}
