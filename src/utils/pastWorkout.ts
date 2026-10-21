// A workout logged after it happened, from the "Log a workout" sheet: what the
// person typed (text, one string per cell, the way workout mode types them) read
// into the `FinishedSessionInput` the store writes. The rules live here so the
// sheet only draws them: a set with nothing in it is dropped rather than logged
// as zeros, text that isn't a number is refused by name rather than dropped, and
// a workout can't end in the future or run longer than Health takes.
import type { ExerciseKind, WorkoutSet } from '../types';
import type { FinishedSessionInput } from '../store/useWorkoutStore';
import { parseSetCell } from './workoutCell';
import { setFieldsFor, type SetField } from './workoutSession';
import type { WeightUnit } from './weightLog';

/** One set's cells as typed: "" or absent is blank. */
export type PastSetText = Partial<Record<SetField, string>>;

export interface PastExerciseDraft {
  exerciseId: string;
  kind: ExerciseKind;
  sets: PastSetText[];
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
      sets.push({ exerciseId: ex.exerciseId, ...values });
    }
  }
  if (sets.length === 0) return { problem: 'empty' };

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
