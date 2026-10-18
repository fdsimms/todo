import type {
  ExerciseKind,
  MuscleGroup,
  ProgressionScheme,
  RoutineSetTarget,
  WorkoutRoutineItem,
} from '../types';
import type { WeightUnit } from './weightLog';
import { MUSCLE_LABELS, formatRestSeconds, formatWeightWithUnit } from './workoutData';
import { formatDistance } from './workoutSession';

/**
 * The routine editor's rules: what an item's targets add up to, and the edits
 * the editor makes to them, written so an edit changes only what it names.
 * Pure and tested (`workoutRoutine.test.ts`); `RoutineEditorSheet` draws.
 *
 * **An edit never flattens targets it didn't touch.** A routine written over
 * MCP or by a later build can hold per-set targets the editor has no control
 * for (an AMRAP last set, a drop set, a different weight per set). Changing
 * the working-set count copies the last of them or drops from the end;
 * changing the reps or the weight writes that one field on each working
 * target and leaves the rest of every target as it was.
 *
 * **The progression is a choice stored on the item.** Workout mode proposes
 * the next load from it (`workoutProgression.ts`), as a suggestion the person
 * accepts with a tap; nothing here or there applies one unasked.
 */

/** How the editor reads an item: the counts and the one value each control shows. */
export interface RoutineItemShape {
  warmups: number;
  /** Every target that isn't a warm-up: working, AMRAP and drop sets. */
  workingSets: number;
  repsMin: number | null;
  repsMax: number | null;
  weightKg: number | null;
  durationSeconds: number | null;
}

const isWarmup = (t: RoutineSetTarget) => t.kind === 'warmup';

/** The shape of an item's targets, read off its first working target. */
export function itemShape(item: Pick<WorkoutRoutineItem, 'targets'>): RoutineItemShape {
  const working = item.targets.filter(t => !isWarmup(t));
  const first = working[0];
  return {
    warmups: item.targets.length - working.length,
    workingSets: working.length,
    repsMin: first?.repsMin ?? null,
    repsMax: first?.repsMax ?? null,
    weightKg: first?.weightKg ?? null,
    durationSeconds: first?.durationSeconds ?? null,
  };
}

/** The most sets of one kind an item holds: a typo check, not a coaching limit. */
export const MAX_ROUTINE_SETS = 20;

const clampCount = (n: number) => Math.max(0, Math.min(MAX_ROUTINE_SETS, Math.round(n)));

/** The targets a new item starts with, by what the exercise records. */
export function defaultTargets(kind: ExerciseKind): RoutineSetTarget[] {
  const one: RoutineSetTarget = kind === 'duration'
    ? { kind: 'working', repsMin: null, repsMax: null, durationSeconds: 30 }
    : kind === 'distance' || kind === 'weight_distance'
      ? { kind: 'working', repsMin: null, repsMax: null }
      : { kind: 'working', repsMin: 8, repsMax: 12 };
  return [one, { ...one }, { ...one }];
}

/** A new item for an exercise: three working sets, the default rest, no progression chosen. */
export function newRoutineItem(exerciseId: string, kind: ExerciseKind): WorkoutRoutineItem {
  return { exerciseId, supersetKey: null, restSeconds: null, progression: null, targets: defaultTargets(kind) };
}

/** The item with `n` working sets: copies of the last working target added, or the last ones dropped. */
export function withWorkingSets(item: WorkoutRoutineItem, n: number): WorkoutRoutineItem {
  const want = Math.max(1, clampCount(n));
  const warmups = item.targets.filter(isWarmup);
  const working = item.targets.filter(t => !isWarmup(t));
  const template: RoutineSetTarget = working[working.length - 1] ?? { kind: 'working', repsMin: 8, repsMax: 12 };
  const next = working.slice(0, want);
  while (next.length < want) next.push({ ...template });
  return { ...item, targets: [...warmups, ...next] };
}

/** The item without a ramp: the key dropped rather than set false, so it reads as an item from before ramps. */
function noRamp(item: WorkoutRoutineItem): WorkoutRoutineItem {
  if (!item.warmupRamp) return item;
  const { warmupRamp: _ramp, ...rest } = item;
  return rest;
}

/**
 * The item with `n` warm-up sets ahead of the work. A new warm-up names no
 * weight or reps: what a warm-up is lifted at is last time's warm-up, laid
 * out when the workout starts. Counting warm-ups turns a ramp off.
 */
export function withWarmups(item: WorkoutRoutineItem, n: number): WorkoutRoutineItem {
  const want = clampCount(n);
  const warmups = item.targets.filter(isWarmup).slice(0, want);
  while (warmups.length < want) warmups.push({ kind: 'warmup', repsMin: null, repsMax: null });
  return { ...noRamp(item), targets: [...warmups, ...item.targets.filter(t => !isWarmup(t))] };
}

/** How an item warms up: not at all, with a ramp worked out from the working weight, or a count of its own warm-up sets. */
export type WarmupMode = 'none' | 'ramp' | 'sets';

