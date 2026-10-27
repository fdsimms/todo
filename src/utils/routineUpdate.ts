import type { ExerciseKind, RoutineSetTarget, WorkoutRoutineItem, WorkoutSet } from '../types';
import type { WeightUnit } from './weightLog';
import { normalizeSupersets } from './workoutRoutine';
import { formatRestSeconds, formatWeightWithUnit } from './workoutData';
import { sessionExercises, setFieldsFor } from './workoutSession';

/**
 * What a finished workout changed from the routine it was started from, as a
 * list of changes the person accepts one at a time ("Update Push A?").
 *
 * **The app proposes and the person confirms** (docs/arch/workouts.md): a
 * routine is never edited because a workout went differently, so every change
 * here starts unaccepted and the routine is written only with the ones ticked.
 * Nothing is stored: the diff is read off the routine and the session's done
 * sets when the summary is open, so a stale one can't outlive either.
 *
 * Only what the person did counts. A set never ticked is dropped by finishing
 * and says nothing about the plan, warm-ups are left out because a ramp is
 * laid out from the working weight and would show up on every workout, and
 * a rest is offered only when the person set it on the exercise during the workout (`restOverrides`), never read off the timers. Each change carries what it needs to be
 * applied, so accepting one never depends on another being accepted.
 */

export type RoutineChange =
  | { kind: 'weight'; id: string; exerciseId: string; from: number; to: number; weights: (number | null)[] }
  | { kind: 'reps'; id: string; exerciseId: string; from: RepRange; to: RepRange }
  | { kind: 'sets'; id: string; exerciseId: string; from: number; to: number; added: RoutineSetTarget[] }
  | { kind: 'rest'; id: string; exerciseId: string; from: number; to: number }
  | { kind: 'swap'; id: string; fromExerciseId: string; toExerciseId: string; targets: RoutineSetTarget[] }
  | { kind: 'add'; id: string; exerciseId: string; afterExerciseId: string | null; targets: RoutineSetTarget[] }
  | { kind: 'remove'; id: string; exerciseId: string }
  | { kind: 'order'; id: string; exerciseIds: string[] };

export interface RepRange { min: number; max: number }

export interface RoutineDiffInput {
  items: readonly WorkoutRoutineItem[];
  /** The session's sets; only the done ones are read. */
  sets: readonly WorkoutSet[];
  kindOf: (exerciseId: string) => ExerciseKind;
  /**
   * The working weight progression proposed for the exercise, when it did.
   * A load the person took from the proposal is the plan working as intended,
   * so it is not offered back as a change.
   */
  suggestedKg?: (exerciseId: string) => number | null;
  /** Rests the person set on exercises in this workout (`WorkoutSession.restOverrides`). */
  restOverrides?: Readonly<Record<string, number>> | null;
  /** What an item with no rest of its own uses, so a rest equal to it isn't offered as a change. */
  defaultRestSeconds?: number;
}

const isWork = (kind: string) => kind !== 'warmup';
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
const bySetIndex = (a: WorkoutSet, b: WorkoutSet) => a.setIndex - b.setIndex;

function targetFromSet(s: WorkoutSet): RoutineSetTarget {
  return {
    kind: s.kind,
    repsMin: s.reps,
    repsMax: s.reps,
    ...(s.weightKg !== null ? { weightKg: s.weightKg } : {}),
    ...(s.durationSeconds !== null ? { durationSeconds: s.durationSeconds } : {}),
    ...(s.distanceM !== null ? { distanceM: s.distanceM } : {}),
  };
}

