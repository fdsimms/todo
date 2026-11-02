// ─── Workouts ────────────────────────────────────────────────────────────────
// See docs/arch/workouts.md. The library of built-in exercises is code
// (src/utils/exerciseLibrary.ts); these are the rows the person writes. Every
// weight is in kilograms, whatever `workoutUnit` displays.

/**
 * What a set of an exercise records, which decides the fields a set row uses:
 * weight and reps, reps alone (a pull-up), reps with assistance taken off
 * (`weightKg` is the assistance), a hold or a run measured in time, a distance,
 * or a load carried over a distance (a farmer's carry).
 */
export type ExerciseKind =
  'weight_reps' | 'bodyweight_reps' | 'assisted_reps' | 'duration' | 'distance' | 'weight_distance';

/**
 * What an exercise is done with. A closed set so a filter can offer every value.
 * `machine` and `cardio_machine` are the catch-alls: an exercise on a machine
 * with no value of its own is filed under one, and a gym that ticked one before
 * the specific machines existed is read as having all of them
 * (`equipmentAvailable`, src/utils/gyms.ts).
 */
export type ExerciseEquipment =
  | 'barbell' | 'dumbbell' | 'kettlebell' | 'cable' | 'smith_machine'
  | 'ez_bar' | 'trap_bar' | 'band' | 'bodyweight' | 'other'
  | 'pull_up_bar' | 'dip_bars' | 'medicine_ball' | 'sled' | 'battle_ropes' | 'jump_rope' | 'ab_wheel' | 'heavy_bag' | 'neck_harness'
  | 'flat_bench' | 'incline_bench' | 'decline_bench' | 'adjustable_bench' | 'preacher_bench' | 'back_extension_bench'
  | 'machine'
  | 'leg_press' | 'hack_squat' | 'leg_extension' | 'leg_curl' | 'calf_raise_machine'
  | 'hip_abduction_machine' | 'hip_adduction_machine'
  | 'chest_press_machine' | 'pec_deck' | 'shoulder_press_machine' | 'row_machine' | 'assisted_machine'
  | 'cardio_machine'
  | 'treadmill' | 'stationary_bike' | 'air_bike' | 'rowing_machine' | 'elliptical' | 'stair_climber' | 'ski_erg';

/** The muscles an exercise is filed under. A closed set, for the same reason. */
export type MuscleGroup =
  | 'chest' | 'lats' | 'upper_back' | 'lower_back' | 'traps'
  | 'front_delts' | 'side_delts' | 'rear_delts'
  | 'biceps' | 'triceps' | 'forearms'
  | 'abs' | 'obliques'
  | 'quads' | 'hamstrings' | 'glutes' | 'adductors' | 'abductors' | 'calves'
  | 'neck';

/**
 * A custom exercise, or the person's changes to a built-in one.
 *
 * A custom row has a fresh `generateId()` id and `isCustom: true`. An override
 * row reuses the built-in's id (`lib:barbell-bench-press`) with `isCustom:
 * false`, so renaming "Barbell bench press" to "Flat bench" is one row and
 * every set already logged against the id keeps pointing at it. From an
 * override, the catalog takes only `name`, `notes`, `barKg` and `archived`
 * (`src/utils/exerciseCatalog.ts`): what the movement is stays the library's,
 * so a corrected muscle list in a later build still reaches it. `otherNames`
 * is the fifth thing an override may carry, since it is the person's own words.
 */
export interface Exercise {
  id: string;
  name: string;
  /**
   * Other names the person knows it by ("Two arm dumbbell row" for the library's
   * "Bent over row"). Search and the CSV import's name match read them; nothing
   * else does. Unset on a row from before the column existed, which reads as none.
   */
  otherNames?: string[];
  kind: ExerciseKind;
  primaryMuscles: MuscleGroup[];
  secondaryMuscles: MuscleGroup[];
  equipment: ExerciseEquipment;
  /** The bar's own weight where it isn't the default for the equipment. Null for the default. */
  barKg: number | null;
  /**
   * How many dumbbells a dumbbell exercise is held in, where the library's
   * answer (two, except for a closed list of one-dumbbell movements) is wrong
   * for the person. Null for the default, and for any other equipment.
   */
  dumbbells: 1 | 2 | null;
  /**
   * Whether this two-dumbbell exercise takes each dumbbell's weight or the
   * pair's total, overriding Settings. Null follows the setting. A set stores
   * one dumbbell either way (`src/utils/dumbbellLoad.ts`).
   */
  loadEntry: 'each' | 'pair' | null;
  notes: string;
  /** Hidden from the library and pickers; its history stays. */
  archived: boolean;
  isCustom: boolean;
  createdAt: string;
}

/** What a set is for. A warm-up and a drop set don't count toward a working target. */
export type WorkoutSetKind = 'warmup' | 'working' | 'drop' | 'amrap';

/** How a routine item's next targets are proposed (phase 4 of docs/arch/workouts.md). */
export type ProgressionScheme = 'double' | 'linear' | 'percent' | 'rpe';