export function warmupMode(item: Pick<WorkoutRoutineItem, 'targets' | 'warmupRamp'>): WarmupMode {
  if (item.warmupRamp) return 'ramp';
  return item.targets.some(isWarmup) ? 'sets' : 'none';
}

/** Warm-up sets "Sets" starts with when the item had none: two, a light and a middling one. */
export const DEFAULT_WARMUP_SETS = 2;

/**
 * The item warming up this way. A ramp holds no warm-up targets (the ramp is
 * laid out from the working weight when the workout starts), and switching to
 * counted sets keeps any the item had, else starts at `DEFAULT_WARMUP_SETS`.
 */
export function withWarmupMode(item: WorkoutRoutineItem, mode: WarmupMode): WorkoutRoutineItem {
  const work = item.targets.filter(t => !isWarmup(t));
  if (mode === 'none') return { ...noRamp(item), targets: work };
  if (mode === 'ramp') return { ...item, targets: work, warmupRamp: true };
  const had = item.targets.filter(isWarmup).length;
  return withWarmups(noRamp(item), had > 0 ? had : DEFAULT_WARMUP_SETS);
}

function onWorking(item: WorkoutRoutineItem, patch: Partial<RoutineSetTarget>): WorkoutRoutineItem {
  return { ...item, targets: item.targets.map(t => (isWarmup(t) ? t : { ...t, ...patch })) };
}

/**
 * The item with this rep range on every working set. A range given backwards
 * is the same range, and one end alone is a fixed count ("5", not "5 or more").
 */
export function withReps(item: WorkoutRoutineItem, min: number | null, max: number | null): WorkoutRoutineItem {
  let lo = min === null ? null : Math.max(0, Math.round(min));
  let hi = max === null ? null : Math.max(0, Math.round(max));
  if (lo !== null && hi !== null && lo > hi) [lo, hi] = [hi, lo];
  return onWorking(item, { repsMin: lo ?? hi, repsMax: hi ?? lo });
}

/** The item with this target weight on every working set, or none (null). */
export function withTargetWeight(item: WorkoutRoutineItem, kg: number | null): WorkoutRoutineItem {
  return onWorking(item, { weightKg: kg !== null && kg > 0 ? kg : null });
}

/** The item with this hold time on every working set. */
export function withTargetDuration(item: WorkoutRoutineItem, seconds: number | null): WorkoutRoutineItem {
  return onWorking(item, { durationSeconds: seconds !== null && seconds > 0 ? Math.round(seconds) : null });
}

/** The item with this scheme chosen, keeping a step already set; null clears the choice. */
export function withProgression(item: WorkoutRoutineItem, scheme: ProgressionScheme | null): WorkoutRoutineItem {
  return {
    ...item,
    progression: scheme === null ? null : { scheme, incrementKg: item.progression?.incrementKg ?? null },
  };
}

/** What each scheme is called on the editor's control. */
export const PROGRESSION_LABELS: Record<ProgressionScheme, string> = {
  double: 'Rep range',
  linear: 'Linear',
  percent: '% of max',
  rpe: 'RPE',
};

/**
 * What each scheme means, in a sentence, under the control. Each says how
 * workout mode suggests the next load from it.
 */
export const PROGRESSION_HINTS: Record<ProgressionScheme, string> = {
  double: 'Workout mode suggests more weight once every working set reaches the top of the rep range.',
  linear: 'Workout mode suggests more weight after every workout where each set reaches its reps, and about 10% less after three short workouts in a row.',
  percent: 'Each set is a percentage of the training max set in the program.',
  rpe: 'Workout mode suggests a weight from how hard the last top set felt, from 1 to 10.',
};

// ==== supersets ====

/** Where an item sits in a superset: on its own, or first, in the middle or last of a run. */
export type SupersetRole = 'none' | 'first' | 'middle' | 'last';

/** Each item's place in its superset. Only a run of neighbours sharing a key is one. */
export function supersetRoles(items: readonly Pick<WorkoutRoutineItem, 'supersetKey'>[]): SupersetRole[] {
  return items.map((item, i) => {
    const key = item.supersetKey;
    if (!key) return 'none';
    const before = i > 0 && items[i - 1].supersetKey === key;
    const after = i < items.length - 1 && items[i + 1].supersetKey === key;
    if (before && after) return 'middle';
    if (before) return 'last';
    if (after) return 'first';
    return 'none';
  });
}

/**
 * Keys that no longer mark a run of two or more, cleared, and a key used by
 * two separate runs given to the first only. What a reorder or a removal is
 * passed through, so a superset is always a block of neighbours and nothing
 * else is left carrying a key that means nothing.
 */
export function normalizeSupersets<T extends Pick<WorkoutRoutineItem, 'supersetKey'>>(items: readonly T[]): T[] {
  const out = items.map(i => ({ ...i }));
  const closed = new Set<string>();
  let i = 0;
  while (i < out.length) {
    const key = out[i].supersetKey;
    if (!key) { i++; continue; }
    let end = i;
    while (end + 1 < out.length && out[end + 1].supersetKey === key) end++;
    if (end === i || closed.has(key)) {
      for (let j = i; j <= end; j++) out[j].supersetKey = null;
    }
    closed.add(key);
    i = end + 1;
  }
  return out;
}

