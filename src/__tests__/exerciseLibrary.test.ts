import { EXERCISE_LIBRARY, LIBRARY_ID_PREFIX, isLibraryId, libraryExercise } from '../utils/exerciseLibrary';
import { EXERCISE_EQUIPMENT, EXERCISE_KINDS, MUSCLE_GROUPS } from '../utils/workoutData';

describe('the built-in exercise library', () => {
  it('is a real gym library rather than a sample', () => {
    expect(EXERCISE_LIBRARY.length).toBeGreaterThanOrEqual(150);
    expect(EXERCISE_LIBRARY.length).toBeLessThanOrEqual(250);
  });

  it('gives every exercise a unique, prefixed slug id', () => {
    const ids = EXERCISE_LIBRARY.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^lib:[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  // Every set, routine item and override row names an exercise by id, so these
  // must never change. A sample is pinned; the rule is in the module header.
  it('keeps the ids other rows already point at', () => {
    for (const id of ['lib:barbell-bench-press', 'lib:back-squat', 'lib:deadlift', 'lib:overhead-press', 'lib:pull-up', 'lib:dumbbell-lateral-raise']) {
      expect(libraryExercise(id)).toBeDefined();
    }
  });

  it('gives every exercise a unique name', () => {
    const names = EXERCISE_LIBRARY.map(e => e.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('files every exercise under known kinds, equipment and muscles, with at least one primary mover', () => {
    for (const e of EXERCISE_LIBRARY) {
      expect(EXERCISE_KINDS).toContain(e.kind);
      expect(EXERCISE_EQUIPMENT).toContain(e.equipment);
      expect(e.primaryMuscles.length).toBeGreaterThan(0);
      for (const m of [...e.primaryMuscles, ...e.secondaryMuscles]) expect(MUSCLE_GROUPS).toContain(m);
      // A muscle is a primary mover or a helper, never both.
      expect(e.secondaryMuscles.filter(m => e.primaryMuscles.includes(m))).toEqual([]);
    }
  });

  it('trains every muscle group somewhere as a primary mover', () => {
    const trained = new Set(EXERCISE_LIBRARY.flatMap(e => e.primaryMuscles));
    expect(MUSCLE_GROUPS.filter(m => !trained.has(m))).toEqual([]);
  });

  it('writes each cue as one plain sentence, with no em dashes', () => {
    for (const e of EXERCISE_LIBRARY) {
      expect(e.cue).toMatch(/^[A-Z].*\.$/);
      expect(e.cue).not.toMatch(/—/);
      expect(e.name).not.toMatch(/—/);
      expect(e.cue.length).toBeLessThanOrEqual(140);
    }
  });

  it('names names in sentence case, the way the rest of the app labels things', () => {
    for (const e of EXERCISE_LIBRARY) {
      const [, ...rest] = e.name.split(' ');
      // Proper nouns and initialisms ("Romanian", "EZ", "JM", "T-bar") are the exceptions.
      const shouting = rest.filter(w => /^[A-Z][a-z]/.test(w) && !['Romanian', 'Bulgarian', 'Nordic', 'Turkish', 'Pallof', 'Copenhagen', 'Arnold', 'Pendlay', 'Zercher', 'Smith'].includes(w));
      expect(shouting).toEqual([]);
    }
  });

  it('covers every kind of thing a set records', () => {
    expect(new Set(EXERCISE_LIBRARY.map(e => e.kind))).toEqual(new Set(EXERCISE_KINDS));
  });

  it('tells a built-in id by its prefix, whether or not this build has it', () => {
    expect(isLibraryId('lib:barbell-bench-press')).toBe(true);
    expect(isLibraryId(`${LIBRARY_ID_PREFIX}from-a-newer-build`)).toBe(true);
    expect(isLibraryId('k3x9a2')).toBe(false);
    expect(libraryExercise('lib:from-a-newer-build')).toBeUndefined();
  });
});