/** One planned set of a routine item. Every field is a target, never a record. */
export interface RoutineSetTarget {
  kind: WorkoutSetKind;
  repsMin: number | null;
  repsMax: number | null;
  weightKg?: number | null;
  /** Percent of the program's training max for this exercise, for a `percent` scheme. */
  pctOfTm?: number | null;
  rpe?: number | null;
  durationSeconds?: number | null;
  distanceM?: number | null;
}

/** How one item moves on from session to session. A proposal only: nothing applies it unasked. */
export interface RoutineProgression {
  scheme: ProgressionScheme;
  /** The step a success adds. Null for the scheme's default. */
  incrementKg: number | null;
}

/** One exercise in a routine, with its planned sets. Rides inside `WorkoutRoutine.items`. */
export interface WorkoutRoutineItem {
  exerciseId: string;
  /** Items sharing a key are done as a superset, alternating set by set. */
  supersetKey?: string | null;
  /** Rest after each set. Null for the `defaultRestSeconds` setting. */
  restSeconds: number | null;
  progression: RoutineProgression | null;
  targets: RoutineSetTarget[];
  /**
   * Warm up with a ramp worked out from the working weight (about 40, 60 and
   * 80 percent, rounded to loads the plates make) rather than warm-up targets
   * of its own. The ramp is laid out when a workout starts, as planned sets
   * the person can change; the item then holds no `warmup` targets. Absent
   * (or false) for none, or for the warm-ups its targets list.
   */
  warmupRamp?: boolean;
}

/**
 * A named list of exercises with planned sets ("Push A"). Edited as a unit, so
 * `items` is one JSON column (the `saved_meals.items` call), not a child table.
 */
export interface WorkoutRoutine {
  id: string;
  name: string;
  notes: string;
  /** The program it belongs to, or null for a routine on its own. */
  programId: string | null;
  sortOrder: number;
  items: WorkoutRoutineItem[];
  createdAt: string;
  /**
   * The heading it is listed under on the Routines tab, typed by the person.
   * There is no group row: a heading is drawn while this name is held by a
   * routine or is in the `workoutRoutineGroups` setting (which is what lets a
   * group be empty). A routine is in one group at most. Null for none.
   */
  groupName: string | null;
  /** Out of the way, not deleted: listed under Archived and still startable after a restore. */
  archived: boolean;
  /**
   * The version (`WorkoutRoutineVersion.id`) this routine's content is, which
   * a workout started from it records. Null or absent on a routine saved
   * before versions were kept, which reads as one implicit first version.
   */
  currentVersionId?: string | null;
}

/** What wrote a routine version. Shown in History; changes nothing about how it behaves. */
export type RoutineVersionSource = 'created' | 'initial' | 'edit' | 'workout' | 'restore' | 'copy' | 'agent';

/**
 * One version of a routine: the plan as it stood, kept so it can be compared
 * and restored (docs/arch/workouts.md, "Routine and program history"). A
 * version is what was trained on, so a save made after a workout on the
 * current one is a new row, and one made before any workout amends it.
 * Versions are numbered by `createdAt`, never by a stored number, so two
 * devices each adding one end up with both rather than two "version 5"s.
 */
export interface WorkoutRoutineVersion {
  id: string;
  routineId: string;
  createdAt: string;
  /** The routine's name when this version was saved. */
  name: string;
  notes: string;
  items: WorkoutRoutineItem[];
  source: RoutineVersionSource;
  /** A name the person gave this version ("Shoulder-friendly"). Null for none. */
  label: string | null;
}

/**
 * One version of a program's structure: its name, rotation, length and
 * scheme, with the version of each routine in the rotation that was current
 * when it was saved. Training maxes are not versioned: they move every cycle.
 */
export interface WorkoutProgramVersion {
  id: string;
  programId: string;
  createdAt: string;
  name: string;
  weeks: number | null;
  rotation: string[];
  scheme: ProgressionScheme | null;
  /** routineId → `WorkoutRoutineVersion.id` current when this version was saved. */
  routineVersionIds: Record<string, string>;
  label: string | null;
}

/**
 * A place the person trains, and the equipment it has. Plans, not the health
 * record: gyms sync like routines do. `latitude`/`longitude` (a pair, or both
 * null) and `radiusM` are what starting a workout compares a position against
 * to offer this gym; nothing here reads the position itself.
 */
export interface Gym {
  id: string;
  name: string;
  /** The equipment it has, from the closed `ExerciseEquipment` set. Empty means nothing is known yet, not "none". */
  equipment: ExerciseEquipment[];
  /** What the place was called when it was picked from a search, shown under the name. */
  placeText: string;
  latitude: number | null;
  longitude: number | null;
  radiusM: number;
  sortOrder: number;
  archived: boolean;
  createdAt: string;
}

