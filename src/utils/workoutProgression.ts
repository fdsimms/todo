import type {
  ExerciseEquipment,
  ExerciseKind,
  MuscleGroup,
  PlateInventory,
  ProgressionScheme,
  RoutineSetTarget,
  WorkoutProgram,
  WorkoutRoutineItem,
  WorkoutSession,
  WorkoutSet,
  WorkoutSetKind,
} from '../types';
import { kgToUnit, unitToKg, type WeightUnit } from './weightLog';
import { formatWeightNumber, weightFromDisplay, weightToDisplay } from './workoutData';
import { barKgFor, effectivePlateInventory, isPlateLoaded, plateLoad, warmupRamp } from './plateMath';

/**
 * The next session's targets for one exercise, proposed from what was lifted
 * before. Pure; workout mode shows the proposal on the exercise's card and the
 * MCP server's `next_workout` returns it. See docs/arch/workouts.md, phase 4.
 *
 * **A proposal is a suggestion and nothing more.** Nothing here writes a set,
 * a routine or a program: the card offers it with one tap ("Use 82.5 kg") and
 * the person decides. That is the repo's rule for everything the app works out
 * on someone's behalf (`energyBudget.ts`, the AI estimates).
 *
 * **Derived, never stored.** Every proposal is read off the exercise's own
 * history each time, so deleting or correcting a session moves it.
 *
 * **Weights are loads somebody can make.** A barbell, EZ bar or trap bar is
 * rounded to what the plates load (`plateLoad`, in the unit the person lifts
 * in, so a pound gym's 5 lb step is exact); a dumbbell, a machine or a cable is
 * stepped by the item's increment. Only weight and reps exercises get one: a
 * pull-up's or a plank's next step isn't a load, and nothing here is relative
 * to a body weight.
 *
 * The four schemes:
 * - **double** (rep range): once every working set reaches the top of the
 *   range, add the increment and start again from the bottom; until then keep
 *   the weight and aim for more reps.
 * - **linear**: add the increment after a workout where every working set hit
 *   its reps. After `LINEAR_DELOAD_AFTER` short workouts in a row at the same
 *   weight, propose about 10% less (`DELOAD_FRACTION`).
 * - **percent**: each working set is a percentage of the program's training
 *   max for the exercise, stepped through a wave by the program's week
 *   (`waveOffset`). Raising the training max at the end of a cycle is a
 *   program-level proposal (`trainingMaxRaises`).
 * - **rpe**: move the load by how hard the last top set felt against the
 *   effort planned (`RPE_LOAD_PER_POINT` per point of RPE).
 */

// ==== the numbers each scheme moves by ====

/** Short workouts in a row at one weight before a linear scheme proposes going lighter. */
export const LINEAR_DELOAD_AFTER = 3;

/** What a deload keeps of the weight: about 10% off, the common reset. */
export const DELOAD_FRACTION = 0.9;

/** The effort an RPE item aims for when its targets don't say: two reps left in the tank. */
export const DEFAULT_TARGET_RPE = 8;

/**
 * How much load one point of RPE is worth. Published RPE tables put it at 2 to
 * 4 percent a point around 5 reps; 3 is the middle.
 */
export const RPE_LOAD_PER_POINT = 0.03;

/** A percentage set with no `pctOfTm` of its own: the first week of a common three-set wave, by position. */
export const DEFAULT_WAVE_PERCENTS: readonly number[] = [65, 75, 85];

/** How far a wave climbs each week, in percentage points of the training max. */
export const WAVE_STEP_POINTS = 5;

/** The lighter last week of a cycle of four weeks or more, against week one. */
export const WAVE_DELOAD_POINTS = -10;

/** What a training max starts at when proposed from history: 90% of the best estimated 1RM. */
export const TRAINING_MAX_FRACTION = 0.9;

/** One step of load, in each unit: the smallest pair of common plates. */
const STEP_KG: Record<WeightUnit, number> = { kg: 2.5, lb: unitToKg(5, 'lb') };

/** A raised training max: a lower-body lift moves twice an upper-body one. */
const TM_RAISE_KG: Record<WeightUnit, { upper: number; lower: number }> = {
  kg: { upper: 2.5, lower: 5 },
  lb: { upper: unitToKg(5, 'lb'), lower: unitToKg(10, 'lb') },
};

