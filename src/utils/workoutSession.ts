import type {
  ExerciseKind,
  RoutineSetTarget,
  WorkoutRoutine,
  WorkoutSession,
  WorkoutSet,
  WorkoutSetKind,
} from '../types';
import type { WeightUnit } from './weightLog';
import { formatRestSeconds, formatWeightNumber, formatWeightWithUnit } from './workoutData';

/**
 * The live workout's rules: which set is next, where the screen goes after a
 * set is logged, what a routine lays out, what last time was, and what
 * finishing writes. Pure, like `cookMode.ts` and `focusPlan.ts`; the store
 * writes and workout mode draws. See docs/arch/workouts.md.
 *
 * **Nothing here moves a session on by itself.** Logging a set is a person's
 * tap, and every answer below is about what that tap does; a rest that runs
 * out changes nothing here (`afterLog` is the only "next" there is).
 *
 * **Planned sets are rows with no `completedAt`.** A routine lays its sets
 * out as rows so they can be shown, edited and ticked one by one; finishing
 * deletes the ones never ticked (`finishPlan`), since a plan nobody carried
 * out is not a record of anything.
 */

/** One exercise of a session, in the order workout mode walks it. */
export interface SessionExercise {
  exerciseId: string;
  position: number;
  /** Items sharing a key are a superset. The first set carrying one decides it. */
  supersetKey: string | null;
  /** Its sets, in order. */
  sets: WorkoutSet[];
}

const isDone = (s: WorkoutSet) => s.completedAt !== null;
const bySetOrder = (a: WorkoutSet, b: WorkoutSet) => a.position - b.position || a.setIndex - b.setIndex;

/** A session's sets, grouped by exercise in the session's order. */
export function sessionExercises(sets: readonly WorkoutSet[]): SessionExercise[] {
  const byExercise = new Map<string, SessionExercise>();
  for (const s of [...sets].sort(bySetOrder)) {
    let ex = byExercise.get(s.exerciseId);
    if (!ex) {
      ex = { exerciseId: s.exerciseId, position: s.position, supersetKey: null, sets: [] };
      byExercise.set(s.exerciseId, ex);
    }
    if (ex.supersetKey === null && s.supersetKey) ex.supersetKey = s.supersetKey;
    ex.sets.push(s);
  }
  return [...byExercise.values()].sort((a, b) => a.position - b.position);
}

/**
 * The exercises done together with this one: the run of neighbours sharing
 * its superset key, or the exercise alone. Only a run counts, so two
 * exercises that share a key but sit apart are not alternated across the
 * ones between them.
 */
export function supersetGroup<T extends { exerciseId: string; supersetKey?: string | null }>(exercises: readonly T[], exerciseId: string): T[] {
  const i = exercises.findIndex(e => e.exerciseId === exerciseId);
  if (i < 0) return [];
  const key = exercises[i].supersetKey;
  if (!key) return [exercises[i]];
  let start = i;
  while (start > 0 && exercises[start - 1].supersetKey === key) start--;
  let end = i;
  while (end < exercises.length - 1 && exercises[end + 1].supersetKey === key) end++;
  return exercises.slice(start, end + 1);
}

/**
 * A group's sets in the order they are done: round by round, each exercise's
 * first set, then each one's second (A1, B1, A2, B2). An exercise with more
 * sets than its partner finishes its extra rounds alone. For a group of one
 * this is just its sets.
 */
export function roundRobin(group: readonly SessionExercise[]): WorkoutSet[] {
  const rounds = Math.max(0, ...group.map(e => e.sets.length));
  const out: WorkoutSet[] = [];
  for (let r = 0; r < rounds; r++) {
    for (const ex of group) if (r < ex.sets.length) out.push(ex.sets[r]);
  }
  return out;
}

/** Every set of a session in the order workout mode walks it, supersets alternated. */
export function walkOrder(sets: readonly WorkoutSet[]): WorkoutSet[] {
  const exercises = sessionExercises(sets);
  const out: WorkoutSet[] = [];
  const seen = new Set<string>();
  for (const ex of exercises) {
    if (seen.has(ex.exerciseId)) continue;
    const group = supersetGroup(exercises, ex.exerciseId);
    for (const member of group) seen.add(member.exerciseId);
    out.push(...roundRobin(group));
  }
  return out;
}

