import type {
  ExerciseKind,
  MuscleGroup,
  ProgressionScheme,
  RoutineSetTarget,
  WorkoutRoutineItem,
  WorkoutSetKind,
} from '../types';
import type { WeightUnit } from './weightLog';
import { MUSCLE_LABELS, formatRestSeconds, formatWeightWithUnit } from './workoutData';
import { formatDistance, setBadge } from './workoutSession';

/**
 * The routine editor's rules: what an item's targets add up to, and the edits
 * the editor makes to them, written so an edit changes only what it names.
 * Pure and tested (`workoutRoutine.test.ts`); `RoutineEditorSheet` draws.
 *
 * **Every set is edited on its own.** The editor draws an item's targets as a
 * table, one row per planned set, and each edit names the set it changes
 * (`withSetKind`, `withSetWeight`, `withSetReps`, `duplicateSet`, `removeSet`),
 * so a pyramid, a drop set or a last set to failure is written as it is meant
 * and nothing else moves. Fields the editor has no control for (a percentage
 * of the training max, an RPE) ride along on the target untouched.
 *
 * **Two rules hold the table's shape.** Warm-ups come first, since a warm-up
 * after the work isn't one; and an item keeps at least one set that isn't a
 * warm-up, since the rest of the app reads an item's working weight and reps
 * off it. The editor never offers an edit that would break either (`canRemoveSet`,
 * `kindsFor`), and the functions refuse one anyway.
 *
 * **The progression is a choice stored on the item.** Workout mode proposes
 * the next load from it (`workoutProgression.ts`), as a suggestion the person
 * accepts with a tap; nothing here or there applies one unasked.
 */

/** How an item reads in a line: its counts by kind, and the values of its first working set. */
export interface RoutineItemShape {
  warmups: number;
  /** Plain working sets, the ones the table numbers. */
  workingSets: number;
  dropSets: number;
  /** Sets to failure (`amrap`). */
  failureSets: number;
  /** The lowest and highest reps across the working sets. */
  repsMin: number | null;
  repsMax: number | null;
  /** The first working set's weight: what a ramp is worked out from. */
  weightKg: number | null;
  durationSeconds: number | null;
}

const isWarmup = (t: RoutineSetTarget) => t.kind === 'warmup';

/**
 * The shape of an item's targets. The values come from its plain working
 * sets, else (an item that is all drop or failure sets) from whatever isn't a
 * warm-up, so a weight or a rep range is never lost from the line for want of
 * a set called "working".
 */
export function itemShape(item: Pick<WorkoutRoutineItem, 'targets'>): RoutineItemShape {
  const work = item.targets.filter(t => !isWarmup(t));
  const working = item.targets.filter(t => t.kind === 'working');
  const basis = working.length > 0 ? working : work;
  const mins = basis.map(t => t.repsMin ?? t.repsMax).filter((n): n is number => n != null);
  const maxes = basis.map(t => t.repsMax ?? t.repsMin).filter((n): n is number => n != null);
  return {
    warmups: item.targets.length - work.length,
    workingSets: working.length,
    dropSets: item.targets.filter(t => t.kind === 'drop').length,
    failureSets: item.targets.filter(t => t.kind === 'amrap').length,
    repsMin: mins.length ? Math.min(...mins) : null,
    repsMax: maxes.length ? Math.max(...maxes) : null,
    weightKg: basis[0]?.weightKg ?? null,
    durationSeconds: basis[0]?.durationSeconds ?? null,
  };
}

/** The most sets an item holds that aren't warm-ups: a typo check, not a coaching limit. */
export const MAX_ROUTINE_SETS = 20;

/** The most warm-up sets an item holds. */
export const MAX_WARMUP_SETS = 10;

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

// ==== one set at a time ====

/** The kinds a set can be, in the order the editor's menu lists them. */
export const ROUTINE_SET_KINDS: readonly WorkoutSetKind[] = ['warmup', 'working', 'drop', 'amrap'];

/** What each kind is called in the editor's menu, and how a set of it is spoken of. */
export const SET_KIND_LABELS: Record<WorkoutSetKind, string> = {
  warmup: 'Warm-up',
  working: 'Working',
  drop: 'Drop set',
  amrap: 'To failure',
};

/** The sets that aren't warm-ups. */
const workCount = (targets: readonly RoutineSetTarget[]) => targets.filter(t => !isWarmup(t)).length;

/** Warm-ups first, each group in the order it was in. */
const warmupsFirst = (targets: readonly RoutineSetTarget[]) =>
  [...targets.filter(isWarmup), ...targets.filter(t => !isWarmup(t))];

/** The item with these targets, warm-ups first, and no ramp once it holds a warm-up of its own. */
function withTargets(item: WorkoutRoutineItem, targets: RoutineSetTarget[]): WorkoutRoutineItem {
  const ordered = warmupsFirst(targets);
  const base = ordered.some(isWarmup) ? noRamp(item) : item;
  return { ...base, targets: ordered };
}