const LOWER_BODY: readonly MuscleGroup[] = ['quads', 'hamstrings', 'glutes'];

/** The step a success adds when the item doesn't name one: 2.5 kg, or 5 lb for a pound lifter. */
export function defaultIncrementKg(unit: WeightUnit): number {
  return STEP_KG[unit];
}

/** The item's own increment, else the default for the unit. */
export function incrementFor(item: Pick<WorkoutRoutineItem, 'progression'> | null, unit: WeightUnit): number {
  const own = item?.progression?.incrementKg;
  return typeof own === 'number' && own > 0 ? own : defaultIncrementKg(unit);
}

/**
 * Which scheme moves an exercise on: its routine item's own choice, else the
 * program's, when the workout belongs to one. Null when neither chose.
 */
export function schemeFor(
  item: Pick<WorkoutRoutineItem, 'progression'> | null,
  program: Pick<WorkoutProgram, 'scheme'> | null,
): ProgressionScheme | null {
  return item?.progression?.scheme ?? program?.scheme ?? null;
}

// ==== loads the person can make ====

/** What rounding a weight needs to know about the exercise and the gym. */
export interface LoadContext {
  equipment: ExerciseEquipment;
  /** The exercise's own bar weight, or null for the equipment's default. */
  barKg: number | null;
  inventory: PlateInventory;
  unit: WeightUnit;
  /** The grid a dumbbell, machine or cable is stepped on, in kg. */
  incrementKg: number;
}

/** The context for one exercise: its equipment and bar, the gym's plates, and the item's increment. */
export function loadContextFor(
  exercise: { equipment: ExerciseEquipment; barKg: number | null },
  inventory: PlateInventory,
  unit: WeightUnit,
  item: Pick<WorkoutRoutineItem, 'progression'> | null,
): LoadContext {
  return { equipment: exercise.equipment, barKg: exercise.barKg, inventory, unit, incrementKg: incrementFor(item, unit) };
}

/** Hundredths of the shown unit: the integers loads are compared in, as `plateLoad` does. */
const hundredths = (kg: number, unit: WeightUnit) => Math.round(kgToUnit(kg, unit) * 100);
const fromHundredths = (h: number, unit: WeightUnit) => weightFromDisplay(h / 100, unit);

/** The same load, as the person reads it. */
export function sameLoad(a: number, b: number, unit: WeightUnit): boolean {
  return hundredths(a, unit) === hundredths(b, unit);
}

/** How far the search below steps through plate loads before giving up. */
const PLATE_SEARCH_STEPS = 400;

/**
 * A weight rounded to one the person can load: the nearest, or the nearest at
 * or above (`up`) or at or below (`down`) it. On a bar, what the plates make
 * (never under the bar); otherwise a multiple of the increment.
 */
export function roundLoad(kg: number, ctx: LoadContext, mode: 'nearest' | 'up' | 'down' = 'nearest'): number {
  const { unit } = ctx;
  if (!(kg > 0)) return 0;
  if (isPlateLoaded(ctx.equipment)) {
    const inventory = effectivePlateInventory(ctx.inventory, unit);
    const bar = barKgFor(ctx.barKg, inventory, ctx.equipment, unit);
    const at = (t: number) => plateLoad(t, bar, inventory, unit)?.loadedKg ?? bar;
    const near = at(kg);
    if (mode === 'nearest') return near;
    const want = hundredths(kg, unit);
    const smallest = inventory.plates.filter(p => p.count >= 2).reduce((m, p) => Math.min(m, p.kg), Infinity);
    const stride = Number.isFinite(smallest) ? smallest : STEP_KG[unit];
    if (mode === 'down') {
      if (hundredths(near, unit) <= want) return near;
      for (let i = 1, t = kg; i <= PLATE_SEARCH_STEPS; i++) {
        t -= stride;
        const c = at(t);
        if (hundredths(c, unit) <= want) return c;
        if (t <= bar) return bar;
      }
      return bar;
    }
    if (hundredths(near, unit) >= want) return near;
    for (let i = 1, t = kg; i <= PLATE_SEARCH_STEPS; i++) {
      t += stride;
      const c = at(t);
      if (hundredths(c, unit) >= want) return c;
    }
    // The plates can't make anything heavier: the heaviest they make.
    return near;
  }
  const step = hundredths(ctx.incrementKg, unit);
  if (step <= 0) return kg;
  const h = hundredths(kg, unit) / step;
  const n = mode === 'up' ? Math.ceil(h - 1e-9) : mode === 'down' ? Math.floor(h + 1e-9) : Math.round(h);
  return fromHundredths(n * step, unit);
}