/**
 * The session's exercise order with one exercise moved a place up or down,
 * for `reorderExercises`: the Apple Watch's list moves a row this way. An
 * exercise in a superset moves with its partners, as one block past the
 * neighbouring block (an exercise, or another superset), so a pair is never
 * split by the move. Null when it can't move that way: unknown, or already
 * at that end.
 */
export function movedExerciseOrder(
  sets: readonly WorkoutSet[],
  exerciseId: string,
  direction: 'up' | 'down',
): string[] | null {
  const blocks = exerciseBlocks(sets);
  const at = blocks.findIndex(b => b.some(e => e.exerciseId === exerciseId));
  const to = direction === 'up' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= blocks.length) return null;
  [blocks[at], blocks[to]] = [blocks[to], blocks[at]];
  return blocks.flat().map(e => e.exerciseId);
}

/**
 * The session's exercises as the blocks a reorder moves: a superset is one
 * block (its run of partners), any other exercise a block of its own. The
 * reorder list drags these, so a pair is never split by a drop.
 */
export function exerciseBlocks(sets: readonly WorkoutSet[]): SessionExercise[][] {
  const exercises = sessionExercises(sets);
  const blocks: SessionExercise[][] = [];
  const seen = new Set<string>();
  for (const ex of exercises) {
    if (seen.has(ex.exerciseId)) continue;
    const group = supersetGroup(exercises, ex.exerciseId);
    group.forEach(e => seen.add(e.exerciseId));
    blocks.push(group);
  }
  return blocks;
}

/** The sets with each exercise's position and superset key rewritten from an exercise order and a key per exercise. */
function relaidOut(sets: readonly WorkoutSet[], order: readonly string[], keys: ReadonlyMap<string, string | null>): WorkoutSet[] {
  const positionOf = new Map(order.map((id, i) => [id, i]));
  return sets
    .map(s => ({ ...s, position: positionOf.get(s.exerciseId) ?? s.position, supersetKey: keys.get(s.exerciseId) ?? null }))
    .sort(bySetOrder);
}

/**
 * The session's sets with `partnerId` made a superset with `exerciseId`: the
 * partner (and its own superset, if it has one) moves to sit right below the
 * exercise's group, and every exercise in the two groups takes one key, the
 * exercise's own when it already has one (`newKey` otherwise). Done and
 * planned sets alike carry the key, so history shows the pair. Null when
 * either is unknown or they are already together.
 */
export function joinedSuperset(
  sets: readonly WorkoutSet[],
  exerciseId: string,
  partnerId: string,
  newKey: string,
): WorkoutSet[] | null {
  const exercises = sessionExercises(sets);
  if (exerciseId === partnerId) return null;
  const mine = supersetGroup(exercises, exerciseId);
  const theirs = supersetGroup(exercises, partnerId);
  if (mine.length === 0 || theirs.length === 0) return null;
  const mineIds = mine.map(e => e.exerciseId);
  const theirIds = theirs.map(e => e.exerciseId);
  if (theirIds.includes(exerciseId)) return null;
  const key = mine[0].supersetKey ?? newKey;
  const rest = exercises.map(e => e.exerciseId).filter(id => !theirIds.includes(id));
  const at = rest.indexOf(mineIds[mineIds.length - 1]);
  const order = [...rest.slice(0, at + 1), ...theirIds, ...rest.slice(at + 1)];
  const keys = new Map(exercises.map(e => [e.exerciseId, e.supersetKey] as [string, string | null]));
  for (const id of [...mineIds, ...theirIds]) keys.set(id, key);
  return relaidOut(sets, order, keys);
}

/**
 * The session's sets with `exerciseId` taken out of its superset. Out of the
 * middle of a run the half below takes a new key, and a partner left alone
 * leaves too (the routine editor's `leaveSuperset` rule). Null when the
 * exercise isn't in one.
 */
