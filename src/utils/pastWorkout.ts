// A workout logged after it happened, from the "Log a workout" sheet: what the
// person typed (text, one string per cell, the way workout mode types them) read
// into the `FinishedSessionInput` the store writes. The rules live here so the
// sheet only draws them: a set with nothing in it is dropped rather than logged
// as zeros, text that isn't a number is refused by name rather than dropped, and
// a workout can't end in the future or run longer than Health takes.
import type { ExerciseKind, WorkoutSet } from '../types';
import type { FinishedSessionInput } from '../store/useWorkoutStore';
import { parseSetCell } from './workoutCell';
import { setFieldsFor, supersetGroup, type SetField } from './workoutSession';
import type { WeightUnit } from './weightLog';

/** One set's cells as typed: "" or absent is blank. */
export type PastSetText = Partial<Record<SetField, string>>;

export interface PastExerciseDraft {
  exerciseId: string;
  kind: ExerciseKind;
  sets: PastSetText[];
  /** Exercises that are neighbours sharing a key are a superset (`supersetGroup`). */
  supersetKey?: string | null;
}

export const PAST_WORKOUT_DEFAULT_MINUTES = 45;
export const PAST_WORKOUT_MIN_MINUTES = 5;
/** Apple Health takes a workout up to a day long. */
export const PAST_WORKOUT_MAX_MINUTES = 24 * 60;

export type PastWorkoutProblem =
  | { problem: 'empty' }
  | { problem: 'future' }
  | { problem: 'invalid'; exerciseId: string; setNumber: number };

/** A new set under an exercise: the last one's values again, since a workout repeats them. */
export function nextSetText(sets: readonly PastSetText[]): PastSetText {
  const last = sets[sets.length - 1];
  return last ? { ...last } : {};
}

/** A key no exercise in the list uses yet. */
export function newSupersetKey(exercises: readonly PastExerciseDraft[]): string {
  const used = new Set(exercises.map(e => e.supersetKey));
  let n = 1;
  while (used.has(`ss${n}`)) n++;
  return `ss${n}`;
}

/** A key only one exercise carries is no superset: it is cleared. */
function settleSupersets(exercises: PastExerciseDraft[]): PastExerciseDraft[] {
  const count = new Map<string, number>();
  for (const e of exercises) if (e.supersetKey) count.set(e.supersetKey, (count.get(e.supersetKey) ?? 0) + 1);
  return exercises.map(e => (e.supersetKey && (count.get(e.supersetKey) ?? 0) < 2 ? { ...e, supersetKey: null } : e));
}

/** The exercises without one, and any partner it leaves alone no longer in a superset. */
export function withoutPastExercise(exercises: readonly PastExerciseDraft[], exerciseId: string): PastExerciseDraft[] {
  return settleSupersets(exercises.filter(e => e.exerciseId !== exerciseId));
}

/**
 * `partnerId` made a superset with `exerciseId`, as `joinedSuperset` does for a
 * live workout: the partner (and its own superset) moves to sit right below the
 * exercise's group and both groups take one key. Null when either is unknown or
 * they are already together.
 */
export function joinPastSuperset(
  exercises: readonly PastExerciseDraft[],
  exerciseId: string,
  partnerId: string,
): PastExerciseDraft[] | null {
  if (exerciseId === partnerId) return null;
  const mine = supersetGroup(exercises, exerciseId);
  const theirs = supersetGroup(exercises, partnerId);
  if (mine.length === 0 || theirs.length === 0) return null;
  if (theirs.some(e => e.exerciseId === exerciseId)) return null;
  const key = mine[0].supersetKey ?? newSupersetKey(exercises);
  const rest = exercises.filter(e => !theirs.includes(e));
  const at = rest.indexOf(mine[mine.length - 1]);
  const order = [...rest.slice(0, at + 1), ...theirs, ...rest.slice(at + 1)];
  return order.map(e => (mine.includes(e) || theirs.includes(e) ? { ...e, supersetKey: key } : e));
}