/** One hundredth of the shown unit, in kg: the smallest difference two loads can show. */
const tick = (unit: WeightUnit) => unitToKg(0.01, unit);

/** The lightest load above this one. */
export function loadAbove(kg: number, ctx: LoadContext): number {
  return roundLoad(kg + tick(ctx.unit), ctx, 'up');
}

/** The heaviest load below this one, or 0. */
export function loadBelow(kg: number, ctx: LoadContext): number {
  return roundLoad(kg - tick(ctx.unit), ctx, 'down');
}

/**
 * The weight one success adds: the increment on top, as a load somebody can
 * make, and never the same weight again. A dumbbell or a machine steps by the
 * increment exactly, from wherever it was: a 22 kg dumbbell goes to 24.5, not
 * to the nearest multiple of 2.5.
 */
function stepUp(kg: number, ctx: LoadContext): number {
  if (!isPlateLoaded(ctx.equipment)) return kg + ctx.incrementKg;
  const t = roundLoad(kg + ctx.incrementKg, ctx);
  return hundredths(t, ctx.unit) > hundredths(kg, ctx.unit) ? t : loadAbove(kg, ctx);
}

function stepDown(kg: number, ctx: LoadContext): number {
  if (!isPlateLoaded(ctx.equipment)) return Math.max(0, kg - ctx.incrementKg);
  const t = roundLoad(kg - ctx.incrementKg, ctx);
  return hundredths(t, ctx.unit) < hundredths(kg, ctx.unit) ? t : loadBelow(kg, ctx);
}

// ==== warm-up ramps ====

export interface RampStep {
  kg: number;
  reps: number;
}

/**
 * The warm-ups a ramp lays out before a working weight: about 40, 60 and 80
 * percent of it, as loads the person can make, lighter each time than the
 * work. On a bar, `warmupRamp` (which also keeps the bare bar as a step); on
 * anything else, the same shares stepped by the increment. Empty when there is
 * no working weight to ramp to.
 */
export function rampSteps(workingKg: number | null, ctx: LoadContext): RampStep[] {
  if (workingKg === null || !(workingKg > 0)) return [];
  if (isPlateLoaded(ctx.equipment)) {
    const inventory = effectivePlateInventory(ctx.inventory, ctx.unit);
    const bar = barKgFor(ctx.barKg, inventory, ctx.equipment, ctx.unit);
    return warmupRamp(workingKg, bar, inventory, ctx.unit).map(s => ({ kg: s.kg, reps: s.reps }));
  }
  const out: RampStep[] = [];
  for (const step of [{ fraction: 0.4, reps: 8 }, { fraction: 0.6, reps: 5 }, { fraction: 0.8, reps: 3 }]) {
    const kg = roundLoad(workingKg * step.fraction, ctx);
    if (!(kg > 0) || hundredths(kg, ctx.unit) >= hundredths(workingKg, ctx.unit)) continue;
    if (out.length > 0 && sameLoad(out[out.length - 1].kg, kg, ctx.unit)) continue;
    out.push({ kg, reps: step.reps });
  }
  return out;
}

// ==== proposals ====

/**
 * What a proposal does to the load: `up`, `same`, `down` (RPE), `deload` (a
 * linear scheme after its misses), `percent` (sets read off a training max),
 * or `none` when there is nothing to propose a load from yet and the reason
 * says what's missing.
 */
export type ProposalMove = 'up' | 'same' | 'down' | 'deload' | 'percent' | 'none';

/** One working set as proposed. */
export interface SetProposal {
  kind: WorkoutSetKind;
  weightKg: number;
  reps: number | null;
}

export interface Proposal {
  exerciseId: string;
  scheme: ProgressionScheme;
  move: ProposalMove;
  /** The working sets, in order. Empty for `none`. */
  sets: SetProposal[];
  /** The rep range the headline shows ("6–8"), or a single count. */
  repsMin: number | null;
  repsMax: number | null;
  /** The plain reason, in the unit shown: "Up 2.5 kg because every set last time reached 8." */
  reason: string;
  /** The working weight last time, for a scheme that moves from it. */
  lastKg: number | null;
  /** The training max the sets were read off, for `percent`. */
  trainingMaxKg?: number;
}