export function leftSuperset(sets: readonly WorkoutSet[], exerciseId: string): WorkoutSet[] | null {
  const exercises = sessionExercises(sets);
  const index = exercises.findIndex(e => e.exerciseId === exerciseId);
  if (index < 0 || !exercises[index].supersetKey) return null;
  const key = exercises[index].supersetKey;
  const keys = new Map(exercises.map(e => [e.exerciseId, e.supersetKey] as [string, string | null]));
  keys.set(exerciseId, null);
  // Out of the middle of a run the half below takes a new key, so the two
  // halves aren't one superset with a gap in it.
  const group = supersetGroup(exercises, exerciseId);
  const at = group.findIndex(e => e.exerciseId === exerciseId);
  if (at > 0 && at < group.length - 1) {
    for (const e of group.slice(at + 1)) keys.set(e.exerciseId, `${key}:${exerciseId}`);
  }
  // A partner left alone is no longer in a superset.
  for (const [id, k] of keys) {
    if (k && [...keys.values()].filter(v => v === k).length < 2) keys.set(id, null);
  }
  return relaidOut(sets, exercises.map(e => e.exerciseId), keys);
}

/** The first set not yet done, in walking order; null once every set is done. */
export function nextSet(sets: readonly WorkoutSet[]): WorkoutSet | null {
  return walkOrder(sets).find(s => !isDone(s)) ?? null;
}

/** The set an exercise's card opens on: its first not done, or null when they all are. */
export function currentSetOf(exercise: SessionExercise): WorkoutSet | null {
  return exercise.sets.find(s => !isDone(s)) ?? null;
}

export interface AfterLog {
  /** The exercise whose card to show next. */
  showExerciseId: string;
  /** Whether logging this set starts a rest. */
  rest: boolean;
}

/**
 * Where a logged set leaves the screen, and whether it starts a rest.
 *
 * - **On its own**, an exercise keeps its card (the next set is right under
 *   the one just ticked), and the set starts a rest.
 * - **In a superset**, the next set is the partner's in the same round, so
 *   the card turns to the partner and no rest starts: the pair is done back
 *   to back and rested after (the mock's "rest 1:30 after the pair"). The
 *   set that closes the round starts the rest, and the card goes back to
 *   where the next round begins.
 * - **With nothing left** in the exercise or its group, the card stays and
 *   the set still starts a rest, which is the rest before the next exercise.
 *   Moving on to it is the person's tap: a finished exercise is a moment to
 *   look at what was done, not one to be taken away from it.
 *
 * A set ticked out of order (set 3 before set 2) is answered the same way,
 * from where it sits; the skipped set is next, because it is the first one
 * still open.
 */
export function afterLog(sets: readonly WorkoutSet[], loggedSetId: string): AfterLog | null {
  const logged = sets.find(s => s.id === loggedSetId);
  if (!logged) return null;
  const exercises = sessionExercises(sets);
  const group = supersetGroup(exercises, logged.exerciseId);
  const walk = roundRobin(group);
  const k = walk.findIndex(s => s.id === loggedSetId);
  const next = walk.slice(k + 1).find(s => !isDone(s)) ?? walk.slice(0, k).find(s => !isDone(s)) ?? null;
  if (!next) return { showExerciseId: logged.exerciseId, rest: true };
  const roundOf = (s: WorkoutSet) =>
    group.find(e => e.exerciseId === s.exerciseId)!.sets.findIndex(x => x.id === s.id);
  const midRound = group.length > 1 && next.exerciseId !== logged.exerciseId && roundOf(next) === roundOf(logged);
  return { showExerciseId: next.exerciseId, rest: !midRound };
}

/**
 * How long the rest after a set of this exercise runs: its routine item's own
 * rest where the session follows a routine that has the exercise and says,
 * else the `defaultRestSeconds` setting. Zero means the item asks for no rest.
 */
export function restSecondsFor(
  routine: Pick<WorkoutRoutine, 'items'> | null,
  exerciseId: string,
  defaultRestSeconds: number,
): number {
  const item = routine?.items.find(i => i.exerciseId === exerciseId);
  return item?.restSeconds ?? defaultRestSeconds;
}

// ==== last time ====

/**
 * The sets of an exercise from the last session that did it: every done set
 * of the newest session other than `exceptSessionId`, in order. `history` is
 * the exercise's sets from any session (`exerciseHistory`); `sessions` decides
 * which is newest, since a set's own time says when it was ticked, not which
 * workout it was part of. Empty when it has never been done.
 */
