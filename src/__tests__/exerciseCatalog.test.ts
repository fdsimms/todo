import type { Exercise } from '../types';
import {
  activeExercises, buildCatalog, catalogExercise, describeExercise, equipmentFilterOptions, exerciseName,
  muscleFilterOptions, searchExercises,
} from '../utils/exerciseCatalog';
import { EXERCISE_LIBRARY } from '../utils/exerciseLibrary';

const row = (overrides: Partial<Exercise>): Exercise => ({
  id: 'c1',
  name: 'Landmine row',
  kind: 'weight_reps',
  primaryMuscles: ['upper_back'],
  secondaryMuscles: ['biceps'],
  equipment: 'barbell',
  barKg: null,
  notes: '',
  archived: false,
  isCustom: true,
  createdAt: '2026-10-01T10:00:00.000Z',
  ...overrides,
});

const names = (list: { name: string }[]) => list.map(e => e.name);

describe('buildCatalog', () => {
  it('is the whole library on an install with no rows, sorted by name', () => {
    const catalog = buildCatalog([]);
    expect(catalog).toHaveLength(EXERCISE_LIBRARY.length);
    expect(catalog.every(e => e.builtIn && !e.overridden && e.cue)).toBe(true);
    const sorted = [...names(catalog)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    expect(names(catalog)).toEqual(sorted);
  });

  it('adds a custom exercise whole, with no cue of its own', () => {
    const catalog = buildCatalog([row({})]);
    const custom = catalog.find(e => e.id === 'c1')!;
    expect(custom).toMatchObject({ name: 'Landmine row', builtIn: false, cue: null, isCustom: true });
  });

  // The person's words win; what the movement is stays the library's, so a
  // corrected muscle list in a later build still reaches a renamed exercise.
  it('takes only the name, notes, bar and archived flag from an override', () => {
    const override = row({
      id: 'lib:barbell-bench-press', name: 'Flat bench', notes: 'Pause on the chest', barKg: 15, isCustom: false,
      primaryMuscles: ['calves'], equipment: 'band',
    });
    const bench = catalogExercise([override], 'lib:barbell-bench-press')!;
    expect(bench).toMatchObject({ name: 'Flat bench', notes: 'Pause on the chest', barKg: 15, overridden: true, builtIn: true });
    expect(bench.primaryMuscles).toEqual(['chest']);
    expect(bench.equipment).toBe('barbell');
    expect(bench.cue).toBeTruthy();
    // One entry, not the library's and the override's both.
    expect(buildCatalog([override]).filter(e => e.id === 'lib:barbell-bench-press')).toHaveLength(1);
  });

  it('keeps the library name when an override left the name blank', () => {
    const override = row({ id: 'lib:back-squat', name: '  ', isCustom: false, notes: 'High bar' });
    expect(catalogExercise([override], 'lib:back-squat')?.name).toBe('Barbell back squat');
  });

  it('keeps a built-in this build does not know, as its row describes it', () => {
    const newer = row({ id: 'lib:from-a-newer-build', name: 'Belt squat march', isCustom: false });
    expect(catalogExercise([newer], newer.id)?.name).toBe('Belt squat march');
    expect(names(buildCatalog([newer]))).toContain('Belt squat march');
  });

  it('hands back the same list for the same rows', () => {
    const rows = [row({})];
    expect(buildCatalog(rows)).toBe(buildCatalog(rows));
  });
});

describe('activeExercises and catalogExercise', () => {
  it('leaves archived exercises off the list but still names them', () => {
    const rows = [row({ archived: true }), row({ id: 'lib:pec-deck', name: 'Pec deck', archived: true, isCustom: false })];
    expect(names(activeExercises(rows))).not.toContain('Landmine row');
    expect(names(activeExercises(rows))).not.toContain('Pec deck');
    expect(exerciseName(rows, 'c1')).toBe('Landmine row');
    expect(exerciseName(rows, 'lib:pec-deck')).toBe('Pec deck');
  });

  it('names an exercise nobody can resolve rather than throwing', () => {
    expect(catalogExercise([], 'gone')).toBeNull();
    expect(exerciseName([], 'gone')).toBe('Unknown exercise');
  });
});

describe('searchExercises', () => {
  it('lists everything on offer for an empty query, by name', () => {
    expect(searchExercises([], '  ')).toHaveLength(EXERCISE_LIBRARY.length);
  });

  it('finds by name, best match first, and marks where it matched', () => {
    const results = searchExercises([], 'lateral raise');
    expect(results[0].exercise.name).toMatch(/lateral raise/i);
    expect(results[0].nameMatches.length).toBeGreaterThan(0);
    expect(results.every(r => /lateral/i.test(r.exercise.name))).toBe(true);
  });

  it('needs every word to land, in the name, a muscle or the equipment', () => {
    const found = names(searchExercises([], 'dumbbell chest').map(r => r.exercise));
    expect(found).toContain('Dumbbell bench press');
    // Both words in the name count too.
    expect(found).toContain('Chest-supported dumbbell row');
    expect(found).not.toContain('Barbell bench press');
    expect(found).not.toContain('Dumbbell curl');
  });

  it('ranks a name hit above an exercise that only trains the muscle', () => {
    const results = searchExercises([], 'chest');
    expect(results[0].exercise.name).toMatch(/chest/i);
    expect(names(results.map(r => r.exercise))).toContain('Barbell bench press');
  });

  it('ignores punctuation and spacing in a name', () => {
    expect(names(searchExercises([], 'pullup').map(r => r.exercise))).toContain('Pull-up');
    expect(names(searchExercises([], 't bar').map(r => r.exercise))).toContain('T-bar row');
  });

  it('does not match letters scattered through a name', () => {
    // "curl" in order across "Cable crunch" and the like would be most of the library.
    expect(searchExercises([], 'curl').every(r => /curl/i.test(r.exercise.name))).toBe(true);
  });

  it('applies muscle and equipment filters, with or without a query', () => {
    const biceps = searchExercises([], '', { muscle: 'biceps' });
    expect(biceps.length).toBeGreaterThan(0);
    expect(biceps.every(r => r.exercise.primaryMuscles.includes('biceps'))).toBe(true);
    const cableBiceps = searchExercises([], 'curl', { muscle: 'biceps', equipment: 'cable' });
    expect(names(cableBiceps.map(r => r.exercise))).toEqual(['Cable curl', 'Cable hammer curl', 'Cable preacher curl']);
  });

  it('searches archived exercises only when asked to', () => {
    const rows = [row({ archived: true })];
    expect(names(searchExercises(rows, 'landmine row').map(r => r.exercise))).toEqual([]);
    expect(names(searchExercises(rows, 'landmine row', { includeArchived: true }).map(r => r.exercise))).toEqual(['Landmine row']);
  });

  it('finds a custom exercise and a renamed built-in by their own names', () => {
    const rows = [row({}), row({ id: 'lib:barbell-bench-press', name: 'Flat bench', isCustom: false })];
    expect(names(searchExercises(rows, 'landmine row').map(r => r.exercise))).toContain('Landmine row');
    expect(names(searchExercises(rows, 'flat bench').map(r => r.exercise))).toEqual(['Flat bench']);
  });
});

describe('filter options and descriptions', () => {
  it('offers only the muscles and equipment something on offer uses', () => {
    expect(muscleFilterOptions([])).toContain('chest');
    expect(equipmentFilterOptions([])).toContain('barbell');
    expect(equipmentFilterOptions([]).length).toBeGreaterThan(5);
  });

  it('says what an exercise trains and with what', () => {
    expect(describeExercise({ primaryMuscles: ['chest', 'triceps'], equipment: 'barbell' })).toBe('Chest, Triceps · Barbell');
    expect(describeExercise({ primaryMuscles: [], equipment: 'band' })).toBe('Band');
  });
});
