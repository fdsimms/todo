import type { ExerciseKind, ProgressionScheme, RoutineSetTarget, WorkoutRoutineItem } from '../types';
import { libraryExercise } from './exerciseLibrary';

/**
 * The built-in programs the Programs view offers to start from. Adding one
 * writes ordinary routines and a program the person owns and edits like any
 * other (`addLibraryProgram`); nothing here is referred to again afterwards.
 * See docs/arch/workouts.md, phase 4.
 *
 * **Generic names only.** These are the common shapes of a training week (a
 * three-times-a-week 5×5, a push/pull/legs split, an upper/lower split, a
 * percentage wave), named for what they are. No trademarked program names.
 *
 * Every exercise is a built-in (`lib:` ids), so a program added on a phone
 * with no custom exercises has nothing missing; `workoutProgramLibrary.test.ts`
 * holds that. Weight and reps exercises carry the program's scheme as their
 * progression, so each routine stands on its own if it leaves the program; a
 * bodyweight or timed exercise has no load to move and carries none.
 */

export interface LibraryProgramRoutine {
  name: string;
  items: WorkoutRoutineItem[];
}

export interface LibraryProgram {
  /** Stable, for tests and the picker's keys. */
  key: string;
  name: string;
  /** One line on what it is, for the picker. */
  summary: string;
  scheme: ProgressionScheme;
  /** A cycle's length in passes through the rotation, or null for open-ended. */
  weeks: number | null;
  routines: LibraryProgramRoutine[];
}

const working = (repsMin: number, repsMax: number = repsMin): RoutineSetTarget =>
  ({ kind: 'working', repsMin, repsMax });

interface ItemOptions {
  rest?: number;
  ramp?: boolean;
  /** No progression, for a movement with no load to add. */
  noProgression?: boolean;
}

function item(
  scheme: ProgressionScheme,
  exerciseId: string,
  targets: RoutineSetTarget[],
  options: ItemOptions = {},
): WorkoutRoutineItem {
  const kind = libraryExercise(exerciseId)?.kind ?? 'weight_reps';
  const loaded = kind === 'weight_reps' && !options.noProgression;
  return {
    exerciseId,
    supersetKey: null,
    restSeconds: options.rest ?? null,
    progression: loaded ? { scheme, incrementKg: null } : null,
    targets,
    ...(options.ramp ? { warmupRamp: true } : {}),
  };
}

const sets = (n: number, target: RoutineSetTarget): RoutineSetTarget[] =>
  Array.from({ length: n }, () => ({ ...target }));

/** Three working sets of a percentage wave's first week: 65, 75 and 85 percent, the last as many reps as there are in it. */
const wave = (): RoutineSetTarget[] => [
  { kind: 'working', repsMin: 5, repsMax: 5, pctOfTm: 65 },
  { kind: 'working', repsMin: 5, repsMax: 5, pctOfTm: 75 },
  { kind: 'amrap', repsMin: 5, repsMax: 5, pctOfTm: 85 },
];

function linear(): LibraryProgram {
  const s: ProgressionScheme = 'linear';
  return {
    key: 'five-by-five',
    name: '5×5 linear',
    summary: 'Three days a week, alternating two workouts. Squat every time, and add weight after each workout where every set gets 5.',
    scheme: s,
    weeks: null,
    routines: [
      { name: 'Workout A', items: [
        item(s, 'lib:back-squat', sets(5, working(5)), { rest: 180, ramp: true }),
        item(s, 'lib:barbell-bench-press', sets(5, working(5)), { rest: 180, ramp: true }),
        item(s, 'lib:barbell-row', sets(5, working(5)), { rest: 180, ramp: true }),
      ] },
      { name: 'Workout B', items: [
        item(s, 'lib:back-squat', sets(5, working(5)), { rest: 180, ramp: true }),
        item(s, 'lib:overhead-press', sets(5, working(5)), { rest: 180, ramp: true }),
        item(s, 'lib:deadlift', sets(1, working(5)), { rest: 180, ramp: true }),
      ] },
    ],
  };
}

function pushPullLegs(): LibraryProgram {
  const s: ProgressionScheme = 'double';
  return {
    key: 'push-pull-legs',
    name: 'Push / Pull / Legs',
    summary: 'Three workouts in turn: pressing, pulling, then legs. Add weight once every set reaches the top of its rep range.',
    scheme: s,
    weeks: null,
    routines: [
      { name: 'Push', items: [
        item(s, 'lib:barbell-bench-press', sets(3, working(6, 8)), { rest: 150, ramp: true }),
        item(s, 'lib:overhead-press', sets(3, working(8, 10)), { rest: 120 }),
        item(s, 'lib:incline-dumbbell-bench-press', sets(3, working(10, 12)), { rest: 90 }),
        item(s, 'lib:dumbbell-lateral-raise', sets(3, working(12, 15)), { rest: 60 }),
        item(s, 'lib:triceps-pushdown', sets(3, working(10, 12)), { rest: 60 }),
      ] },
      { name: 'Pull', items: [
        item(s, 'lib:barbell-row', sets(3, working(6, 8)), { rest: 150, ramp: true }),
        item(s, 'lib:lat-pulldown', sets(3, working(8, 10)), { rest: 90 }),
        item(s, 'lib:seated-cable-row', sets(3, working(10, 12)), { rest: 90 }),
        item(s, 'lib:face-pull', sets(3, working(12, 15)), { rest: 60 }),
        item(s, 'lib:dumbbell-curl', sets(3, working(10, 12)), { rest: 60 }),
      ] },
      { name: 'Legs', items: [
        item(s, 'lib:back-squat', sets(3, working(6, 8)), { rest: 180, ramp: true }),
        item(s, 'lib:romanian-deadlift', sets(3, working(8, 10)), { rest: 150 }),
        item(s, 'lib:leg-press', sets(3, working(10, 12)), { rest: 120 }),
        item(s, 'lib:lying-leg-curl', sets(3, working(10, 12)), { rest: 90 }),
        item(s, 'lib:standing-calf-raise', sets(3, working(12, 15)), { rest: 60 }),
      ] },
    ],
  };
}