const inRange = (item: WorkoutRoutineItem, index: number) => index >= 0 && index < item.targets.length;

/**
 * What the set at `index` is labelled in the table: "W", "D" or "F" for a
 * warm-up, a drop set or a set to failure, and the working sets numbered 1, 2,
 * 3 however many of those come before them. The same rule workout mode
 * numbers a session's sets by (`setLabels`), so a routine reads the way the
 * workout it starts will.
 */
export function routineSetLabels(targets: readonly Pick<RoutineSetTarget, 'kind'>[]): string[] {
  let n = 0;
  return targets.map(t => setBadge(t.kind) ?? String(++n));
}

/**
 * Whether the set at `index` can go: anything but the item's only set that
 * isn't a warm-up. Removing that one is removing the exercise, which has its
 * own button.
 */
export function canRemoveSet(item: Pick<WorkoutRoutineItem, 'targets'>, index: number): boolean {
  const t = item.targets[index];
  if (!t) return false;
  return isWarmup(t) || workCount(item.targets) > 1;
}

/** Whether another set of this one's sort (warm-up or not) fits under its cap. */
export function canDuplicateSet(item: Pick<WorkoutRoutineItem, 'targets'>, index: number): boolean {
  const t = item.targets[index];
  if (!t) return false;
  return isWarmup(t)
    ? item.targets.length - workCount(item.targets) < MAX_WARMUP_SETS
    : workCount(item.targets) < MAX_ROUTINE_SETS;
}

/**
 * The kinds the set at `index` may become. The item's only set that isn't a
 * warm-up can't become one (the item would have no work left), and a warm-up
 * can only become work while there is room for another set of work.
 */
export function kindsFor(item: Pick<WorkoutRoutineItem, 'targets'>, index: number): WorkoutSetKind[] {
  const t = item.targets[index];
  if (!t) return [];
  const warmups = item.targets.length - workCount(item.targets);
  return ROUTINE_SET_KINDS.filter(kind => {
    if (kind === t.kind) return true;
    if (kind === 'warmup') return workCount(item.targets) > 1 && warmups < MAX_WARMUP_SETS;
    return !isWarmup(t) || workCount(item.targets) < MAX_ROUTINE_SETS;
  });
}

/**
 * The item with the set at `index` made this kind. A set taken to failure
 * names the fewest reps it is aiming past, so a range collapses to its low
 * end ("6–8" becomes "6+"): the table shows that end, and workout mode lays
 * the set out with it. Making a set a warm-up moves it up among the warm-ups
 * and turns a ramp off, since a ramp and warm-ups of the item's own don't mix.
 */
export function withSetKind(item: WorkoutRoutineItem, index: number, kind: WorkoutSetKind): WorkoutRoutineItem {
  if (!inRange(item, index) || !kindsFor(item, index).includes(kind)) return item;
  const targets = item.targets.map((t, i) => {
    if (i !== index) return t;
    const next: RoutineSetTarget = { ...t, kind };
    if (kind === 'amrap' && next.repsMin != null) next.repsMax = next.repsMin;
    return next;
  });
  return withTargets(item, targets);
}

/** The item with this target weight on the set at `index`, or none (null): workout mode then starts it from last time's. */
export function withSetWeight(item: WorkoutRoutineItem, index: number, kg: number | null): WorkoutRoutineItem {
  if (!inRange(item, index)) return item;
  const weightKg = kg !== null && kg > 0 ? kg : null;
  return { ...item, targets: item.targets.map((t, i) => (i === index ? { ...t, weightKg } : t)) };
}

/**
 * The item with this rep range on the set at `index`. A range given backwards
 * is the same range, one end alone is a fixed count, and both ends empty is
 * none (workout mode then starts the set from last time's reps).
 */
export function withSetReps(item: WorkoutRoutineItem, index: number, min: number | null, max: number | null): WorkoutRoutineItem {
  if (!inRange(item, index)) return item;
  let lo = min === null ? null : Math.max(1, Math.round(min));
  let hi = max === null ? null : Math.max(1, Math.round(max));
  if (lo !== null && hi !== null && lo > hi) [lo, hi] = [hi, lo];
  const repsMin = lo ?? hi;
  const repsMax = hi ?? lo;
  return { ...item, targets: item.targets.map((t, i) => (i === index ? { ...t, repsMin, repsMax } : t)) };
}

/** The item with this hold time on the set at `index`, or none. */
export function withSetDuration(item: WorkoutRoutineItem, index: number, seconds: number | null): WorkoutRoutineItem {
  if (!inRange(item, index)) return item;
  const durationSeconds = seconds !== null && seconds > 0 ? Math.round(seconds) : null;
  return { ...item, targets: item.targets.map((t, i) => (i === index ? { ...t, durationSeconds } : t)) };
}