export interface ProposalInput {
  exerciseId: string;
  kind: ExerciseKind;
  /** The routine item the exercise is laid out from, for its targets; null for an exercise added mid-session. */
  item: Pick<WorkoutRoutineItem, 'targets' | 'progression'> | null;
  /** From `schemeFor`. Null proposes nothing. */
  scheme: ProgressionScheme | null;
  /** The exercise's sets from any session (`exerciseHistory`). */
  history: readonly WorkoutSet[];
  /** Every session, for which one each set belongs to and how they are ordered. */
  sessions: readonly Pick<WorkoutSession, 'id' | 'startedAt'>[];
  /** The live session, whose own sets aren't history yet. */
  exceptSessionId: string | null;
  load: LoadContext;
  /** The program's training max for this exercise, for `percent`. */
  trainingMaxKg?: number | null;
  /** Where the program is, for a percentage wave. */
  week?: { week: number; weeks: number | null } | null;
}

const isWorkingKind = (k: WorkoutSetKind) => k === 'working' || k === 'amrap';

/** The working targets of an item: warm-ups and drop sets don't count toward a target. */
function workingTargets(item: Pick<WorkoutRoutineItem, 'targets'> | null): RoutineSetTarget[] {
  return (item?.targets ?? []).filter(t => isWorkingKind(t.kind));
}

interface PastSession {
  id: string;
  startedAt: string;
  /** Done working sets, in order. */
  sets: WorkoutSet[];
}