function upperLower(): LibraryProgram {
  const s: ProgressionScheme = 'double';
  return {
    key: 'upper-lower',
    name: 'Upper / Lower',
    summary: 'Four workouts in turn, two for the upper body and two for the legs. Add weight once every set reaches the top of its rep range.',
    scheme: s,
    weeks: null,
    routines: [
      { name: 'Upper A', items: [
        item(s, 'lib:barbell-bench-press', sets(3, working(6, 8)), { rest: 150, ramp: true }),
        item(s, 'lib:barbell-row', sets(3, working(6, 8)), { rest: 120 }),
        item(s, 'lib:dumbbell-lateral-raise', sets(2, working(12, 15)), { rest: 60 }),
        item(s, 'lib:triceps-pushdown', sets(2, working(10, 12)), { rest: 60 }),
      ] },
      { name: 'Lower A', items: [
        item(s, 'lib:back-squat', sets(3, working(5, 6)), { rest: 180, ramp: true }),
        item(s, 'lib:romanian-deadlift', sets(2, working(8, 10)), { rest: 150 }),
        item(s, 'lib:plank', [{ kind: 'working', repsMin: null, repsMax: null, durationSeconds: 60 }], { rest: 60 }),
      ] },
      { name: 'Upper B', items: [
        item(s, 'lib:overhead-press', sets(3, working(6, 8)), { rest: 150, ramp: true }),
        item(s, 'lib:pull-up', sets(3, working(6, 10)), { rest: 120 }),
        item(s, 'lib:incline-dumbbell-bench-press', sets(3, working(8, 10)), { rest: 90 }),
        item(s, 'lib:dumbbell-curl', sets(2, working(10, 12)), { rest: 60 }),
      ] },
      { name: 'Lower B', items: [
        item(s, 'lib:deadlift', sets(3, working(4, 6)), { rest: 180, ramp: true }),
        item(s, 'lib:bulgarian-split-squat', sets(3, working(8, 10)), { rest: 90 }),
        item(s, 'lib:lying-leg-curl', sets(3, working(10, 12)), { rest: 90 }),
        item(s, 'lib:standing-calf-raise', sets(3, working(12, 15)), { rest: 60 }),
      ] },
    ],
  };
}

function percentageWave(): LibraryProgram {
  const s: ProgressionScheme = 'percent';
  const accessory = (id: string, n: number, lo: number, hi: number, rest = 90) =>
    item('double', id, sets(n, working(lo, hi)), { rest });
  return {
    key: 'percentage-wave',
    name: '4-week percentage wave',
    summary: 'One main lift a day, four days, at percentages of a training max that climb for three weeks and ease off in the fourth. Set the training maxes in the program first.',
    scheme: s,
    weeks: 4,
    routines: [
      { name: 'Press day', items: [
        item(s, 'lib:overhead-press', wave(), { rest: 180, ramp: true }),
        accessory('lib:chin-up', 3, 6, 10, 120),
        accessory('lib:dumbbell-lateral-raise', 3, 12, 15, 60),
      ] },
      { name: 'Deadlift day', items: [
        item(s, 'lib:deadlift', wave(), { rest: 180, ramp: true }),
        accessory('lib:bulgarian-split-squat', 3, 8, 10),
        accessory('lib:hanging-leg-raise', 3, 10, 15, 60),
      ] },
      { name: 'Bench day', items: [
        item(s, 'lib:barbell-bench-press', wave(), { rest: 180, ramp: true }),
        accessory('lib:dumbbell-row', 3, 8, 12),
        accessory('lib:triceps-pushdown', 3, 10, 12, 60),
      ] },
      { name: 'Squat day', items: [
        item(s, 'lib:back-squat', wave(), { rest: 180, ramp: true }),
        accessory('lib:romanian-deadlift', 3, 8, 10, 120),
        accessory('lib:standing-calf-raise', 3, 12, 15, 60),
      ] },
    ],
  };
}

/** Every built-in program, in the order the picker lists them. */
export const PROGRAM_LIBRARY: readonly LibraryProgram[] = [linear(), pushPullLegs(), upperLower(), percentageWave()];

export function libraryProgram(key: string): LibraryProgram | null {
  return PROGRAM_LIBRARY.find(p => p.key === key) ?? null;
}

/**
 * The exercises in a program's routines that are moved by percentages, and so
 * want a training max: an item choosing `percent` itself, or choosing nothing
 * in a program whose scheme is `percent`, or naming a percentage on a set.
 * Only weight and reps exercises (`kindOf`): a pull-up has no load to take a
 * percentage of.
 */
export function percentExercises(
  routines: readonly { items: readonly Pick<WorkoutRoutineItem, 'exerciseId' | 'targets' | 'progression'>[] }[],
  programScheme: ProgressionScheme | null,
  kindOf: (exerciseId: string) => ExerciseKind | null,
): string[] {
  const out: string[] = [];
  for (const r of routines) {
    for (const i of r.items) {
      if (kindOf(i.exerciseId) !== 'weight_reps') continue;
      const scheme = i.progression?.scheme ?? programScheme;
      const usesPct = scheme === 'percent' || i.targets.some(t => typeof t.pctOfTm === 'number');
      if (usesPct && !out.includes(i.exerciseId)) out.push(i.exerciseId);
    }
  }
  return out;
}
