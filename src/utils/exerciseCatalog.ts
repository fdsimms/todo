import type { Exercise, ExerciseEquipment, MuscleGroup } from '../types';
import { EXERCISE_LIBRARY, libraryExercise, type LibraryExercise } from './exerciseLibrary';
import { EQUIPMENT_LABELS, EXERCISE_EQUIPMENT, MUSCLE_GROUPS, MUSCLE_LABELS, equipmentGroup, machineParent, type EquipmentGroup } from './workoutData';
import { scoreSubstring } from './ranges';

/**
 * The exercises the person can pick from: the built-in library with their own
 * rows merged over it. See docs/arch/workouts.md.
 *
 * Three kinds of row come out of `exercises`, and each merges differently:
 *
 * - **An override** reuses a built-in's id. It contributes the name, notes,
 *   bar weight, dumbbell count, weight entry and archived flag only; what the movement *is* (kind, muscles,
 *   equipment, cue) stays the library's, so a correction in a later build
 *   still reaches somebody who renamed the exercise.
 * - **A custom exercise** has an id the library doesn't know, and is taken
 *   whole.
 * - **An unknown built-in** (a `lib:` id this build doesn't have, written by a
 *   newer one) is taken whole too, as the row describes it, rather than
 *   dropped: the sets logged against it still need a name to show under.
 */
export interface CatalogExercise extends Exercise {
  /** The library's one-line cue. Null for a custom exercise, which has only its notes. */
  cue: string | null;
  /** From the library (overridden or not), rather than one the person made. */
  builtIn: boolean;
  /** A built-in the person renamed, annotated or archived. */
  overridden: boolean;
}

function fromLibrary(lib: LibraryExercise, override: Exercise | undefined): CatalogExercise {
  return {
    id: lib.id,
    name: override?.name.trim() ? override.name : lib.name,
    kind: lib.kind,
    primaryMuscles: [...lib.primaryMuscles],
    secondaryMuscles: [...lib.secondaryMuscles],
    equipment: lib.equipment,
    barKg: override?.barKg ?? null,
    dumbbells: override?.dumbbells ?? null,
    loadEntry: override?.loadEntry ?? null,
    notes: override?.notes ?? '',
    archived: override?.archived ?? false,
    isCustom: false,
    createdAt: override?.createdAt ?? '',
    cue: lib.cue,
    builtIn: true,
    overridden: override !== undefined,
  };
}

function fromRow(row: Exercise): CatalogExercise {
  return { ...row, cue: null, builtIn: false, overridden: false };
}

const byName = (a: CatalogExercise, b: CatalogExercise) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

// One merge per array of rows: the store hands out the same array until a row
// changes, and the library is constant, so every list, picker and search over
// one state of the store shares the work. Same caching `openTasksOf` does.
const catalogCache = new WeakMap<readonly Exercise[], CatalogExercise[]>();

/**
 * Every exercise, archived ones included, sorted by name. Read this when a
 * name is wanted for a set already logged; `activeExercises` is the list a
 * person picks from.
 */
export function buildCatalog(rows: readonly Exercise[]): CatalogExercise[] {
  const cached = catalogCache.get(rows);
  if (cached) return cached;
  const byId = new Map(rows.map(r => [r.id, r]));
  const out: CatalogExercise[] = EXERCISE_LIBRARY.map(lib => fromLibrary(lib, byId.get(lib.id)));
  for (const row of rows) {
    if (!libraryExercise(row.id)) out.push(fromRow(row));
  }
  out.sort(byName);
  catalogCache.set(rows, out);
  return out;
}

/** The exercises on offer: everything not archived, sorted by name. */
export function activeExercises(rows: readonly Exercise[]): CatalogExercise[] {
  return buildCatalog(rows).filter(e => !e.archived);
}

/**
 * One exercise by id, archived or not. Null for an id neither the library nor
 * the rows know (a custom exercise deleted on another phone): a set pointing at
 * it still exists, and the caller names it as it can.
 */
export function catalogExercise(rows: readonly Exercise[], id: string): CatalogExercise | null {
  const lib = libraryExercise(id);
  const row = rows.find(r => r.id === id);
  if (lib) return fromLibrary(lib, row);
  return row ? fromRow(row) : null;
}

/** The name a set's exercise goes by, with a stand-in for one nobody can resolve. */
export function exerciseName(rows: readonly Exercise[], id: string): string {
  return catalogExercise(rows, id)?.name ?? 'Unknown exercise';
}

export interface ExerciseFilters {
  /** Only exercises that train this muscle as a primary mover. */
  muscle?: MuscleGroup | null;
  equipment?: ExerciseEquipment | null;
  /** Any of these muscles as a primary mover. Empty or omitted means no narrowing. */
  muscles?: readonly MuscleGroup[];
  /** Any of these pieces of equipment. Empty or omitted means no narrowing. */
  equipments?: readonly ExerciseEquipment[];
  /** Weights, machines, bodyweight or cardio. */
  group?: EquipmentGroup | null;
  /** Archived exercises too, for a search over history rather than a picker. */
  includeArchived?: boolean;
}