/** Each earlier session that did the exercise, newest first, with its done working sets. */
function pastSessions(input: ProposalInput): PastSession[] {
  const bySession = new Map<string, WorkoutSet[]>();
  for (const s of input.history) {
    if (s.completedAt === null || s.sessionId === input.exceptSessionId || !isWorkingKind(s.kind)) continue;
    if (!bySession.has(s.sessionId)) bySession.set(s.sessionId, []);
    bySession.get(s.sessionId)!.push(s);
  }
  return input.sessions
    .filter(s => bySession.has(s.id))
    .map(s => ({ id: s.id, startedAt: s.startedAt, sets: bySession.get(s.id)!.sort((a, b) => a.setIndex - b.setIndex) }))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** The heaviest weight among a session's working sets; null when none carries one. */
function topWeight(sets: readonly WorkoutSet[]): number | null {
  let top: number | null = null;
  for (const s of sets) if (s.weightKg !== null && s.weightKg > 0 && (top === null || s.weightKg > top)) top = s.weightKg;
  return top;
}

/** "8", "8 and 7", "8, 7 and 6". */
export function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const repsList = (sets: readonly WorkoutSet[]) => joinAnd(sets.map(s => String(s.reps ?? 0)));

/** "2.5 kg", "5 lb": the difference between two loads as the person reads it. */
function deltaText(from: number, to: number, unit: WeightUnit): string {
  const d = Math.abs(weightToDisplay(to, unit) - weightToDisplay(from, unit));
  return `${Number(d.toFixed(2))} ${unit}`;
}

/** The kinds the proposal's sets take: the item's working targets in order, else as many working sets as last time. */
function setKinds(item: ProposalInput['item'], fallbackCount: number): WorkoutSetKind[] {
  const targets = workingTargets(item);
  return targets.length > 0 ? targets.map(t => t.kind) : Array<WorkoutSetKind>(Math.max(1, fallbackCount)).fill('working');
}

/**
 * The next session's working sets for one exercise, with the reason in plain
 * words. Null when there is nothing to go on: no scheme, an exercise that
 * isn't weight and reps, or no earlier session with a weight (a percentage
 * scheme needs a training max instead, and says so when it has none).
 */
export function proposeNext(input: ProposalInput): Proposal | null {
  const { scheme, kind, load } = input;
  if (!scheme || kind !== 'weight_reps') return null;
  const unit = load.unit;
  const targets = workingTargets(input.item);
  const first = targets[0] ?? null;
  const base = { exerciseId: input.exerciseId, scheme };

  if (scheme === 'percent') return proposePercent(input, targets);

  const past = pastSessions(input);
  const last = past[0];
  const lastKg = last ? topWeight(last.sets) : null;
  if (!last || lastKg === null) return null;
  const kinds = setKinds(input.item, last.sets.length);
  const planned = kinds.length;
  const sets = (kg: number, reps: number | null): SetProposal[] => kinds.map(k => ({ kind: k, weightKg: kg, reps }));

  if (scheme === 'double') {
    const min = first?.repsMin ?? first?.repsMax ?? null;
    const max = first?.repsMax ?? first?.repsMin ?? null;
    if (max === null) return null;
    const allTop = last.sets.length >= planned && last.sets.every(s => (s.reps ?? 0) >= max);
    if (allTop) {
      const next = stepUp(lastKg, load);
      return {
        ...base, move: 'up', sets: sets(next, min), repsMin: min, repsMax: max, lastKg,
        reason: `Up ${deltaText(lastKg, next, unit)} because every set last time reached ${max}.`,
      };
    }
    return {
      ...base, move: 'same', sets: sets(lastKg, max), repsMin: min, repsMax: max, lastKg,
      reason: `Same weight. Last time reached ${repsList(last.sets)}, so aim for ${max} on every set before adding weight.`,
    };
  }

  if (scheme === 'linear') {
    const reps = first?.repsMin ?? first?.repsMax ?? null;
    if (reps === null) return null;
    const hit = (p: PastSession) => p.sets.length >= planned && p.sets.every(s => (s.reps ?? 0) >= reps);
    if (hit(last)) {
      const next = stepUp(lastKg, load);
      return {
        ...base, move: 'up', sets: sets(next, reps), repsMin: reps, repsMax: reps, lastKg,
        reason: `Up ${deltaText(lastKg, next, unit)} because every set last time reached ${reps}.`,
      };
    }
    // Short workouts in a row at this same weight: a lighter weight since
    // starts the count again, which is what a deload is for.
    let misses = 0;
    for (const p of past) {
      const top = topWeight(p.sets);
      if (top === null || !sameLoad(top, lastKg, unit) || hit(p)) break;
      misses++;
    }
    if (misses >= LINEAR_DELOAD_AFTER) {
      let next = roundLoad(lastKg * DELOAD_FRACTION, load, 'down');
      if (!(hundredths(next, unit) < hundredths(lastKg, unit))) next = stepDown(lastKg, load);
      return {
        ...base, move: 'deload', sets: sets(next, reps), repsMin: reps, repsMax: reps, lastKg,
        reason: `Down ${deltaText(lastKg, next, unit)}, about 10% lighter, because the last ${misses} workouts at ${formatWeightNumber(lastKg, unit)} ${unit} fell short of ${reps} reps.`,
      };
    }
    return {
      ...base, move: 'same', sets: sets(lastKg, reps), repsMin: reps, repsMax: reps, lastKg,
      reason: `Same weight, because a set last time fell short of ${reps}. After ${LINEAR_DELOAD_AFTER} short workouts in a row, the suggestion is about 10% lighter.`,
    };
  }

  // rpe
  const target = first?.rpe ?? DEFAULT_TARGET_RPE;
  const min = first?.repsMin ?? first?.repsMax ?? null;
  const max = first?.repsMax ?? first?.repsMin ?? null;
  const reps = max ?? min;
  const top = [...last.sets].reverse().reduce<WorkoutSet | null>(
    (best, s) => (s.weightKg !== null && (best === null || s.weightKg > best.weightKg!) ? s : best), null);
  const felt = top?.rpe ?? null;
  if (felt === null) {
    return {
      ...base, move: 'same', sets: sets(lastKg, reps), repsMin: min, repsMax: max, lastKg,
      reason: `Same weight. Rate how hard the top set felt (RPE, 1 to 10) and the next workout suggests a weight from it.`,
    };
  }
  const diff = target - felt;
  if (Math.abs(diff) < 1) {
    return {
      ...base, move: 'same', sets: sets(lastKg, reps), repsMin: min, repsMax: max, lastKg,
      reason: `Same weight, because the top set last time was RPE ${felt}, as planned.`,
    };
  }
  if (diff > 0) {
    let next = roundLoad(lastKg * (1 + RPE_LOAD_PER_POINT * diff), load);
    if (!(hundredths(next, unit) > hundredths(lastKg, unit))) next = stepUp(lastKg, load);
    return {
      ...base, move: 'up', sets: sets(next, reps), repsMin: min, repsMax: max, lastKg,
      reason: `Up ${deltaText(lastKg, next, unit)} because the top set last time was RPE ${felt}, under the ${target} planned.`,
    };
  }
  let next = roundLoad(lastKg * (1 + RPE_LOAD_PER_POINT * diff), load);
  if (!(hundredths(next, unit) < hundredths(lastKg, unit))) next = stepDown(lastKg, load);
  return {
    ...base, move: 'down', sets: sets(next, reps), repsMin: min, repsMax: max, lastKg,
    reason: `Down ${deltaText(lastKg, next, unit)} because the top set last time was RPE ${felt}, over the ${target} planned.`,
  };
}

/**
 * Where a week sits in a percentage wave, in points of the training max
 * against week one: up `WAVE_STEP_POINTS` a week for three weeks, then round
 * again, with the last week of a cycle of four or more weeks lighter
 * (`WAVE_DELOAD_POINTS`). An open-ended program has no wave.
 */
export function waveOffset(week: number, weeks: number | null): number {
  if (weeks === null || weeks <= 1 || week < 1) return 0;
  if (weeks >= 4 && week === weeks) return WAVE_DELOAD_POINTS;
  return ((week - 1) % 3) * WAVE_STEP_POINTS;
}

function proposePercent(input: ProposalInput, targets: RoutineSetTarget[]): Proposal {
  const { load, exerciseId } = input;
  const unit = load.unit;
  const tm = input.trainingMaxKg ?? null;
  const shape = targets.length > 0
    ? targets
    : DEFAULT_WAVE_PERCENTS.map((pct): RoutineSetTarget => ({ kind: 'working', repsMin: 5, repsMax: 5, pctOfTm: pct }));
  const reps0 = shape[0].repsMin ?? shape[0].repsMax ?? null;
  const base = { exerciseId, scheme: 'percent' as const, repsMin: reps0, repsMax: reps0, lastKg: null };
  if (tm === null || !(tm > 0)) {
    return {
      ...base, move: 'none', sets: [],
      reason: 'No training max for this exercise yet. Set one in the program to see the weights.',
    };
  }
  const week = input.week?.week ?? 1;
  const weeks = input.week?.weeks ?? null;
  const offset = waveOffset(week, weeks);
  const pcts = shape.map((t, i) => (t.pctOfTm ?? DEFAULT_WAVE_PERCENTS[Math.min(i, DEFAULT_WAVE_PERCENTS.length - 1)]) + offset);
  const sets = shape.map((t, i): SetProposal => ({
    kind: t.kind,
    weightKg: roundLoad((tm * pcts[i]) / 100, load),
    reps: t.repsMin ?? t.repsMax ?? null,
  }));
  const when = weeks !== null ? `Week ${week} of ${weeks}: ` : '';
  return {
    ...base, move: 'percent', sets, trainingMaxKg: tm,
    reason: `${when}${joinAnd(pcts.map(p => `${p}%`))} of a ${formatWeightNumber(tm, unit)} ${unit} training max.`,
  };
}

// ==== the words on the card ====

/**
 * "Today 3 × 6–8 at 82.5 kg.", "Today 3 × 5 at 65, 75 and 85 kg.": what the
 * proposal asks for, as the card's first line. Null for one with no sets.
 */
export function proposalHeadline(p: Proposal, unit: WeightUnit): string | null {
  if (p.sets.length === 0) return null;
  const reps = p.repsMin !== null && p.repsMax !== null && p.repsMin !== p.repsMax
    ? `${p.repsMin}–${p.repsMax}`
    : p.repsMin ?? p.repsMax;
  const shown = p.sets.map(s => formatWeightNumber(s.weightKg, unit));
  const weights = shown.every(w => w === shown[0]) ? shown[0] : joinAnd(shown);
  return reps === null
    ? `Today ${p.sets.length} ${p.sets.length === 1 ? 'set' : 'sets'} at ${weights} ${unit}.`
    : `Today ${p.sets.length} × ${reps} at ${weights} ${unit}.`;
}

/** "Use 82.5 kg", or "Use these weights" for sets at different loads. */
export function proposalActionLabel(p: Proposal, unit: WeightUnit): string {
  const shown = p.sets.map(s => formatWeightNumber(s.weightKg, unit));
  return shown.length > 0 && shown.every(w => w === shown[0]) ? `Use ${shown[0]} ${unit}` : 'Use these weights';
}

// ==== applying it, on the person's tap ====

/** A set's edit as `editSet` takes it. */
export interface SetEdit {
  setId: string;
  weightKg: number;
  reps: number | null;
}

const isPlannedWorking = (s: WorkoutSet) => s.completedAt === null && isWorkingKind(s.kind);
const isPlannedWarmup = (s: WorkoutSet) => s.completedAt === null && s.kind === 'warmup';

/** Whether a working set of this exercise has been logged in the session: the proposal is then shown, not offered. */
export function workingSetLogged(exerciseSets: readonly WorkoutSet[]): boolean {
  return exerciseSets.some(s => s.completedAt !== null && isWorkingKind(s.kind));
}

/**
 * The edits "Use 82.5 kg" makes: the proposal's weights and reps on the
 * planned working sets, in order, and, when the item warms up with a ramp, the
 * planned warm-ups worked out again from the new working weight. Done sets are
 * never touched, and a set the proposal has no counterpart for is left alone.
 */
export function proposalEdits(
  exerciseSets: readonly WorkoutSet[],
  p: Proposal,
  ramp: readonly RampStep[] | null = null,
): SetEdit[] {
  const out: SetEdit[] = [];
  exerciseSets.filter(isPlannedWorking).forEach((s, i) => {
    const want = p.sets[i];
    if (want) out.push({ setId: s.id, weightKg: want.weightKg, reps: want.reps });
  });
  if (ramp) {
    exerciseSets.filter(isPlannedWarmup).forEach((s, i) => {
      const step = ramp[i];
      if (step) out.push({ setId: s.id, weightKg: step.kg, reps: step.reps });
    });
  }
  return out;
}

/** Whether the planned working sets already ask for what the proposal does: nothing to offer then. */
export function proposalApplied(exerciseSets: readonly WorkoutSet[], p: Proposal, unit: WeightUnit): boolean {
  const planned = exerciseSets.filter(isPlannedWorking);
  if (planned.length === 0 || p.sets.length === 0) return true;
  return planned.every((s, i) => {
    const want = p.sets[i];
    if (!want) return true;
    return s.weightKg !== null && sameLoad(s.weightKg, want.weightKg, unit) && (want.reps === null || s.reps === want.reps);
  });
}

// ==== training maxes ====

export interface TrainingMaxRaise {
  exerciseId: string;
  fromKg: number;
  toKg: number;
}

/**
 * What a percentage program's training maxes would be for the next cycle: each
 * raised by a step, twice as much for a lower-body lift (one whose primary
 * muscles include the quads, hamstrings or glutes), the usual split. A
 * proposal, written only when the person starts the next cycle with it.
 */
export function trainingMaxRaises(
  program: Pick<WorkoutProgram, 'trainingMaxes'>,
  primaryMusclesOf: (exerciseId: string) => readonly MuscleGroup[],
  unit: WeightUnit,
): TrainingMaxRaise[] {
  return program.trainingMaxes.map(t => {
    const lower = primaryMusclesOf(t.exerciseId).some(m => LOWER_BODY.includes(m));
    const step = TM_RAISE_KG[unit][lower ? 'lower' : 'upper'];
    return { exerciseId: t.exerciseId, fromKg: t.kg, toKg: Number((t.kg + step).toFixed(3)) };
  });
}

/**
 * A training max to start from, proposed from the best estimated 1RM: 90% of
 * it, rounded down to a step of the unit (2.5 kg or 5 lb). Null without one.
 */
export function suggestedTrainingMaxKg(bestE1rmKg: number | null, unit: WeightUnit): number | null {
  if (bestE1rmKg === null || !(bestE1rmKg > 0)) return null;
  const step = unit === 'kg' ? 2.5 : 5;
  const shown = Math.floor((kgToUnit(bestE1rmKg * TRAINING_MAX_FRACTION, unit) + 1e-9) / step) * step;
  return shown > 0 ? weightFromDisplay(shown, unit) : null;
}
