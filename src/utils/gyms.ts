import type { Exercise, ExerciseEquipment, Gym, GymExerciseSetting, WorkoutRoutine, WorkoutSet } from '../types';
import { buildCatalog } from './exerciseCatalog';
import { distanceMeters, PLACE_MAX_FIX_ERROR_M, type PlaceFix } from './moodPlaces';
import { swapKindsMatch } from './exerciseSwap';
import { EQUIPMENT_LABELS, formatWeightWithUnit, machineParent } from './workoutData';
import type { WeightUnit } from './weightLog';

/**
 * Gyms: which equipment a place has, what differs about an exercise there, and
 * which gym a position is at. Pure; the position is read in `gymLocation.ts`,
 * and the swap itself is `swapSessionExercise` (see docs/arch/workouts.md,
 * "Gyms").
 *
 * **Not knowing is never "can't".** A gym with no equipment ticked yet, an
 * exercise filed under `other`, and bodyweight work are all treated as
 * available: the app only flags an exercise when it has been told the gym lacks
 * what it needs, since a wrong "not at this gym" is a workout rearranged on the
 * strength of a guess.
 */

/** A gym's default catch radius, and the bounds the editor's stepper keeps to. */
export const GYM_DEFAULT_RADIUS_M = 150;
export const GYM_MIN_RADIUS_M = 50;
export const GYM_MAX_RADIUS_M = 500;
export const GYM_RADIUS_STEP_M = 50;

/** Equipment that never needs a gym to have it. */
const ALWAYS_AVAILABLE: readonly ExerciseEquipment[] = ['bodyweight', 'other'];

/** The id of the (gym, exercise) row: the pair is the key, so two devices writing one meet on it. */
export function gymExerciseId(gymId: string, exerciseId: string): string {
  return `${gymId}|${exerciseId}`;
}

/** Whether `gym` has what `equipment` needs. No gym chosen, or no equipment told yet, means yes. */
export function equipmentAvailable(gym: Pick<Gym, 'equipment'> | null | undefined, equipment: ExerciseEquipment): boolean {
  if (!gym || gym.equipment.length === 0) return true;
  if (ALWAYS_AVAILABLE.includes(equipment) || gym.equipment.includes(equipment)) return true;
  // "Machine" ticked before the specific machines existed meant every one of them.
  const parent = machineParent(equipment);
  return parent !== null && gym.equipment.includes(parent);
}

/** The ids among `exerciseIds` that `gym` can't do, in the order given. */
export function unavailableExerciseIds(
  gym: Pick<Gym, 'equipment'> | null | undefined,
  rows: readonly Exercise[],
  exerciseIds: readonly string[],
): string[] {
  if (!gym || gym.equipment.length === 0) return [];
  const catalog = buildCatalog(rows);
  return exerciseIds.filter(id => {
    const e = catalog.find(c => c.id === id);
    return !!e && !equipmentAvailable(gym, e.equipment);
  });
}

export interface RoutineFit {
  total: number;
  /** Exercises the gym can't do. */
  blocked: number;
  /** The equipment those need, each once, in the order met. */
  missing: ExerciseEquipment[];
}

/** How well a routine fits a gym: what it needs that the gym lacks. */
export function routineFit(
  gym: Pick<Gym, 'equipment'> | null | undefined,
  routine: Pick<WorkoutRoutine, 'items'>,
  rows: readonly Exercise[],
): RoutineFit {
  const catalog = buildCatalog(rows);
  const missing: ExerciseEquipment[] = [];
  let blocked = 0;
  for (const item of routine.items) {
    const e = catalog.find(c => c.id === item.exerciseId);
    if (!e || equipmentAvailable(gym, e.equipment)) continue;
    blocked++;
    if (!missing.includes(e.equipment)) missing.push(e.equipment);
  }
  return { total: routine.items.length, blocked, missing };
}

/**
 * "At Planet Fitness, 1 of 6 exercises needs a trap bar.", or null when the
 * gym can do all of it (a line that says everything is fine is noise on a list).
 */
export function describeRoutineFit(fit: RoutineFit, gymName: string): string | null {
  if (fit.blocked === 0) return null;
  const needs = fit.missing.map(m => EQUIPMENT_LABELS[m].toLowerCase()).join(', ');
  return `At ${gymName}, ${fit.blocked} of ${fit.total} ${fit.total === 1 ? 'exercise needs' : 'exercises need'} ${needs}.`;
}

