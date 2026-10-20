import type { Exercise, ExerciseEquipment, Gym, GymExerciseSetting, WorkoutRoutine, WorkoutSet } from '../types';
import { buildCatalog } from './exerciseCatalog';
import { distanceMeters, PLACE_MAX_FIX_ERROR_M, type PlaceFix } from './moodPlaces';
import { EQUIPMENT_LABELS, formatWeightWithUnit } from './workoutData';
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
  return ALWAYS_AVAILABLE.includes(equipment) || gym.equipment.includes(equipment);
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

/** "Fits this gym.", "Fits this gym except 1 exercise.", or "Missing: trap bar". */
export function describeRoutineFit(fit: RoutineFit): string {
  if (fit.blocked === 0) return 'Fits this gym.';
  if (fit.blocked < fit.total) {
    return `Fits this gym except ${fit.blocked} ${fit.blocked === 1 ? 'exercise' : 'exercises'}.`;
  }
  return `Missing: ${fit.missing.map(m => EQUIPMENT_LABELS[m].toLowerCase()).join(', ')}`;
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
    .filter(e => !e.archived && !skip.has(e.id) && e.kind === from.kind && equipmentAvailable(gym, e.equipment))
    .map(e => ({ e, shared: e.primaryMuscles.filter(m => from.primaryMuscles.includes(m)).length }))
    .filter(x => x.shared > 0)
    .sort((a, b) =>
      b.shared - a.shared
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

/** A setting that says nothing, which is deleted rather than kept. */
export function isEmptyGymSetting(s: Pick<GymExerciseSetting, 'notes' | 'barKg'>): boolean {
  return s.notes.trim() === '' && s.barKg === null;
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