export function previousSets(
  history: readonly WorkoutSet[],
  sessions: readonly Pick<WorkoutSession, 'id' | 'startedAt'>[],
  exceptSessionId: string | null,
): WorkoutSet[] {
  const bySession = new Map<string, WorkoutSet[]>();
  for (const s of history) {
    if (!isDone(s) || s.sessionId === exceptSessionId) continue;
    if (!bySession.has(s.sessionId)) bySession.set(s.sessionId, []);
    bySession.get(s.sessionId)!.push(s);
  }
  const newest = [...sessions]
    .filter(s => bySession.has(s.id))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  return newest ? bySession.get(newest.id)!.sort((a, b) => a.setIndex - b.setIndex) : [];
}

/**
 * Each set's counterpart from last time: the nth warm-up against the nth
 * warm-up, the nth working set against the nth working set. Matched by kind
 * rather than by position, so adding a warm-up this time doesn't shift every
 * working set's PREVIOUS onto the wrong one.
 */
export function matchPrevious(
  current: readonly Pick<WorkoutSet, 'id' | 'kind'>[],
  previous: readonly WorkoutSet[],
): Map<string, WorkoutSet | null> {
  const pools = new Map<WorkoutSetKind, WorkoutSet[]>();
  for (const s of previous) {
    if (!pools.has(s.kind)) pools.set(s.kind, []);
    pools.get(s.kind)!.push(s);
  }
  const used = new Map<WorkoutSetKind, number>();
  const out = new Map<string, WorkoutSet | null>();
  for (const s of current) {
    const n = used.get(s.kind) ?? 0;
    used.set(s.kind, n + 1);
    out.set(s.id, pools.get(s.kind)?.[n] ?? null);
  }
  return out;
}

/**
 * What the PREVIOUS column shows: each set's counterpart from last time by
 * position. Warm-ups pair with warm-ups; every other set (working, drop, to
 * failure) shares one pool, so the nth of those today pairs with the nth of
 * those last time whatever either was labelled. Relabelling a set therefore
 * never moves its PREVIOUS, and a set with no counterpart of its own kind
 * (a third working set after two and a failure set) still has something to
 * compare against. The kind of the matched set is shown beside it
 * (`previousBadge`), so a set that went to failure reads as one.
 *
 * Display only: `plannedSetsFor` and a swap keep `matchPrevious`, which pairs
 * by kind, because they copy the matched reps into a set and a failure set's
 * reps are not a target for an ordinary one.
 */
export function matchPreviousByPosition(
  current: readonly Pick<WorkoutSet, 'id' | 'kind'>[],
  previous: readonly WorkoutSet[],
): Map<string, WorkoutSet | null> {
  const pools = { warmup: [] as WorkoutSet[], rest: [] as WorkoutSet[] };
  for (const s of previous) pools[s.kind === 'warmup' ? 'warmup' : 'rest'].push(s);
  const used = { warmup: 0, rest: 0 };
  const out = new Map<string, WorkoutSet | null>();
  for (const s of current) {
    const pool = s.kind === 'warmup' ? 'warmup' : 'rest';
    out.set(s.id, pools[pool][used[pool]++] ?? null);
  }
  return out;
}

/** The letter shown beside a PREVIOUS figure: F or D when that set wasn't an ordinary one, else null. */
export function previousBadge(prev: Pick<WorkoutSet, 'kind'>): string | null {
  return prev.kind === 'amrap' || prev.kind === 'drop' ? setBadge(prev.kind) : null;
}

// ==== what a set records ====

export type SetField = 'weight' | 'reps' | 'duration' | 'distance';

/** The values a set of this kind of exercise takes, in the order a row shows them. */
export function setFieldsFor(kind: ExerciseKind): SetField[] {
  switch (kind) {
    case 'weight_reps': return ['weight', 'reps'];
    case 'assisted_reps': return ['weight', 'reps'];
    case 'bodyweight_reps': return ['reps'];
    case 'duration': return ['duration'];
    case 'distance': return ['distance'];
    case 'weight_distance': return ['weight', 'distance'];
  }
}

/**
 * What a value column is headed in a table of sets: the unit for a weight
 * (with a minus for assistance, which takes weight off), as workout mode's
 * mock has it. Workout mode and the routine editor's set table share it, so
 * the two tables read alike.
 */
