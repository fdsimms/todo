import type { Exercise, WorkoutSet } from '../types/workouts';
import { catalogExercise } from './exerciseCatalog';
import { bodyweightVolumeKg } from './workoutRecords';

/**
 * How much of a person's body weight a bodyweight movement moves, for the
 * bodyweight volume (`bodyweightVolumeKg` in `workoutRecords.ts`).
 *
 * **These are estimates, and the screen that shows the total says so.** A
 * push-up does not lift the whole body, only the share that rests on the hands
 * (about 64% in the studies that measured it with force plates); a pull-up lifts
 * all of it; a squat leaves the legs themselves out. The figures below follow
 * those studies where there are any and the usual segment-mass split of the body
 * where there aren't, rounded to the nearest 0.05. They only ever scale a volume
 * that is kept apart from the lifted one: no record, rank or progression reads
 * them.
 *
 * **Every built-in bodyweight or assisted exercise is listed on purpose**
 * (`bodyweightLoad.test.ts` fails on one that isn't), so adding one to the
 * library forces a decision. 0 means the body is not the load (a band drill, a
 * stability movement), and it counts nothing.
 */
export const LIBRARY_BODYWEIGHT_FRACTIONS: Readonly<Record<string, number>> = {
  // Pushing
  'lib:push-up': 0.64,
  'lib:incline-push-up': 0.5,
  'lib:decline-push-up': 0.75,
  'lib:diamond-push-up': 0.64,
  'lib:pike-push-up': 0.7,
  'lib:handstand-push-up': 0.9,
  'lib:chest-dip': 1,
  'lib:ring-dip': 1,
  'lib:triceps-dip': 1,
  'lib:assisted-dip': 1,
  'lib:bench-dip': 0.5,
  // Pulling
  'lib:pull-up': 1,
  'lib:chin-up': 1,
  'lib:neutral-grip-pull-up': 1,
  'lib:muscle-up': 1,
  'lib:assisted-pull-up': 1,
  'lib:band-assisted-pull-up': 1,
  'lib:inverted-row': 0.6,
  'lib:back-extension': 0.4,
  'lib:band-pull-apart': 0,
  // Legs
  'lib:bodyweight-squat': 0.65,
  'lib:sissy-squat': 0.65,
  'lib:pistol-squat': 0.85,
  'lib:jump-squat': 1,
  'lib:box-jump': 1,
  'lib:nordic-curl': 0.6,
  'lib:glute-ham-raise': 0.5,
  'lib:bodyweight-glute-bridge': 0.4,
  'lib:single-leg-glute-bridge': 0.4,
  'lib:single-leg-standing-calf-raise': 1,
  'lib:banded-lateral-walk': 0,
  'lib:clamshell': 0,
  // Core
  'lib:crunch': 0.3,
  'lib:bicycle-crunch': 0.3,
  'lib:sit-up': 0.5,
  'lib:decline-sit-up': 0.5,
  'lib:v-up': 0.6,
  'lib:hanging-leg-raise': 0.35,
  'lib:hanging-knee-raise': 0.3,
  'lib:captains-chair-knee-raise': 0.3,
  'lib:toes-to-bar': 0.4,
  'lib:lying-leg-raise': 0.35,
  'lib:ab-wheel-rollout': 0.6,
  'lib:dead-bug': 0,
  'lib:bird-dog': 0,
  'lib:russian-twist': 0,
  'lib:chin-tuck': 0,
  // Whole body
  'lib:burpee': 1,
};

/** What a custom exercise counts at until the person sets its own: the whole body. */
export const DEFAULT_BODYWEIGHT_FRACTION = 1;

/** A stored or typed fraction as a number from 0 to 1, or null when it isn't one. */
export function readBodyweightFraction(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return Math.round(n * 100) / 100;
}

/**
 * The share of body weight one exercise moves: the person's own figure when
 * they set one, else the library's for a built-in, else the whole body.
 */
export function bodyweightFractionOf(exerciseId: string, override?: number | null): number {
  const own = readBodyweightFraction(override);
  if (own !== null) return own;
  return LIBRARY_BODYWEIGHT_FRACTIONS[exerciseId] ?? DEFAULT_BODYWEIGHT_FRACTION;
}

/** `bodyweightFractionOf` for an exercise row that may not exist (a deleted exercise reads as the default). */
export function bodyweightFractionFor(exercise: Pick<Exercise, 'bodyweightFraction'> | null | undefined, exerciseId: string): number {
  return bodyweightFractionOf(exerciseId, exercise?.bodyweightFraction);
}

/**
 * A session's bodyweight volume in kilograms from its sets, reading each
 * exercise's kind and share from the catalog (`exerciseRows` are the person's
 * own rows, as the store holds them). The one call every screen that shows the
 * figure makes, so the page, the live pill and the history row agree. Null when
 * the workout has no body weight stamped or no bodyweight set was done.
 */
export function sessionBodyweightVolumeKg(
  sets: Pick<WorkoutSet, 'exerciseId' | 'weightKg' | 'reps' | 'completedAt' | 'kind'>[],
  exerciseRows: readonly Exercise[],
  bodyweightKg: number | null | undefined,
): number | null {
  return bodyweightVolumeKg(
    sets,
    id => catalogExercise(exerciseRows, id)?.kind ?? 'weight_reps',
    id => bodyweightFractionFor(catalogExercise(exerciseRows, id), id),
    bodyweightKg,
  );
}