export function routineChanges(input: RoutineDiffInput): RoutineChange[] {
  const { items, kindOf, suggestedKg } = input;
  const done = input.sets.filter(s => s.completedAt !== null);
  const session = sessionExercises(done);
  const inRoutine = new Set(items.map(i => i.exerciseId));
  const inSession = new Set(session.map(e => e.exerciseId));
  const out: RoutineChange[] = [];

  // Swaps, adds and removes: an exercise the workout has that the routine
  // lacks takes the place of the one the routine has that the workout lacks
  // when they sit in the same slot, which is where a swap leaves it.
  const usedItems = new Set<string>();
  const swapped = new Set<string>();
  session.forEach((e, j) => {
    if (inRoutine.has(e.exerciseId)) return;
    const slot = items[j];
    if (slot && !inSession.has(slot.exerciseId) && !usedItems.has(slot.exerciseId)) {
      usedItems.add(slot.exerciseId);
      swapped.add(e.exerciseId);
      out.push({ kind: 'swap', id: `swap:${slot.exerciseId}`, fromExerciseId: slot.exerciseId, toExerciseId: e.exerciseId, targets: e.sets.map(targetFromSet) });
    }
  });
  session.forEach((e, j) => {
    if (inRoutine.has(e.exerciseId) || swapped.has(e.exerciseId)) return;
    out.push({ kind: 'add', id: `add:${e.exerciseId}`, exerciseId: e.exerciseId, afterExerciseId: session[j - 1]?.exerciseId ?? null, targets: e.sets.map(targetFromSet) });
  });
  for (const item of items) {
    if (!inSession.has(item.exerciseId) && !usedItems.has(item.exerciseId)) {
      out.push({ kind: 'remove', id: `remove:${item.exerciseId}`, exerciseId: item.exerciseId });
    }
  }

  // Exercises in both: the sets, then what was lifted.
  for (const item of items) {
    const ex = session.find(e => e.exerciseId === item.exerciseId);
    if (!ex) continue;
    const work = ex.sets.filter(s => isWork(s.kind)).sort(bySetIndex);
    const targets = item.targets.filter(t => isWork(t.kind));
    if (work.length === 0 || targets.length === 0) continue;
    const id = item.exerciseId;
    const fields = setFieldsFor(kindOf(id));
    const paired = Math.min(work.length, targets.length);

    if (work.length !== targets.length) {
      out.push({ kind: 'sets', id: `sets:${id}`, exerciseId: id, from: targets.length, to: work.length, added: work.slice(targets.length).map(targetFromSet) });
    }

    if (fields.includes('weight')) {
      const weights: (number | null)[] = [];
      const froms: number[] = [];
      const tos: number[] = [];
      for (let i = 0; i < paired; i++) {
        const was = targets[i].weightKg ?? null;
        const now = work[i].weightKg;
        if (was !== null && now !== null && !near(was, now)) {
          weights.push(now); froms.push(was); tos.push(now);
        } else weights.push(null);
      }
      if (tos.length > 0) {
        const to = Math.max(...tos);
        const suggested = suggestedKg?.(id) ?? null;
        if (suggested === null || !near(suggested, to)) {
          out.push({ kind: 'weight', id: `weight:${id}`, exerciseId: id, from: Math.max(...froms), to, weights });
        }
      }
    }

    if (fields.includes('reps')) {
      let below = 0;
      let above = 0;
      let ranged = 0;
      let fromMin = Infinity;
      let fromMax = -Infinity;
      for (let i = 0; i < paired; i++) {
        const { repsMin, repsMax } = targets[i];
        const reps = work[i].reps;
        if (reps === null || (repsMin === null && repsMax === null)) continue;
        ranged++;
        fromMin = Math.min(fromMin, repsMin ?? repsMax!);
        fromMax = Math.max(fromMax, repsMax ?? repsMin!);
        if (repsMin !== null && reps < repsMin) below++;
        else if (repsMax !== null && reps > repsMax) above++;
      }
      // Every set missing the range the same way is a different plan; one
      // short set is just a hard set.
      if (ranged > 0 && (below === ranged || above === ranged)) {
        const reps = work.map(s => s.reps).filter((r): r is number => r !== null);
        out.push({
          kind: 'reps', id: `reps:${id}`, exerciseId: id,
          from: { min: fromMin, max: fromMax },
          to: { min: Math.min(...reps), max: Math.max(...reps) },
        });
      }
    }
  }

  // Rest: only one set on the exercise in this workout, and only for an
  // exercise the workout actually did. One that matches the routine says nothing.
  for (const item of items) {
    const to = input.restOverrides?.[item.exerciseId];
    if (to === undefined || !inSession.has(item.exerciseId)) continue;
    const from = item.restSeconds ?? input.defaultRestSeconds ?? 0;
    if (to !== from) out.push({ kind: 'rest', id: `rest:${item.exerciseId}`, exerciseId: item.exerciseId, from, to });
  }

  // Order: one change for the whole running order of what both have.
  const routineOrder = items.map(i => i.exerciseId).filter(x => inSession.has(x));
  const sessionOrder = session.map(e => e.exerciseId).filter(x => inRoutine.has(x));
  if (routineOrder.some((x, i) => x !== sessionOrder[i])) {
    out.push({ kind: 'order', id: 'order', exerciseIds: sessionOrder });
  }
  return out;
}