export function columnLabel(field: SetField, kind: ExerciseKind, unit: WeightUnit, weightSuffix = ''): string {
  if (field === 'weight') return `${kind === 'assisted_reps' ? `−${unit}` : unit}${weightSuffix}`;
  if (field === 'reps') return 'Reps';
  if (field === 'duration') return 'Time';
  return 'Dist';
}

/** What one of a set's values is called in words, above its stepper. */
export function fieldLabel(field: SetField, kind: ExerciseKind): string {
  if (field === 'weight') return kind === 'assisted_reps' ? 'Assistance' : 'Weight';
  if (field === 'reps') return 'Reps';
  if (field === 'duration') return 'Time';
  return 'Distance';
}

/** A distance in metres as a set shows it: "400 m", "1.2 km". */
export function formatDistance(m: number): string {
  return m >= 1000 ? `${Number((m / 1000).toFixed(2))} km` : `${Math.round(m)} m`;
}

/**
 * A set as one short line, the way PREVIOUS and the finish summary read it:
 * "80 × 8", "0:45", "400 m", "24 × 400 m". Null when it records nothing the
 * exercise's kind uses. Units are left off weights, which the column heading
 * or the summary's own line already names.
 *
 * `withUnit` is for a list with no heading to name the unit (the workout
 * page): the weight carries it ("82.5 kg × 8"), and an assisted exercise's
 * weight reads as the assistance it is ("−20 kg × 8"), which is what workout
 * mode's "−kg" column heading says of the same number.
 */
export function formatSetLine(
  set: Pick<WorkoutSet, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'>,
  kind: ExerciseKind,
  unit: WeightUnit,
  withUnit = false,
  /** 2 reads a stored one-dumbbell weight as a pair total (`dumbbellLoad.ts`). */
  scale = 1,
): string | null {
  const w = set.weightKg === null
    ? null
    : withUnit
      ? `${kind === 'assisted_reps' && set.weightKg > 0 ? '−' : ''}${formatWeightWithUnit(set.weightKg * scale, unit)}`
      : formatWeightNumber(set.weightKg * scale, unit);
  switch (kind) {
    case 'weight_reps':
    case 'assisted_reps':
      if (w !== null && set.reps !== null) return `${w} × ${set.reps}`;
      if (set.reps !== null) return `${set.reps} reps`;
      return w;
    case 'bodyweight_reps':
      return set.reps !== null ? `${set.reps} reps` : null;
    case 'duration':
      return set.durationSeconds !== null ? formatRestSeconds(set.durationSeconds) : null;
    case 'distance':
      return set.distanceM !== null ? formatDistance(set.distanceM) : null;
    case 'weight_distance':
      if (w !== null && set.distanceM !== null) return `${w} × ${formatDistance(set.distanceM)}`;
      return set.distanceM !== null ? formatDistance(set.distanceM) : w;
  }
}

/** The letter a set's row leads with in place of its number: W for a warm-up, D for a drop set. */
export function setBadge(kind: WorkoutSetKind): string | null {
  if (kind === 'warmup') return 'W';
  if (kind === 'drop') return 'D';
  // `amrap` is shown as a set to failure: the F Strong and Hevy mark one with,
  // and that the CSV export already writes.
  if (kind === 'amrap') return 'F';
  return null;
}

/**
 * The number each set shows in the SET column: warm-ups, drop sets and sets
 * to failure carry their letter instead, and count nothing, so the working
 * sets read 1, 2, 3 however many warm-ups come first.
 */
export function setLabels(sets: readonly WorkoutSet[]): Map<string, string> {
  const out = new Map<string, string>();
  let n = 0;
  for (const s of sets) {
    const badge = setBadge(s.kind);
    if (badge) out.set(s.id, badge);
    else out.set(s.id, String(++n));
  }
  return out;
}

/**
 * A set named in words, from its `setLabels` entry: "Set 2", "Warm-up" or
 * "Drop set". What a screen reader hears, and what a set's note is filed under
 * once the workout is over.
 */
export function setName(kind: WorkoutSetKind, label: string): string {
  if (kind === 'warmup') return 'Warm-up';
  if (kind === 'drop') return 'Drop set';
  if (kind === 'amrap') return 'To failure';
  return `Set ${label}`;
}

