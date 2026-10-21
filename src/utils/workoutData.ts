import type {
  ExerciseEquipment,
  ExerciseKind,
  MuscleGroup,
  PlateInventory,
  ProgressionScheme,
  RoutineProgression,
  RoutineSetTarget,
  TrainingMax,
  WorkoutRoutineItem,
  WorkoutSetKind,
} from '../types';
import { kgToUnit, unitToKg, type WeightUnit } from './weightLog';
import { formatStopwatch } from './effort';

/**
 * The closed vocabularies of the workout records, their labels, and the
 * readers that turn a stored value back into one of them.
 *
 * Every reader is resolve-or-shrug: a row written by a newer build, or edited
 * by hand, reads as the nearest thing this build understands rather than
 * throwing while a list is being mapped. That is the same call
 * `parseSavedViewClauses` makes, and for the same reason: one bad item must not
 * take every routine after it down with it. See docs/arch/workouts.md.
 */

export const EXERCISE_KINDS: readonly ExerciseKind[] = [
  'weight_reps', 'bodyweight_reps', 'assisted_reps', 'duration', 'distance', 'weight_distance',
];

/** Free weights, bars and the rest that are neither a strength machine nor a cardio one. */
export const FREE_EQUIPMENT: readonly ExerciseEquipment[] = [
  'barbell', 'dumbbell', 'kettlebell', 'cable', 'smith_machine', 'ez_bar', 'trap_bar', 'band',
];

/**
 * Gear a bodyweight, throwing or conditioning movement needs that a gym may not have. Filed
 * apart from `other` because `other` is read as available everywhere (not
 * knowing is never "can't"), which put a medicine ball slam and a weighted dip
 * in the swap suggestions for a gym that was only bands.
 */
export const ACCESSORY_EQUIPMENT: readonly ExerciseEquipment[] = [
  'pull_up_bar', 'dip_bars', 'medicine_ball', 'sled', 'battle_ropes', 'jump_rope', 'ab_wheel', 'heavy_bag', 'neck_harness',
];

/** The strength machines with a value of their own. `machine` stands in for any other. */
export const STRENGTH_MACHINES: readonly ExerciseEquipment[] = [
  'leg_press', 'hack_squat', 'leg_extension', 'leg_curl', 'calf_raise_machine',
  'hip_abduction_machine', 'hip_adduction_machine',
  'chest_press_machine', 'pec_deck', 'shoulder_press_machine', 'row_machine', 'assisted_machine',
];

/** The cardio machines with a value of their own. `cardio_machine` stands in for any other. */
export const CARDIO_MACHINES: readonly ExerciseEquipment[] = [
  'treadmill', 'stationary_bike', 'air_bike', 'rowing_machine', 'elliptical', 'stair_climber', 'ski_erg',
];

export const EXERCISE_EQUIPMENT: readonly ExerciseEquipment[] = [
  ...FREE_EQUIPMENT,
  ...ACCESSORY_EQUIPMENT,
  ...STRENGTH_MACHINES, 'machine',
  ...CARDIO_MACHINES, 'cardio_machine',
  'bodyweight', 'other',
];

/**
 * The catch-all a specific machine sits under. A gym that has the catch-all
 * ticked is read as having every machine under it: that is what ticking
 * "Machine" meant before the specific ones existed, and it keeps a saved gym
 * from suddenly lacking its leg press.
 */
export function machineParent(equipment: ExerciseEquipment): 'machine' | 'cardio_machine' | null {
  if (STRENGTH_MACHINES.includes(equipment)) return 'machine';
  if (CARDIO_MACHINES.includes(equipment)) return 'cardio_machine';
  return null;
}

/** The kinds of equipment a picker narrows by first: weights, machines, bodyweight, cardio. */
export type EquipmentGroup = 'free' | 'machine' | 'bodyweight' | 'cardio';

/**
 * Which group a piece of equipment sits in. Cable and the Smith machine count
 * as machines (the weight is guided), and a band or "Other" sits in none, so
 * only "All" and the equipment list reach them.
 */
