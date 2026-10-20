import { create } from 'zustand';
import type { ExerciseEquipment, Gym, GymExerciseSetting } from '../types';
import {
  dbDeleteGym, dbDeleteGymExercise, dbGetAllGymExercises, dbGetAllGyms, dbSaveGym, dbSaveGymExercise,
} from '../db/database';
import { generateId } from '../utils/id';
import { EXERCISE_EQUIPMENT, cleanWorkoutName } from '../utils/workoutData';
import {
  GYM_DEFAULT_RADIUS_M, GYM_MAX_RADIUS_M, GYM_MIN_RADIUS_M, gymExerciseId, isEmptyGymSetting,
} from '../utils/gyms';

/**
 * The places the person trains, and what differs about an exercise at each
 * (docs/arch/workouts.md, "Gyms"). Rules are in `utils/gyms.ts`; this is the
 * writes. Plans rather than the health record, so they sync like routines, and
 * loaded whole: a handful of gyms, a few notes each.
 */

export type GymRefusal = 'blank' | 'taken' | 'notFound';

export interface GymInput {
  name: string;
  equipment: readonly ExerciseEquipment[];
  placeText?: string;
  latitude?: number | null;
  longitude?: number | null;
  radiusM?: number;
}

export type GymPatch = Partial<GymInput> & { archived?: boolean };

export interface GymExercisePatch {
  notes?: string;
  barKg?: number | null;
  incrementKg?: number | null;
}

interface GymStore {
  gyms: Gym[];
  settings: GymExerciseSetting[];
  initialized: boolean;
  initialize: () => void;
  /** Gyms that aren't archived, in the person's order. */
  activeGyms: () => Gym[];
  addGym: (input: GymInput) => Gym | GymRefusal;
  /** Refuses a blank name or one another gym has. A pin is both coordinates or neither. */
  updateGym: (id: string, patch: GymPatch) => Gym | GymRefusal;
  /** Deletes the gym and its notes. Past sessions keep their id, which then reads as no gym. */
  deleteGym: (id: string) => void;
  /** Writes one exercise's note, bar or load step at a gym; a patch leaving all three empty deletes the row. */
  setGymExercise: (gymId: string, exerciseId: string, patch: GymExercisePatch) => GymExerciseSetting | null;
}

const nameKey = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();

function equipmentOf(list: readonly ExerciseEquipment[]): ExerciseEquipment[] {
  return EXERCISE_EQUIPMENT.filter(e => list.includes(e));
}

function radiusOf(raw: number | undefined, fallback: number): number {
  if (raw === undefined || !Number.isFinite(raw)) return fallback;
  return Math.min(GYM_MAX_RADIUS_M, Math.max(GYM_MIN_RADIUS_M, Math.round(raw)));
}

/** A pin is a pair: half of one is no pin. */
function pinOf(lat: number | null | undefined, lon: number | null | undefined): [number | null, number | null] {
  const ok = typeof lat === 'number' && typeof lon === 'number'
    && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  return ok ? [lat as number, lon as number] : [null, null];
}

export const useGymStore = create<GymStore>((set, get) => ({
  gyms: [],
  settings: [],
  initialized: false,

  initialize() {
    set({ gyms: dbGetAllGyms(), settings: dbGetAllGymExercises(), initialized: true });
  },

  activeGyms() {
    return get().gyms.filter(g => !g.archived);
  },

  addGym(input) {
    const name = cleanWorkoutName(input.name);
    if (!name) return 'blank';
    if (get().gyms.some(g => nameKey(g.name) === nameKey(name))) return 'taken';
    const [latitude, longitude] = pinOf(input.latitude, input.longitude);
    const gym: Gym = {
      id: generateId(),
      name,
      equipment: equipmentOf(input.equipment),
      placeText: (input.placeText ?? '').trim(),
      latitude,
      longitude,
      radiusM: radiusOf(input.radiusM, GYM_DEFAULT_RADIUS_M),
      sortOrder: get().gyms.reduce((max, g) => Math.max(max, g.sortOrder), 0) + 1,
      archived: false,
      createdAt: new Date().toISOString(),
    };
    dbSaveGym(gym);
    set({ gyms: [...get().gyms, gym] });
    return gym;
  },

  updateGym(id, patch) {
    const existing = get().gyms.find(g => g.id === id);
    if (!existing) return 'notFound';
    let name = existing.name;
    if (patch.name !== undefined) {
      name = cleanWorkoutName(patch.name);
      if (!name) return 'blank';
      if (get().gyms.some(g => g.id !== id && nameKey(g.name) === nameKey(name))) return 'taken';
    }
    const pinGiven = patch.latitude !== undefined || patch.longitude !== undefined;
    const [latitude, longitude] = pinGiven
      ? pinOf(patch.latitude === undefined ? existing.latitude : patch.latitude,
              patch.longitude === undefined ? existing.longitude : patch.longitude)
      : [existing.latitude, existing.longitude];
    const next: Gym = {
      ...existing,
      name,
      equipment: patch.equipment !== undefined ? equipmentOf(patch.equipment) : existing.equipment,
      placeText: patch.placeText !== undefined ? patch.placeText.trim() : existing.placeText,
      latitude,
      longitude,
      radiusM: radiusOf(patch.radiusM, existing.radiusM),
      archived: patch.archived ?? existing.archived,
    };
    dbSaveGym(next);
    set({ gyms: get().gyms.map(g => (g.id === id ? next : g)) });
    return next;
  },

  deleteGym(id) {
    dbDeleteGym(id);
    set({ gyms: get().gyms.filter(g => g.id !== id), settings: get().settings.filter(s => s.gymId !== id) });
  },

  setGymExercise(gymId, exerciseId, patch) {
    if (!get().gyms.some(g => g.id === gymId)) return null;
    const id = gymExerciseId(gymId, exerciseId);
    const existing = get().settings.find(s => s.id === id);
    const positive = (v: number | null | undefined, fallback: number | null) =>
      v === undefined ? fallback : v !== null && Number.isFinite(v) && v > 0 ? v : null;
    const next: GymExerciseSetting = {
      id, gymId, exerciseId,
      notes: patch.notes !== undefined ? patch.notes.trim() : existing?.notes ?? '',
      barKg: positive(patch.barKg, existing?.barKg ?? null),
      incrementKg: positive(patch.incrementKg, existing?.incrementKg ?? null),
    };
    if (isEmptyGymSetting(next)) {
      if (existing) {
        dbDeleteGymExercise(id);
        set({ settings: get().settings.filter(s => s.id !== id) });
      }
      return null;
    }
    dbSaveGymExercise(next);
    set({ settings: existing ? get().settings.map(s => (s.id === id ? next : s)) : [...get().settings, next] });
    return next;
  },
}));