/**
 * `exerciseId` taken out of its superset. Out of the middle of a run the half
 * below takes a new key, and a partner left alone leaves too. Null when it isn't in one.
 */
export function leavePastSuperset(exercises: readonly PastExerciseDraft[], exerciseId: string): PastExerciseDraft[] | null {
  const target = exercises.find(e => e.exerciseId === exerciseId);
  if (!target?.supersetKey) return null;
  const group = supersetGroup(exercises, exerciseId);
  const at = group.findIndex(e => e.exerciseId === exerciseId);
  const below = at > 0 && at < group.length - 1 ? group.slice(at + 1) : [];
  const belowKey = `${target.supersetKey}:${exerciseId}`;
  return settleSupersets(exercises.map(e => {
    if (e.exerciseId === exerciseId) return { ...e, supersetKey: null };
    return below.includes(e) ? { ...e, supersetKey: belowKey } : e;
  }));
}

/**
 * The list with an exercise moved a place up or down, as `movedExerciseOrder`
 * does for a live workout: an exercise in a superset moves with its partners, as
 * one block past the neighbouring block, so a pair is never split. Null when it
 * can't move that way.
 */
export function movedPastExercise(
  exercises: readonly PastExerciseDraft[],
  exerciseId: string,
  direction: 'up' | 'down',
): PastExerciseDraft[] | null {
  const blocks: PastExerciseDraft[][] = [];
  for (const e of exercises) {
    if (blocks.some(b => b.includes(e))) continue;
    blocks.push(supersetGroup(exercises, e.exerciseId));
  }
  const at = blocks.findIndex(b => b.some(e => e.exerciseId === exerciseId));
  const to = direction === 'up' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= blocks.length) return null;
  [blocks[at], blocks[to]] = [blocks[to], blocks[at]];
  return blocks.flat();
}

/** Whether anything has been entered, for the discard guard. */
export function pastWorkoutTouched(title: string, exercises: readonly PastExerciseDraft[]): boolean {
  return title.trim() !== '' || exercises.length > 0;
}

export function buildPastWorkout(args: {
  title: string;
  start: Date;
  minutes: number;
  exercises: readonly PastExerciseDraft[];
  unit: WeightUnit;
  now: Date;
  healthWritePending?: boolean;
}): { input: FinishedSessionInput } | PastWorkoutProblem {
  const { title, start, minutes, exercises, unit, now } = args;
  const end = new Date(start.getTime() + minutes * 60_000);
  if (end.getTime() > now.getTime()) return { problem: 'future' };

  const sets: FinishedSessionInput['sets'] = [];
  for (const ex of exercises) {
    const fields = setFieldsFor(ex.kind);
    for (let index = 0; index < ex.sets.length; index++) {
      const values: Partial<WorkoutSet> = {};
      for (const field of fields) {
        const parsed = parseSetCell(field, ex.sets[index][field] ?? '', unit);
        if (parsed === undefined) return { problem: 'invalid', exerciseId: ex.exerciseId, setNumber: index + 1 };
        Object.assign(values, parsed);
      }
      // A set with nothing in it is a row nobody filled in, not a set of zeros.
      if (Object.values(values).every(v => v == null)) continue;
      sets.push({ exerciseId: ex.exerciseId, ...values, ...(ex.supersetKey ? { supersetKey: ex.supersetKey } : {}) });
    }
  }
  if (sets.length === 0) return { problem: 'empty' };

  // An exercise whose rows were all blank leaves its partner alone, and a
  // superset of one is no superset.
  const exercisesWithKey = new Map<string, Set<string>>();
  for (const st of sets) {
    if (st.supersetKey) exercisesWithKey.set(st.supersetKey, (exercisesWithKey.get(st.supersetKey) ?? new Set()).add(st.exerciseId));
  }
  for (const st of sets) {
    if (st.supersetKey && (exercisesWithKey.get(st.supersetKey)?.size ?? 0) < 2) delete st.supersetKey;
  }

  return {
    input: {
      title,
      startedAt: start.toISOString(),
      endedAt: end.toISOString(),
      healthWritePending: args.healthWritePending === true,
      sets,
    },
  };
}