export function equipmentGroup(equipment: ExerciseEquipment): EquipmentGroup | null {
  if (equipment === 'bodyweight') return 'bodyweight';
  if (CARDIO_MACHINES.includes(equipment) || equipment === 'cardio_machine') return 'cardio';
  if (STRENGTH_MACHINES.includes(equipment) || equipment === 'machine' || equipment === 'cable' || equipment === 'smith_machine') return 'machine';
  if (['barbell', 'dumbbell', 'kettlebell', 'ez_bar', 'trap_bar'].includes(equipment)) return 'free';
  return null;
}

export const MUSCLE_GROUPS: readonly MuscleGroup[] = [
  'chest', 'lats', 'upper_back', 'lower_back', 'traps',
  'front_delts', 'side_delts', 'rear_delts',
  'biceps', 'triceps', 'forearms',
  'abs', 'obliques',
  'quads', 'hamstrings', 'glutes', 'adductors', 'abductors', 'calves',
  'neck',
];

export const WORKOUT_SET_KINDS: readonly WorkoutSetKind[] = ['warmup', 'working', 'drop', 'amrap'];

export const PROGRESSION_SCHEMES: readonly ProgressionScheme[] = ['double', 'linear', 'percent', 'rpe'];

/** What a filter or a row calls each piece of equipment. */
export const EQUIPMENT_LABELS: Record<ExerciseEquipment, string> = {
  barbell: 'Barbell',
  dumbbell: 'Dumbbell',
  kettlebell: 'Kettlebell',
  cable: 'Cable',
  smith_machine: 'Smith machine',
  ez_bar: 'EZ bar',
  trap_bar: 'Trap bar',
  band: 'Band',
  bodyweight: 'Bodyweight',
  other: 'Other',
  pull_up_bar: 'Pull-up bar',
  dip_bars: 'Dip bars',
  medicine_ball: 'Medicine ball',
  sled: 'Sled',
  battle_ropes: 'Battle ropes',
  jump_rope: 'Jump rope',
  ab_wheel: 'Ab wheel',
  heavy_bag: 'Heavy bag',
  neck_harness: 'Neck harness',
  machine: 'Other machine',
  leg_press: 'Leg press',
  hack_squat: 'Hack squat',
  leg_extension: 'Leg extension',
  leg_curl: 'Leg curl',
  calf_raise_machine: 'Calf raise',
  hip_abduction_machine: 'Hip abduction',
  hip_adduction_machine: 'Hip adduction',
  chest_press_machine: 'Chest press',
  pec_deck: 'Pec deck',
  shoulder_press_machine: 'Shoulder press',
  row_machine: 'Row machine',
  assisted_machine: 'Assisted pull-up/dip',
  cardio_machine: 'Other cardio machine',
  treadmill: 'Treadmill',
  stationary_bike: 'Exercise bike',
  air_bike: 'Air bike',
  rowing_machine: 'Rowing machine',
  elliptical: 'Elliptical',
  stair_climber: 'Stair climber',
  ski_erg: 'Ski erg',
};

/** What a filter or a row calls each muscle group. */
export const MUSCLE_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  lats: 'Lats',
  upper_back: 'Upper back',
  lower_back: 'Lower back',
  traps: 'Traps',
  front_delts: 'Front delts',
  side_delts: 'Side delts',
  rear_delts: 'Rear delts',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  obliques: 'Obliques',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  adductors: 'Adductors',
  abductors: 'Abductors',
  calves: 'Calves',
  neck: 'Neck',
};

/** The longest exercise or routine name kept. */
export const WORKOUT_NAME_MAX_LENGTH = 80;

/**
 * How hard a workout felt, as the person rates it: a whole number from `min`
 * to `max`, and `start` is where the stepper lands on the first tap. The
 * store keeps only what falls in the range, and every stepper that sets it
 * (workout mode's summary, the workout page) reads it from here.
 */
export const WORKOUT_EFFORT = { min: 1, max: 10, start: 7 } as const;