// ==== laying sets out ====

/** What a new set is written with: the store's `SetInput`, minus the exercise. */
export interface PlannedSetValues {
  kind: WorkoutSetKind;
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceM: number | null;
  supersetKey: string | null;
}

/**
 * The sets a routine item lays out: one per target, filled from the target
 * where it names a weight, else from last time's matching set, so the numbers
 * on screen are ones the person has already lifted or planned. Reps come from
 * last time, else the top of the range. Nothing here is a progression: the
 * target is what the routine says and last time is what happened, and moving
 * on from either is `workoutProgression.ts`'s proposal, never applied unasked.
 * An item that warms up with a ramp gets its warm-ups from `ramp`, worked out
 * from the first working weight laid out.
 */
export function plannedSetsFor(
  item: { targets: readonly RoutineSetTarget[]; supersetKey?: string | null; warmupRamp?: boolean },
  previous: readonly WorkoutSet[],
  ramp?: (workingKg: number | null) => readonly { kg: number; reps: number }[],
): PlannedSetValues[] {
  const matched = matchPrevious(item.targets.map((t, i) => ({ id: String(i), kind: t.kind })), previous);
  const planned = item.targets.map((t, i): PlannedSetValues => {
    const last = matched.get(String(i)) ?? null;
    return {
      kind: t.kind,
      weightKg: t.weightKg ?? last?.weightKg ?? null,
      reps: last?.reps ?? t.repsMax ?? t.repsMin ?? null,
      durationSeconds: t.durationSeconds ?? last?.durationSeconds ?? null,
      distanceM: t.distanceM ?? last?.distanceM ?? null,
      supersetKey: item.supersetKey ?? null,
    };
  });
  // A ramp is worked out from the first working set's weight as laid out
  // here, so it ramps to what is on screen; with no weight there is nothing
  // to ramp to, and no warm-ups are laid out.
  if (!item.warmupRamp || !ramp) return planned;
  const workingKg = planned.find(p => p.kind !== 'warmup')?.weightKg ?? null;
  const warmups = ramp(workingKg).map((step): PlannedSetValues => ({
    kind: 'warmup', weightKg: step.kg, reps: step.reps, durationSeconds: null, distanceM: null,
    supersetKey: item.supersetKey ?? null,
  }));
  return [...warmups, ...planned];
}

/** A planned set at the place a new session gives it. */
export interface PlacedPlannedSet {
  exerciseId: string;
  position: number;
  setIndex: number;
  values: PlannedSetValues;
}

/**
 * A finished workout laid out again, for doing one with no routine behind it
 * a second time: the sets it did, in its order, at the numbers it did them.
 * Only done sets, since a planned set nobody ticked was never part of the
 * workout, and warm-ups too, since they were done. Places are numbered from
 * zero, so an exercise that was removed leaves no gap.
 */
export function repeatedSets(sets: readonly WorkoutSet[]): PlacedPlannedSet[] {
  const out: PlacedPlannedSet[] = [];
  sessionExercises(sets.filter(s => s.completedAt !== null)).forEach((ex, position) => {
    ex.sets.forEach((s, setIndex) => out.push({
      exerciseId: ex.exerciseId,
      position,
      setIndex,
      values: {
        kind: s.kind,
        weightKg: s.weightKg,
        reps: s.reps,
        durationSeconds: s.durationSeconds,
        distanceM: s.distanceM,
        supersetKey: s.supersetKey,
      },
    }));
  });
  return out;
}

/**
 * The sets an exercise added mid-session lays out: last time's again, as
 * planned, or one empty working set for an exercise never done before.
 */
export function plannedSetsFromHistory(previous: readonly WorkoutSet[]): PlannedSetValues[] {
  if (previous.length === 0) {
    return [{ kind: 'working', weightKg: null, reps: null, durationSeconds: null, distanceM: null, supersetKey: null }];
  }
  return previous.map(s => ({
    kind: s.kind, weightKg: s.weightKg, reps: s.reps, durationSeconds: s.durationSeconds,
    distanceM: s.distanceM, supersetKey: null,
  }));
}

/**
 * "Add set": one more set like the exercise's last, laid out to be done. A
 * warm-up copied becomes a working set, since adding a set after the warm-ups
 * is adding work; anything else keeps its kind (one more drop set).
 */