/**
 * Exercises to offer in place of `exerciseId` at `gym`, best first: the same
 * kind of movement sharing a primary muscle, on equipment the gym has. More
 * shared muscles first, then one the person has done at this gym before
 * (`doneHere`, so a last weight exists that suits the machines there), then the
 * name. Archived exercises and anything in `exceptIds` (what the workout
 * already has) are left out.
 */
export function gymSwapCandidates(
  rows: readonly Exercise[],
  exerciseId: string,
  gym: Pick<Gym, 'equipment'> | null | undefined,
  exceptIds: readonly string[] = [],
  doneHere: ReadonlySet<string> = new Set(),
): string[] {
  const catalog = buildCatalog(rows);
  const from = catalog.find(e => e.id === exerciseId);
  if (!from) return [];
  const skip = new Set([exerciseId, ...exceptIds]);
  return catalog
    .filter(e => !e.archived && !skip.has(e.id) && swapKindsMatch(e.kind, from.kind) && equipmentAvailable(gym, e.equipment))
    .map(e => ({ e, shared: e.primaryMuscles.filter(m => from.primaryMuscles.includes(m)).length }))
    .filter(x => x.shared > 0)
    .sort((a, b) =>
      b.shared - a.shared
      || Number(b.e.kind === from.kind) - Number(a.e.kind === from.kind)
      || Number(doneHere.has(b.e.id)) - Number(doneHere.has(a.e.id))
      || a.e.name.localeCompare(b.e.name))
    .map(x => x.e.id);
}

/** The gym's pin, when it has one. */
function pinOf(gym: Gym): { latitude: number; longitude: number } | null {
  return gym.latitude !== null && gym.longitude !== null ? { latitude: gym.latitude, longitude: gym.longitude } : null;
}

/**
 * The nearest gym the fix is inside, or null. **A fix that can't tell is no
 * answer** (the rule `placeAt` keeps for the mood log): a position with no
 * reported accuracy, or a coarse one, matches nothing, and being somewhere that
 * isn't a gym says nothing either. Archived gyms and gyms with no pin never match.
 */
export function gymAt(gyms: readonly Gym[], fix: PlaceFix | null): Gym | null {
  if (!fix || fix.accuracyM === null || !Number.isFinite(fix.accuracyM) || fix.accuracyM > PLACE_MAX_FIX_ERROR_M) {
    return null;
  }
  let best: Gym | null = null;
  let bestDistance = Infinity;
  for (const gym of gyms) {
    const pin = gym.archived ? null : pinOf(gym);
    if (!pin) continue;
    const d = distanceMeters(fix, pin);
    if (d <= gym.radiusM && d < bestDistance) {
      best = gym;
      bestDistance = d;
    }
  }
  return best;
}

/** The setting for one exercise at one gym, or null. */
export function gymSettingFor(
  settings: readonly GymExerciseSetting[],
  gymId: string | null | undefined,
  exerciseId: string,
): GymExerciseSetting | null {
  if (!gymId) return null;
  const id = gymExerciseId(gymId, exerciseId);
  return settings.find(s => s.id === id) ?? null;
}

/** The exercise as this gym has it: its bar, where the gym says otherwise. Everything that reads `barKg` goes through this. */
export function withGymBar<T extends { barKg: number | null }>(info: T, setting: Pick<GymExerciseSetting, 'barKg'> | null): T {
  return setting?.barKg ? { ...info, barKg: setting.barKg } : info;
}

/**
 * The load step at this gym, where it names one. It outranks the step a
 * routine's progression chose: that is how much the person wants to add, and
 * this is what the machines there can add.
 */
export function gymIncrementKg(setting: Pick<GymExerciseSetting, 'incrementKg'> | null): number | null {
  return setting?.incrementKg && setting.incrementKg > 0 ? setting.incrementKg : null;
}

/** A setting that says nothing, which is deleted rather than kept. */
export function isEmptyGymSetting(s: Pick<GymExerciseSetting, 'notes' | 'barKg' | 'incrementKg'>): boolean {
  return s.notes.trim() === '' && s.barKg === null && s.incrementKg === null;
}