/** The items with the accepted changes written in. Each change stands alone. */
export function applyRoutineChanges(
  items: readonly WorkoutRoutineItem[],
  changes: readonly RoutineChange[],
  maxSets = 12,
): WorkoutRoutineItem[] {
  let next = items.map(i => ({ ...i, targets: [...i.targets] }));
  const edit = (exerciseId: string, fn: (item: WorkoutRoutineItem) => WorkoutRoutineItem) => {
    next = next.map(i => (i.exerciseId === exerciseId ? fn(i) : i));
  };
  const rank = { swap: 0, sets: 1, weight: 2, reps: 3, rest: 4, add: 5, remove: 6, order: 7 } as const;
  for (const c of [...changes].sort((a, b) => rank[a.kind] - rank[b.kind])) {
    switch (c.kind) {
      case 'swap':
        edit(c.fromExerciseId, i => ({
          ...i,
          exerciseId: c.toExerciseId,
          targets: i.warmupRamp ? c.targets.filter(t => isWork(t.kind)) : c.targets,
        }));
        break;
      case 'sets':
        edit(c.exerciseId, i => {
          const work = i.targets.filter(t => isWork(t.kind));
          if (c.to > work.length) {
            const room = Math.max(0, maxSets - work.length);
            return { ...i, targets: [...i.targets, ...c.added.slice(0, room)] };
          }
          let drop = work.length - c.to;
          const targets = [...i.targets];
          for (let k = targets.length - 1; k >= 0 && drop > 0; k--) {
            if (isWork(targets[k].kind)) { targets.splice(k, 1); drop--; }
          }
          return { ...i, targets };
        });
        break;
      case 'weight':
        edit(c.exerciseId, i => {
          let w = -1;
          return {
            ...i,
            targets: i.targets.map(t => {
              if (!isWork(t.kind)) return t;
              const kg = c.weights[++w];
              return kg === null || kg === undefined ? t : { ...t, weightKg: kg };
            }),
          };
        });
        break;
      case 'reps':
        edit(c.exerciseId, i => ({
          ...i,
          targets: i.targets.map(t => (isWork(t.kind) ? { ...t, repsMin: c.to.min, repsMax: c.to.max } : t)),
        }));
        break;
      case 'rest':
        edit(c.exerciseId, i => ({ ...i, restSeconds: c.to }));
        break;
      case 'add': {
        const item: WorkoutRoutineItem = { exerciseId: c.exerciseId, supersetKey: null, restSeconds: null, progression: null, targets: c.targets };
        const at = c.afterExerciseId === null ? 0 : next.findIndex(i => i.exerciseId === c.afterExerciseId) + 1;
        next = at === 0 && c.afterExerciseId !== null ? [...next, item] : [...next.slice(0, at), item, ...next.slice(at)];
        break;
      }
      case 'remove':
        next = next.filter(i => i.exerciseId !== c.exerciseId);
        break;
      case 'order': {
        const byId = new Map(next.map(i => [i.exerciseId, i]));
        const slots = next.map((i, k) => (c.exerciseIds.includes(i.exerciseId) ? k : -1)).filter(k => k >= 0);
        const ordered = c.exerciseIds.map(id => byId.get(id)).filter((i): i is WorkoutRoutineItem => !!i);
        if (ordered.length === slots.length) {
          const placed = [...next];
          slots.forEach((slot, k) => { placed[slot] = ordered[k]; });
          next = placed;
        }
        break;
      }
    }
  }
  return normalizeSupersets(next);
}

// ==== words ====

const reps = (r: RepRange) => (r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`);
const restWords = (seconds: number) => (seconds === 0 ? 'no rest' : formatRestSeconds(seconds));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A change as a row of the "Update routine?" card: what it is, and what it goes from and to. */
export function describeRoutineChange(
  c: RoutineChange,
  nameOf: (exerciseId: string) => string,
  unit: WeightUnit,
): { title: string; detail: string } {
  switch (c.kind) {
    case 'weight':
      return {
        title: `${nameOf(c.exerciseId)}: ${c.to < c.from ? 'lighter' : c.to > c.from ? 'heavier' : 'new weight'}`,
        detail: `From ${formatWeightWithUnit(c.from, unit)} to ${formatWeightWithUnit(c.to, unit)} on the working sets.`,
      };
    case 'reps':
      return {
        title: `${nameOf(c.exerciseId)}: rep range`,
        detail: `From ${reps(c.from)} reps to ${reps(c.to)} reps.`,
      };
    case 'sets': {
      const diff = Math.abs(c.to - c.from);
      return {
        title: `${nameOf(c.exerciseId)}: ${c.to > c.from ? 'add' : 'remove'} ${diff === 1 ? 'a set' : `${diff} sets`}`,
        detail: `From ${plural(c.from, 'set', 'sets')} to ${plural(c.to, 'set', 'sets')}.`,
      };
    }
    case 'rest':
      return {
        title: `${nameOf(c.exerciseId)}: rest time`,
        detail: `From ${restWords(c.from)} to ${restWords(c.to)} between sets.`,
      };
    case 'swap':
      return { title: `Swap ${nameOf(c.fromExerciseId)} for ${nameOf(c.toExerciseId)}`, detail: 'Same place in the routine.' };
    case 'add': {
      const work = c.targets.filter(t => isWork(t.kind));
      const first = work[0];
      const parts = [plural(work.length, 'set', 'sets')];
      if (first?.repsMax) parts[0] += ` of ${first.repsMax}`;
      if (first?.weightKg) parts.push(`at ${formatWeightWithUnit(first.weightKg, unit)}`);
      const where = c.afterExerciseId ? `after ${nameOf(c.afterExerciseId)}` : 'first';
      return { title: `Add ${nameOf(c.exerciseId)}`, detail: `${parts.join(' ')}, ${where}.` };
    }
    case 'remove':
      return { title: `Remove ${nameOf(c.exerciseId)}`, detail: 'No sets were logged for it this time.' };
    case 'order':
      return { title: 'Change the order', detail: `New order: ${c.exerciseIds.map(nameOf).join(', ')}.` };
  }
}