/**
 * What differs about one exercise at one gym: a note ("seat 4"), and the bar
 * and the load step (how much one click of the stack or one pair of plates
 * adds) where they aren't the exercise's own. One row per (gym, exercise), its
 * id derived from the pair so two devices writing the same one meet on it.
 * A row with every field empty is deleted rather than kept.
 */
export interface GymExerciseSetting {
  id: string;
  gymId: string;
  exerciseId: string;
  notes: string;
  barKg: number | null;
  incrementKg: number | null;
}

/** A training max for one exercise, which a `percent` scheme's sets are measured from. */
export interface TrainingMax {
  exerciseId: string;
  kg: number;
}

/**
 * Several routines in rotation over a number of weeks. Which week it is and
 * which routine is next are derived from its sessions, never stored.
 */
export interface WorkoutProgram {
  id: string;
  name: string;
  /** How long a cycle runs. Null for an open-ended program. */
  weeks: number | null;
  /** Routine ids in the order they come round. */
  rotation: string[];
  /** How its exercises move on when their routine doesn't choose. Null: the app proposes nothing. */
  scheme: ProgressionScheme | null;
  trainingMaxes: TrainingMax[];
  startedAt: string | null;
  archived: boolean;
  createdAt: string;
  /** The current `WorkoutProgramVersion.id`. Null or absent before versions were kept. */
  currentVersionId?: string | null;
}

/**
 * One workout, live or finished. Part of the health record (`HEALTH_SYNC_TABLES`):
 * iCloud never receives it, and a sync server only with `syncServerHealthLogs` on.
 */
export interface WorkoutSession {
  id: string;
  routineId: string | null;
  programId: string | null;
  /** The task occurrence it completed. Provenance only: allowed to dangle. */
  taskId: string | null;
  /** The gym it was done at (`Gym.id`), or null for none chosen. Provenance only: allowed to dangle. */
  gymId?: string | null;
  /**
   * The routine version it was done on (`WorkoutRoutineVersion.id`), stamped
   * at start. Null on a workout from before versions were kept, which is
   * counted against the version in effect when it started (`sessionVersionId`).
   */
  routineVersionId?: string | null;
  title: string;
  startedAt: string;
  /** Null while the session is live. */
  endedAt: string | null;
  notes: string;
  /** How hard it felt, 1 to 10, as the person typed it. Never derived. */
  effort: number | null;
  /** The `HKWorkout` it was written to Health as (phase 5), by the phone or by the Apple Watch that measured it. */
  healthWorkoutId: string | null;
  healthWritePending: boolean;
  /**
   * The Apple Watch measured this workout (heart rate and energy) and saves
   * it to Health itself (phase 9): `healthWorkoutId` is the watch's, or will
   * be once it arrives, so the phone holds its own write back and asks the
   * watch to retract it. False once the phone has written its own copy in
   * its place. Not derived from a Health read, since the workout page has to
   * say a retime loses the heart rate with reading off, and a delete has to
   * know which device to ask (docs/arch/workouts.md, "Phase 9, as built").
   */
  measuredOnWatch: boolean;
  /**
   * Somebody changed the start or the end after the session began: the
   * workout page's Started and Finished rows, or an agent's `update_workout`,
   * both through `updateSession`. Never cleared. Recorded because nothing else
   * says it: a watch's copy that ends a little after the row's is a Finish
   * tapped on both devices unless the person moved the end
   * (`watchCopyStale` in src/utils/watchHealthWorkout.ts). Synced with the
   * row, so an agent's edit carries it to the phone.
   */
  timesEdited: boolean;
  /**
   * Rest after each set, in seconds, set on an exercise while the workout was
   * going (workout mode's Rest chip), keyed by `Exercise.id`. 0 is "no rest".
   * It outranks the routine item's rest and the default for this workout only
   * (`restSecondsFor`) and never edits the routine: the finish summary offers
   * it as a change. Absent on a workout that set none.
   */
  restOverrides?: Record<string, number>;
}

/**
 * One set of one exercise in a session. Its own row rather than JSON on the
 * session, because sets are appended one at a time (from the phone, later the
 * watch) and have to sync and dedupe by id. Weight is kilograms. The fields a
 * set uses follow its exercise's `ExerciseKind`; the rest stay null.
 */
export interface WorkoutSet {
  id: string;
  sessionId: string;
  exerciseId: string;
  /** Where the exercise sits in the session. Sets of one exercise share it. */
  position: number;
  /** The set's order within its exercise, from 0. */
  setIndex: number;
  kind: WorkoutSetKind;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
  rpe: number | null;
  /** When it was ticked off. Null for a set laid out but not done yet. */
  completedAt: string | null;
  supersetKey: string | null;
  note: string | null;
}

/**
 * The bars and plates the person has, for working out a load as plates
 * (phase 3). Kilograms throughout, like every weight.
 */
export interface PlateInventory {
  barsKg: number[];
  /** Each plate size and how many of it there are in total (both sides together). */
  plates: { kg: number; count: number }[];
}
