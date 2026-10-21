import type {
  Exercise,
  ExerciseKind,
  PlateInventory,
  WorkoutProgram,
  WorkoutRoutine,
  WorkoutRoutineItem,
  WorkoutSession,
  WorkoutSet,
} from '../types';
import type { WeightUnit } from './weightLog';
import { catalogExercise } from './exerciseCatalog';
import { programProgress } from './workoutProgram';
import { withGymBar } from './gyms';
import { weightScale, type DumbbellEntry } from './dumbbellLoad';
import {
  loadContextFor,
  proposalEdits,
  proposeNext,
  rampSteps,
  rampWarmupsToAdd,
  schemeFor,
  type LoadContext,
  type Proposal,
  type RampStep,
  type SetEdit,
} from './workoutProgression';

/**
 * The next load for one exercise of a workout, and what "Use" writes: the
 * suggestion card's whole job, lifted out of workout mode so the Apple
 * Watch's suggestion (its snapshot, and its `useSuggestion` tap) is the same
 * proposal applied by the same function, never a copy of either.
 *
 * Pure, and reaching no store, so the MCP server's `next_workout` reads
 * the same proposal (`workoutProposalApply.ts` is the half that reads and
 * writes the stores). The rules themselves are
 * `workoutProgression.ts`'s (docs/arch/workouts.md, "Phase 4, as built"):
 * a proposal is never applied unasked, and "Use" is a person's tap.
 */

export interface ExerciseProposalInput {
  exerciseId: string;
  /** The custom exercise rows, for the catalog. */
  exercises: readonly Exercise[];
  /** The routine the workout follows, for the item the exercise was laid out from. */
  routine: Pick<WorkoutRoutine, 'items'> | null;
  /** The program the workout counts toward, for its scheme, training maxes and week. */
  program: WorkoutProgram | null;
  sessions: readonly WorkoutSession[];
  routines: readonly WorkoutRoutine[];
  /** The exercise's sets from any session (`exerciseHistory`). */
  history: readonly WorkoutSet[];
  /** The workout the proposal is for, whose own sets aren't history yet. */
  exceptSessionId: string | null;
  plateInventory: PlateInventory;
  unit: WeightUnit;
  /** The bar this exercise has at the workout's gym, where it differs (`GymExerciseSetting.barKg`). */
  gymBarKg?: number | null;
  /** The load step this exercise has at that gym, which outranks the routine's own. */
  gymIncrementKg?: number | null;
  /** The Settings choice for two-dumbbell exercises, which scales the proposal's words only. */
  dumbbellEntry?: DumbbellEntry;
}

/** A proposal with what it was worked out against, which "Use" needs again. */
export interface ExerciseProposal {
  proposal: Proposal;
  load: LoadContext;
  item: WorkoutRoutineItem | null;
  kind: ExerciseKind;
}

/**
 * Pure. What workout mode's card proposes for the exercise, or null when
 * nothing does: no scheme, an exercise that isn't weight and reps, or no
 * history to move on from (`proposeNext`).
 */
export function exerciseProposal(input: ExerciseProposalInput): ExerciseProposal | null {
  const base = catalogExercise(input.exercises, input.exerciseId);
  if (!base) return null;
  const info = withGymBar(base, { barKg: input.gymBarKg ?? null });
  const item = input.routine?.items.find(i => i.exerciseId === input.exerciseId) ?? null;
  const scheme = schemeFor(item, input.program);
  if (!scheme) return null;
  const baseLoad = loadContextFor(info, input.plateInventory, input.unit, item, weightScale(base, input.dumbbellEntry ?? 'each'));
  const load = input.gymIncrementKg ? { ...baseLoad, incrementKg: input.gymIncrementKg } : baseLoad;
  // The week the program is in: the workout the proposal is for isn't
  // finished, so it isn't counted, and the finished ones say where it stands.
  const progress = input.program ? programProgress(input.program, input.sessions, input.routines) : null;
  const proposal = proposeNext({
    exerciseId: input.exerciseId,
    kind: info.kind,
    item,
    scheme,
    history: input.history,
    sessions: input.sessions,
    exceptSessionId: input.exceptSessionId,
    load,
    trainingMaxKg: input.program?.trainingMaxes.find(t => t.exerciseId === input.exerciseId)?.kg ?? null,
    week: progress ? { week: progress.week, weeks: progress.weeks } : null,
  });
  return proposal ? { proposal, load, item, kind: info.kind } : null;
}

/** The warm-up ramp "Use" lays out, from the proposal's first working weight, or null when the item has none. */
export function proposalRamp(p: ExerciseProposal): RampStep[] | null {
  const top = p.proposal.sets[0]?.weightKg ?? null;
  return p.item?.warmupRamp && p.kind === 'weight_reps' && top !== null ? rampSteps(top, p.load) : null;
}

/**
 * Pure. What "Use" writes to an exercise's sets: the proposal onto the
 * planned working sets, a ramp's planned warm-ups worked out again from the
 * new weight (`proposalEdits`), and, when the exercise laid out no warm-ups
 * because there was no weight to ramp to (a percentage program's first
 * workout), the ramp's warm-ups to add ahead of it (`rampWarmupsToAdd`).
 */
export function proposalWrites(exerciseSets: readonly WorkoutSet[], p: ExerciseProposal): { edits: SetEdit[]; warmupsToAdd: RampStep[] } {
  const ramp = proposalRamp(p);
  return { edits: proposalEdits(exerciseSets, p.proposal, ramp), warmupsToAdd: rampWarmupsToAdd(exerciseSets, ramp) };
}