/**
 * The items with the one at `index` joined to the superset of the one before
 * it (starting one, under `newKey`, if that one has none). Rest goes after the
 * run, so the item that was last before it stops resting on its own.
 */
export function joinPrevious<T extends Pick<WorkoutRoutineItem, 'supersetKey'>>(
  items: readonly T[],
  index: number,
  newKey: string,
): T[] {
  if (index <= 0 || index >= items.length) return [...items];
  const key = items[index - 1].supersetKey ?? newKey;
  const out = items.map((item, i) => (i === index - 1 || i === index ? { ...item, supersetKey: key } : item));
  return normalizeSupersets(out);
}

/** The items with the one at `index` taken out of its superset; a partner left alone leaves it too. */
export function leaveSuperset<T extends Pick<WorkoutRoutineItem, 'supersetKey'>>(items: readonly T[], index: number): T[] {
  const key = items[index]?.supersetKey;
  if (!key) return [...items];
  const roles = supersetRoles(items);
  // Out of the middle of a run, the run splits: the half below takes a new
  // key so the two halves aren't one superset with a gap in it.
  const out = items.map((item, i) => (i === index ? { ...item, supersetKey: null } : item));
  if (roles[index] === 'middle') {
    const below = `${key}:${index}`;
    for (let j = index + 1; j < out.length && out[j].supersetKey === key; j++) out[j] = { ...out[j], supersetKey: below };
  }
  return normalizeSupersets(out);
}

// ==== the one-line summary ====

export interface DescribeItemOptions {
  kind: ExerciseKind;
  unit: WeightUnit;
  /** The rest the setting gives an item that doesn't name its own. */
  defaultRestSeconds: number;
  role: SupersetRole;
}

/** "3 × 6–8", "3 × 0:30", "3 sets": the sets an item asks for, without warm-ups. */
export function describeSets(item: Pick<WorkoutRoutineItem, 'targets'>, kind: ExerciseKind): string {
  const shape = itemShape(item);
  const n = shape.workingSets;
  if (kind === 'duration' && shape.durationSeconds !== null) return `${n} × ${formatRestSeconds(shape.durationSeconds)}`;
  if (kind !== 'duration' && kind !== 'distance' && kind !== 'weight_distance' && shape.repsMin !== null) {
    const reps = shape.repsMax !== null && shape.repsMax !== shape.repsMin
      ? `${shape.repsMin}–${shape.repsMax}`
      : String(shape.repsMin);
    return `${n} × ${reps}`;
  }
  const distance = item.targets.find(t => !isWarmup(t))?.distanceM;
  if (distance != null) return `${n} × ${formatDistance(distance)}`;
  return `${n} ${n === 1 ? 'set' : 'sets'}`;
}

/**
 * The line under an exercise in the routine editor: "2 warm-up · 3 × 6–8 ·
 * 82.5 kg · rep range · rest 2:30". In a superset, only the last of the run
 * says how long the rest is, and that it comes after the whole superset; the
 * others have no rest of their own and say nothing about it.
 */
export function describeRoutineItem(item: WorkoutRoutineItem, opts: DescribeItemOptions): string {
  const shape = itemShape(item);
  const parts: string[] = [];
  if (item.warmupRamp) parts.push('ramp warm-up');
  else if (shape.warmups > 0) parts.push(`${shape.warmups} warm-up`);
  parts.push(describeSets(item, opts.kind));
  if (shape.weightKg !== null) parts.push(formatWeightWithUnit(shape.weightKg, opts.unit));
  if (item.progression) parts.push(PROGRESSION_LABELS[item.progression.scheme].toLowerCase());
  const rest = item.restSeconds ?? opts.defaultRestSeconds;
  if (opts.role === 'last') parts.push(rest > 0 ? `rest ${formatRestSeconds(rest)} after the superset` : 'no rest');
  else if (opts.role === 'none') parts.push(rest > 0 ? `rest ${formatRestSeconds(rest)}` : 'no rest');
  return parts.join(' · ');
}

/**
 * "5 exercises · Chest, Triceps, Front delts": a routine as its row on the
 * Workouts screen reads. The muscles are the primary ones of its exercises in
 * the order they first come up, at most three, so the line says what the day
 * is for without becoming a list.
 */
export function describeRoutine(
  items: readonly Pick<WorkoutRoutineItem, 'exerciseId'>[],
  musclesOf: (exerciseId: string) => readonly MuscleGroup[],
): string {
  const n = items.length;
  if (n === 0) return 'No exercises yet';
  const muscles: MuscleGroup[] = [];
  for (const item of items) {
    for (const m of musclesOf(item.exerciseId)) if (!muscles.includes(m)) muscles.push(m);
  }
  const count = `${n} ${n === 1 ? 'exercise' : 'exercises'}`;
  return muscles.length ? `${count} · ${muscles.slice(0, 3).map(m => MUSCLE_LABELS[m]).join(', ')}` : count;
}