export function copyLastSet(exerciseSets: readonly WorkoutSet[]): PlannedSetValues {
  const last = exerciseSets[exerciseSets.length - 1];
  if (!last) {
    return { kind: 'working', weightKg: null, reps: null, durationSeconds: null, distanceM: null, supersetKey: null };
  }
  return {
    kind: last.kind === 'warmup' ? 'working' : last.kind,
    weightKg: last.weightKg,
    reps: last.reps,
    durationSeconds: last.durationSeconds,
    distanceM: last.distanceM,
    supersetKey: last.supersetKey,
  };
}

/**
 * "Same as last set": the values of the done set nearest above this one, to
 * write onto it. Null when nothing above it is done yet.
 */
export function valuesFromLastDone(
  exerciseSets: readonly WorkoutSet[],
  setId: string,
): Pick<WorkoutSet, 'weightKg' | 'reps' | 'durationSeconds' | 'distanceM'> | null {
  const i = exerciseSets.findIndex(s => s.id === setId);
  const before = (i < 0 ? exerciseSets : exerciseSets.slice(0, i)).filter(isDone);
  const last = before[before.length - 1];
  return last
    ? { weightKg: last.weightKg, reps: last.reps, durationSeconds: last.durationSeconds, distanceM: last.distanceM }
    : null;
}

// ==== finishing ====

export interface FinishPlan {
  /** Planned sets never ticked, deleted on finishing: a plan nobody carried out records nothing. */
  dropSetIds: string[];
  /** The sets that stay, which is what the workout was. */
  loggedCount: number;
}

/** What finishing a session writes to its sets. */
export function finishPlan(sets: readonly WorkoutSet[]): FinishPlan {
  return {
    dropSetIds: sets.filter(s => !isDone(s)).map(s => s.id),
    loggedCount: sets.filter(isDone).length,
  };
}

export interface ExerciseSummary {
  exerciseId: string;
  /** Sets done. */
  sets: number;
  /** The heaviest done set, by weight then reps; null when no done set carries a weight. */
  heaviest: WorkoutSet | null;
}

/**
 * Whole minutes from a session's start to its end, or to `now` while it is
 * live. The History row, the finish summary and the workout page all read it,
 * so a workout is the same length wherever it is shown.
 */
export function sessionMinutes(session: Pick<WorkoutSession, 'startedAt' | 'endedAt'>, now: Date = new Date()): number {
  const end = session.endedAt ? new Date(session.endedAt) : now;
  return Math.max(0, Math.floor((end.getTime() - new Date(session.startedAt).getTime()) / 60000));
}

export interface SessionSummary {
  /** Whole minutes from start to `endedAt` (or to `now` for a live session), `sessionMinutes`. */
  minutes: number;
  setsDone: number;
  /** Exercises with at least one set done, in session order. */
  exercises: ExerciseSummary[];
}

/**
 * What a workout amounted to, for the finish screen: how long, how many sets,
 * and each exercise's heaviest set. Derived each time from the sets, never
 * stored, and counting only what was ticked. No calories: nothing here is
 * estimated (docs/arch/workouts.md, "Absent stays absent").
 */
export function sessionSummary(
  session: Pick<WorkoutSession, 'startedAt' | 'endedAt'>,
  sets: readonly WorkoutSet[],
  now: Date = new Date(),
): SessionSummary {
  const minutes = sessionMinutes(session, now);
  const exercises: ExerciseSummary[] = [];
  for (const ex of sessionExercises(sets)) {
    const done = ex.sets.filter(isDone);
    if (done.length === 0) continue;
    const weighted = done.filter(s => s.weightKg !== null && s.kind !== 'warmup');
    const heaviest = weighted.reduce<WorkoutSet | null>((best, s) => {
      if (!best) return s;
      if (s.weightKg! !== best.weightKg!) return s.weightKg! > best.weightKg! ? s : best;
      return (s.reps ?? 0) > (best.reps ?? 0) ? s : best;
    }, null);
    exercises.push({ exerciseId: ex.exerciseId, sets: done.length, heaviest });
  }
  return { minutes, setsDone: sets.filter(isDone).length, exercises };
}