export interface ExerciseSearchResult {
  exercise: CatalogExercise;
  score: number;
  /** Ranges of the name to highlight. Empty when the match was on a muscle or the equipment. */
  nameMatches: [number, number][];
}

const compact = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

/**
 * How well one word matches one piece of text: a substring match scored the
 * way task search scores it (start of the text beats start of a word beats
 * mid-word), or, failing that, a match with the punctuation and spaces taken
 * out, so "pullup" finds "Pull-up" and "t bar" finds "T-bar row".
 *
 * Deliberately not the in-order letters match `scoreSubstring` falls back to:
 * over two hundred short names, "curl" scattered across "Cable crunch, lying"
 * would bring back half the library.
 */
function wordScore(text: string, word: string): { score: number; ranges: [number, number][] } {
  const hit = scoreSubstring(text, word);
  if (hit.score >= 100) return hit;
  const w = compact(word);
  return w && compact(text).includes(w) ? { score: 90, ranges: [] } : { score: 0, ranges: [] };
}

function matchesFilters(e: CatalogExercise, filters: ExerciseFilters): boolean {
  if (filters.muscle && !e.primaryMuscles.includes(filters.muscle)) return false;
  if (filters.equipment && e.equipment !== filters.equipment) return false;
  if (filters.muscles?.length && !filters.muscles.some(m => e.primaryMuscles.includes(m))) return false;
  if (filters.equipments?.length && !filters.equipments.includes(e.equipment)) return false;
  if (filters.group && equipmentGroup(e.equipment) !== filters.group) return false;
  return true;
}

/**
 * The exercises matching a query and filters, best first.
 *
 * Every word has to land somewhere: in the name, a muscle the exercise trains,
 * or its equipment, so "dumbbell chest" means dumbbell exercises for the chest.
 * A hit in the name counts double, so "Chest dip" ranks above an exercise that
 * only trains the chest. An empty query lists everything the filters allow,
 * by name. Archived exercises are left out, as `activeExercises` leaves them,
 * unless `includeArchived` asks for them.
 */
export function searchExercises(
  rows: readonly Exercise[],
  query: string,
  filters: ExerciseFilters = {}
): ExerciseSearchResult[] {
  const pool = (filters.includeArchived ? buildCatalog(rows) : activeExercises(rows)).filter(e => matchesFilters(e, filters));
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return pool.map(exercise => ({ exercise, score: 0, nameMatches: [] }));

  const results: ExerciseSearchResult[] = [];
  for (const exercise of pool) {
    // A specific machine is still found by "machine" (or "cardio"), as it was when they shared one value.
    const parent = machineParent(exercise.equipment);
    const labels = [
      ...exercise.primaryMuscles.map(m => MUSCLE_LABELS[m]),
      EQUIPMENT_LABELS[exercise.equipment],
      ...(parent ? [parent === 'machine' ? 'Machine' : 'Cardio machine'] : []),
    ];
    let total = 0;
    let nameMatches: [number, number][] = [];
    let every = true;
    for (const word of words) {
      const name = wordScore(exercise.name, word);
      const label = Math.max(0, ...labels.map(l => wordScore(l, word).score));
      if (name.score === 0 && label === 0) { every = false; break; }
      total += name.score * 2 + label;
      nameMatches = nameMatches.concat(name.ranges);
    }
    if (every) results.push({ exercise, score: total, nameMatches });
  }
  return results.sort((a, b) => b.score - a.score || byName(a.exercise, b.exercise));
}

/** The muscles at least one exercise on offer trains as a primary mover, in the app's order: a filter's options. */
export function muscleFilterOptions(rows: readonly Exercise[]): MuscleGroup[] {
  const used = new Set(activeExercises(rows).flatMap(e => e.primaryMuscles));
  return MUSCLE_GROUPS.filter(m => used.has(m));
}

/** The equipment at least one exercise on offer uses, in the app's order: a filter's options. */
export function equipmentFilterOptions(rows: readonly Exercise[]): ExerciseEquipment[] {
  const used = new Set(activeExercises(rows).map(e => e.equipment));
  return EXERCISE_EQUIPMENT.filter(q => used.has(q));
}

/** "Chest, Triceps · Barbell": what an exercise trains and what with, for a row's second line. */
export function describeExercise(e: Pick<Exercise, 'primaryMuscles' | 'equipment'>): string {
  const muscles = e.primaryMuscles.map(m => MUSCLE_LABELS[m]).join(', ');
  return muscles ? `${muscles} · ${EQUIPMENT_LABELS[e.equipment]}` : EQUIPMENT_LABELS[e.equipment];
}