/**
 * The key a custom exercise's name is unique on: trimmed, lowercased, inner
 * whitespace collapsed, so "Cable  fly" and "cable fly " are one exercise. The
 * store refuses a duplicate on it and the sync fold matches on it
 * (`NATURAL_KEYS.exercises`), so both have to call this one function.
 */
export function exerciseNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** A name as stored: trimmed, inner whitespace collapsed, capped. Empty for a blank one. */
export function cleanWorkoutName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, WORKOUT_NAME_MAX_LENGTH);
}

/**
 * A name nobody else holds: the one given, else "Upper A (2)", "Upper A (3)"
 * and on. Clashes are judged on `exerciseNameKey`, the key this area's names
 * are unique on, so "upper  a" counts as "Upper A". The suffix is kept whole
 * when the cap shortens a long name.
 */
export function freeWorkoutName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map(exerciseNameKey));
  const clean = cleanWorkoutName(name);
  if (!taken.has(exerciseNameKey(clean))) return clean;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const candidate = `${clean.slice(0, WORKOUT_NAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(exerciseNameKey(candidate))) return candidate;
  }
}

function oneOf<T extends string>(values: readonly T[], raw: unknown, fallback: T): T {
  return typeof raw === 'string' && (values as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export function readExerciseKind(raw: unknown): ExerciseKind {
  return oneOf(EXERCISE_KINDS, raw, 'weight_reps');
}

export function readEquipment(raw: unknown): ExerciseEquipment {
  return oneOf(EXERCISE_EQUIPMENT, raw, 'other');
}

export function readSetKind(raw: unknown): WorkoutSetKind {
  return oneOf(WORKOUT_SET_KINDS, raw, 'working');
}

export function readScheme(raw: unknown): ProgressionScheme {
  return oneOf(PROGRESSION_SCHEMES, raw, 'double');
}

/**
 * The column a program with no scheme is stored as. The column is NOT NULL and
 * a device on an older build reads anything it doesn't know as `double`, so a
 * word rather than a null keeps both working.
 */
export const NO_SCHEME = 'none';

export function readProgramScheme(raw: unknown): ProgressionScheme | null {
  return raw === NO_SCHEME ? null : readScheme(raw);
}

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Known equipment only, each once, in the library's own order (not the order stored). */
export function readEquipmentList(raw: unknown): ExerciseEquipment[] {
  const parsed = parseMaybeJson(raw);
  if (!Array.isArray(parsed)) return [];
  return EXERCISE_EQUIPMENT.filter(e => parsed.includes(e));
}

/** Known muscle groups only, each once, in the order given. */
export function readMuscles(raw: unknown): MuscleGroup[] {
  const parsed = parseMaybeJson(raw);
  if (!Array.isArray(parsed)) return [];
  const out: MuscleGroup[] = [];
  for (const m of parsed) {
    if (typeof m === 'string' && (MUSCLE_GROUPS as readonly string[]).includes(m) && !out.includes(m as MuscleGroup)) {
      out.push(m as MuscleGroup);
    }
  }
  return out;
}

/** A finite number at or above `min`, or null. */
function num(raw: unknown, min = 0): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= min ? raw : null;
}

/** A whole number at or above `min`, or null. */
function int(raw: unknown, min = 0): number | null {
  const n = num(raw, min);
  return n === null ? null : Math.round(n);
}

function readTarget(raw: unknown): RoutineSetTarget | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const target: RoutineSetTarget = {
    kind: readSetKind(t.kind),
    repsMin: int(t.repsMin, 0),
    repsMax: int(t.repsMax, 0),
  };
  const weightKg = num(t.weightKg);
  const pctOfTm = num(t.pctOfTm);
  const rpe = num(t.rpe);
  const durationSeconds = int(t.durationSeconds);
  const distanceM = num(t.distanceM);
  if (weightKg !== null) target.weightKg = weightKg;
  if (pctOfTm !== null) target.pctOfTm = pctOfTm;
  if (rpe !== null) target.rpe = rpe;
  if (durationSeconds !== null) target.durationSeconds = durationSeconds;
  if (distanceM !== null) target.distanceM = distanceM;
  // A range written backwards is the same range.
  if (target.repsMin !== null && target.repsMax !== null && target.repsMin > target.repsMax) {
    [target.repsMin, target.repsMax] = [target.repsMax, target.repsMin];
  }
  return target;
}

function readProgression(raw: unknown): RoutineProgression | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.scheme !== 'string' || !(PROGRESSION_SCHEMES as readonly string[]).includes(p.scheme)) return null;
  return { scheme: p.scheme as ProgressionScheme, incrementKg: num(p.incrementKg) };
}

/**
 * A routine's items, read back out of their JSON. An item with no exercise id
 * is dropped (there is nothing to do), and every other field is read on its
 * own, so a target this build doesn't understand loses only itself.
 */
export function readRoutineItems(raw: unknown): WorkoutRoutineItem[] {
  const parsed = parseMaybeJson(raw);
  if (!Array.isArray(parsed)) return [];
  const out: WorkoutRoutineItem[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const i = entry as Record<string, unknown>;
    if (typeof i.exerciseId !== 'string' || !i.exerciseId) continue;
    const targets = Array.isArray(i.targets)
      ? i.targets.map(readTarget).filter((t): t is RoutineSetTarget => t !== null)
      : [];
    const ramp = i.warmupRamp === true;
    out.push({
      exerciseId: i.exerciseId,
      supersetKey: typeof i.supersetKey === 'string' && i.supersetKey ? i.supersetKey : null,
      restSeconds: int(i.restSeconds),
      progression: readProgression(i.progression),
      // A ramp replaces the item's own warm-ups, so a row carrying both (two
      // devices editing at once) reads as the ramp.
      targets: ramp ? targets.filter(t => t.kind !== 'warmup') : targets,
      // Written only when on, so an item from before it reads exactly as it did.
      ...(ramp ? { warmupRamp: true } : {}),
    });
  }
  return out;
}

/** A list of ids (a program's rotation): strings only, blanks dropped. Repeats are kept, since a rotation may come back to a routine. */
export function readIdList(raw: unknown): string[] {
  const parsed = parseMaybeJson(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

/** A program's training maxes: one per exercise (the last given wins), positive loads only. */
export function readTrainingMaxes(raw: unknown): TrainingMax[] {
  const parsed = parseMaybeJson(raw);
  if (!Array.isArray(parsed)) return [];
  const byExercise = new Map<string, number>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const kg = num(e.kg);
    if (typeof e.exerciseId !== 'string' || !e.exerciseId || kg === null || kg <= 0) continue;
    byExercise.set(e.exerciseId, kg);
  }
  return [...byExercise.entries()].map(([exerciseId, kg]) => ({ exerciseId, kg }));
}

/**
 * A rest when nothing else says how long: the `defaultRestSeconds` setting's
 * value on a fresh install. Ninety seconds is the common middle between the
 * short rests of accessory work and the long ones of heavy compound sets.
 */
export const DEFAULT_REST_SECONDS = 90;

/** The shortest and longest rest the setting holds. */
export const REST_SECONDS_MIN = 10;
export const REST_SECONDS_MAX = 600;

/** The stored rest setting, read back: a whole number of seconds in range, else the default. */
export function parseRestSeconds(raw: string | null): number {
  const n = raw === null || raw.trim() === '' ? Number.NaN : Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_REST_SECONDS;
  return clampRestSeconds(n);
}

export function clampRestSeconds(seconds: number): number {
  return Math.min(REST_SECONDS_MAX, Math.max(REST_SECONDS_MIN, Math.round(seconds)));
}

/**
 * A metric gym's bars and plates, two of each plate a side. What a fresh
 * install starts from until the person says what they have; kilograms, like
 * every weight in the records.
 */
export const DEFAULT_PLATE_INVENTORY: PlateInventory = {
  barsKg: [20, 15],
  plates: [25, 20, 15, 10, 5, 2.5, 1.25].map(kg => ({ kg, count: 4 })),
};

/**
 * The stored plate inventory, read back. Bars are positive weights, each once;
 * plates are positive weights with a positive whole count, one entry per
 * weight (counts for a repeated weight add up), heaviest first. Anything that
 * isn't an inventory at all reads as the default, so a damaged value still
 * leaves something to work a load out from.
 */
export function parsePlateInventory(raw: string | null): PlateInventory {
  const parsed = raw ? parseMaybeJson(raw) : null;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return clonePlates(DEFAULT_PLATE_INVENTORY);
  return normalizePlateInventory(parsed as Partial<PlateInventory>);
}

export function normalizePlateInventory(input: Partial<PlateInventory>): PlateInventory {
  const bars: number[] = [];
  for (const b of Array.isArray(input.barsKg) ? input.barsKg : []) {
    const kg = num(b);
    if (kg !== null && kg > 0 && !bars.includes(kg)) bars.push(kg);
  }
  const counts = new Map<number, number>();
  for (const p of Array.isArray(input.plates) ? input.plates : []) {
    if (!p || typeof p !== 'object') continue;
    const kg = num((p as { kg?: unknown }).kg);
    const count = int((p as { count?: unknown }).count, 1);
    if (kg === null || kg <= 0 || count === null) continue;
    counts.set(kg, (counts.get(kg) ?? 0) + count);
  }
  return {
    barsKg: bars.sort((a, b) => b - a),
    plates: [...counts.entries()].sort((a, b) => b[0] - a[0]).map(([kg, count]) => ({ kg, count })),
  };
}

function clonePlates(inv: PlateInventory): PlateInventory {
  return { barsKg: [...inv.barsKg], plates: inv.plates.map(p => ({ ...p })) };
}

// ==== weights on screen ====
//
// Every weight is stored in kilograms; `workoutUnit` decides only what a
// screen shows and steps in (the `waterUnit` split). These are the one place
// a weight crosses that edge, so a set typed in pounds is stored, read back
// and stepped the same way everywhere.

/** One press of a weight stepper: a pair of the smallest common plates, in each unit. */
export const WEIGHT_STEP: Record<WeightUnit, number> = { kg: 2.5, lb: 5 };

/**
 * Decimal places a weight is shown and typed to: two in kilograms, for a
 * 1.25 kg plate a side, one in pounds, where nothing is finer than a quarter
 * and a converted kilogram would otherwise read 44.09.
 */
export const WEIGHT_PLACES: Record<WeightUnit, number> = { kg: 2, lb: 1 };

/** The heaviest load a set will hold, in kg: a typo check, not a judgement. */
export const MAX_SET_WEIGHT_KG = 1000;

const round = (n: number, places: number) => Number(n.toFixed(places));

/** A stored weight in the unit shown, rounded to that unit's places. */
export function weightToDisplay(kg: number, unit: WeightUnit): number {
  return round(kgToUnit(kg, unit), WEIGHT_PLACES[unit]);
}

/**
 * A weight typed or stepped in the unit shown, as stored. Kept to three
 * places of a kilogram, so 135 lb is stored as 61.235 and reads back as 135
 * rather than as 134.99.
 */
export function weightFromDisplay(value: number, unit: WeightUnit): number {
  return round(unitToKg(value, unit), 3);
}

/** "82.5", "80", "1.25": a weight in the unit shown, with no trailing zeros and no unit. */
export function formatWeightNumber(kg: number, unit: WeightUnit): string {
  return String(weightToDisplay(kg, unit));
}

/** "82.5 kg", "185 lb". */
export function formatWeightWithUnit(kg: number, unit: WeightUnit): string {
  return `${formatWeightNumber(kg, unit)} ${unit}`;
}

/**
 * "1:30", "2:00": a rest or a hold in minutes and seconds. `formatStopwatch`,
 * so a rest planned in the routine editor and the rest counting down in
 * workout mode are punctuated the same as every other clock in the app.
 */
export function formatRestSeconds(seconds: number): string {
  return formatStopwatch(Math.round(seconds));
}