/** The exercises done at `gymId` in finished-or-live sessions, from the sets' own sessions. */
export function exerciseIdsDoneAt(
  gymId: string | null | undefined,
  sessions: readonly { id: string; gymId?: string | null }[],
  sets: readonly { sessionId: string; exerciseId: string; completedAt: string | null }[],
): Set<string> {
  const out = new Set<string>();
  if (!gymId) return out;
  const here = new Set(sessions.filter(s => s.gymId === gymId).map(s => s.id));
  for (const set of sets) if (set.completedAt !== null && here.has(set.sessionId)) out.add(set.exerciseId);
  return out;
}

/**
 * The gym of the newest session that had one, if it is still there and not
 * archived: where a workout starts when no position says otherwise.
 */
export function lastUsedGymId(
  gyms: readonly Pick<Gym, 'id' | 'archived'>[],
  sessions: readonly { gymId?: string | null; startedAt: string }[],
): string | null {
  const live = new Set(gyms.filter(g => !g.archived).map(g => g.id));
  let best: { id: string; at: string } | null = null;
  for (const s of sessions) {
    if (s.gymId && live.has(s.gymId) && (!best || s.startedAt > best.at)) best = { id: s.gymId, at: s.startedAt };
  }
  return best?.id ?? null;
}

/**
 * The gym a workout starts at before any position is known: the one the person
 * chose as their default if it is still there and not archived, else the gym
 * last used. A default that was deleted or archived reads as none, so the
 * setting never has to be cleaned up behind a gym.
 */
export function startingGymId(
  defaultId: string | null | undefined,
  gyms: readonly Pick<Gym, 'id' | 'archived'>[],
  sessions: readonly { gymId?: string | null; startedAt: string }[],
): string | null {
  if (defaultId && gyms.some(g => g.id === defaultId && !g.archived)) return defaultId;
  return lastUsedGymId(gyms, sessions);
}

/**
 * "last 100 kg × 5": the heaviest working set of last time, for the notice that
 * proposes a replacement. Null when last time has no set with both a load and
 * reps (a first time, or an exercise that isn't weight and reps).
 */
export function describeLastLoad(
  previous: readonly Pick<WorkoutSet, 'kind' | 'weightKg' | 'reps'>[],
  unit: WeightUnit,
): string | null {
  let best: { weightKg: number; reps: number } | null = null;
  for (const s of previous) {
    if (s.kind === 'warmup' || !s.weightKg || !s.reps) continue;
    if (!best || s.weightKg > best.weightKg) best = { weightKg: s.weightKg, reps: s.reps };
  }
  return best ? `last ${formatWeightWithUnit(best.weightKg, unit)} × ${best.reps}` : null;
}

/** The sets done in sessions at `gymId`; every set when it is null. */
export function setsAtGym<T extends { sessionId: string }>(
  sets: readonly T[],
  sessions: readonly { id: string; gymId?: string | null }[],
  gymId: string | null,
): T[] {
  if (gymId === null) return [...sets];
  const here = new Set(sessions.filter(s => s.gymId === gymId).map(s => s.id));
  return sets.filter(s => here.has(s.sessionId));
}

/** The gyms any of these sets were done at, in the order the gyms are listed. */
export function gymsUsedBy(
  sets: readonly { sessionId: string }[],
  sessions: readonly { id: string; gymId?: string | null }[],
  gyms: readonly Gym[],
): Gym[] {
  const gymOf = new Map(sessions.map(s => [s.id, s.gymId ?? null]));
  const used = new Set(sets.map(s => gymOf.get(s.sessionId)).filter((id): id is string => !!id));
  return gyms.filter(g => used.has(g.id));
}

/** "Seat 4 · bar 15 kg · step 2 kg": what is kept for an exercise at a gym, or null when nothing is. */
export function describeGymSetting(
  setting: Pick<GymExerciseSetting, 'notes' | 'barKg' | 'incrementKg'> | null,
  unit: WeightUnit,
): string | null {
  if (!setting) return null;
  const parts: string[] = [];
  const note = setting.notes.trim().split('\n')[0];
  if (note) parts.push(note);
  if (setting.barKg) parts.push(`bar ${formatWeightWithUnit(setting.barKg, unit)}`);
  if (setting.incrementKg) parts.push(`step ${formatWeightWithUnit(setting.incrementKg, unit)}`);
  return parts.length ? parts.join(' · ') : null;
}