/** The item with a copy of the set at `index` straight after it. */
export function duplicateSet(item: WorkoutRoutineItem, index: number): WorkoutRoutineItem {
  if (!canDuplicateSet(item, index)) return item;
  const targets = [...item.targets];
  targets.splice(index + 1, 0, { ...item.targets[index] });
  return { ...item, targets };
}

/** The item without the set at `index`, unless it is the only set that isn't a warm-up. */
export function removeSet(item: WorkoutRoutineItem, index: number): WorkoutRoutineItem {
  if (!canRemoveSet(item, index)) return item;
  return { ...item, targets: item.targets.filter((_, i) => i !== index) };
}

/**
 * The item with one more working set: a copy of its last working set (as a
 * plain working set, if it only had drop or failure sets to copy), placed
 * after the last working set so it takes the next number and a drop set or a
 * set to failure stays at the end.
 */
export function addSet(item: WorkoutRoutineItem): WorkoutRoutineItem {
  if (workCount(item.targets) >= MAX_ROUTINE_SETS) return item;
  const lastWorking = item.targets.map(t => t.kind).lastIndexOf('working');
  const work = item.targets.filter(t => !isWarmup(t));
  const template: RoutineSetTarget = lastWorking >= 0
    ? item.targets[lastWorking]
    : { ...(work[work.length - 1] ?? { repsMin: 8, repsMax: 12 }), kind: 'working' };
  const at = lastWorking >= 0 ? lastWorking + 1 : item.targets.length;
  const targets = [...item.targets];
  targets.splice(at, 0, { ...template, kind: 'working' });
  return { ...item, targets };
}

/**
 * The item with one more warm-up, after the warm-ups it has: a copy of the
 * last one, or a set naming no weight or reps (workout mode lays it out from
 * last time's warm-up). Turns a ramp off, as any warm-up of the item's own does.
 */
export function addWarmup(item: WorkoutRoutineItem): WorkoutRoutineItem {
  const warmups = item.targets.filter(isWarmup);
  if (warmups.length >= MAX_WARMUP_SETS) return item;
  const next: RoutineSetTarget = warmups.length
    ? { ...warmups[warmups.length - 1] }
    : { kind: 'warmup', repsMin: null, repsMax: null };
  return withTargets(item, [...warmups, next, ...item.targets.filter(t => !isWarmup(t))]);
}

/**
 * A set's reps as its table cell reads: "6–8", "10", "6+" for a set to
 * failure aiming past six, "Max" for one with no number, and null for a set
 * that names none (it starts from last time's).
 */
export function describeTargetReps(t: Pick<RoutineSetTarget, 'kind' | 'repsMin' | 'repsMax'>): string | null {
  if (t.kind === 'amrap') {
    const floor = t.repsMin ?? t.repsMax;
    return floor != null ? `${floor}+` : 'Max';
  }
  if (t.repsMin == null && t.repsMax == null) return null;
  if (t.repsMin == null || t.repsMax == null || t.repsMin === t.repsMax) return String(t.repsMin ?? t.repsMax);
  return `${t.repsMin}–${t.repsMax}`;
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

/**
 * "3 × 6–8", "3 × 0:30", "3 sets", then "1 drop set" and "1 to failure" when
 * the item has them: the sets an item asks for, without warm-ups. Working
 * sets with different reps (a pyramid) read as the span they cover.
 */
export function describeSets(item: Pick<WorkoutRoutineItem, 'targets'>, kind: ExerciseKind): string {
  const shape = itemShape(item);
  const n = shape.workingSets;
  const parts: string[] = [];
  if (n > 0) {
    if (kind === 'duration' && shape.durationSeconds !== null) parts.push(`${n} × ${formatRestSeconds(shape.durationSeconds)}`);
    else if (kind !== 'duration' && kind !== 'distance' && kind !== 'weight_distance' && shape.repsMin !== null) {
      const reps = shape.repsMax !== null && shape.repsMax !== shape.repsMin
        ? `${shape.repsMin}–${shape.repsMax}`
        : String(shape.repsMin);
      parts.push(`${n} × ${reps}`);
    } else {
      const distance = item.targets.find(t => t.kind === 'working')?.distanceM;
      parts.push(distance != null ? `${n} × ${formatDistance(distance)}` : `${n} ${n === 1 ? 'set' : 'sets'}`);
    }
  }
  if (shape.dropSets > 0) parts.push(`${shape.dropSets} ${shape.dropSets === 1 ? 'drop set' : 'drop sets'}`);
  if (shape.failureSets > 0) parts.push(`${shape.failureSets} to failure`);
  return parts.join(' · ');
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
