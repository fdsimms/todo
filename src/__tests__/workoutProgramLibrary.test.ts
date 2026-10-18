import { PROGRAM_LIBRARY, libraryProgram, percentExercises } from '../utils/workoutProgramLibrary';
import { libraryExercise } from '../utils/exerciseLibrary';
import { readRoutineItems } from '../utils/workoutData';

describe('PROGRAM_LIBRARY', () => {
  it('offers the four generic programs, by name', () => {
    expect(PROGRAM_LIBRARY.map(p => p.name)).toEqual(['5×5 linear', 'Push / Pull / Legs', 'Upper / Lower', '4-week percentage wave']);
    expect(new Set(PROGRAM_LIBRARY.map(p => p.key)).size).toBe(PROGRAM_LIBRARY.length);
  });

  it('names only built-in exercises, so nothing is missing on a phone with no custom ones', () => {
    const missing = PROGRAM_LIBRARY.flatMap(p => p.routines.flatMap(r => r.items.map(i => i.exerciseId)))
      .filter(id => !libraryExercise(id));
    expect(missing).toEqual([]);
  });

  it('gives each routine items that read back as they were written', () => {
    for (const p of PROGRAM_LIBRARY) {
      for (const r of p.routines) {
        expect(r.items.length).toBeGreaterThan(0);
        expect(readRoutineItems(JSON.stringify(r.items))).toEqual(r.items);
      }
    }
  });

  it('moves only a load: a bodyweight or timed exercise carries no progression', () => {
    for (const p of PROGRAM_LIBRARY) {
      for (const r of p.routines) {
        for (const i of r.items) {
          const loaded = libraryExercise(i.exerciseId)!.kind === 'weight_reps';
          if (!loaded) expect(i.progression).toBeNull();
          if (i.warmupRamp) expect(loaded).toBe(true);
        }
      }
    }
  });

  it('gives the percentage wave a length and a percentage on every main set', () => {
    const wave = libraryProgram('percentage-wave')!;
    expect(wave).toMatchObject({ scheme: 'percent', weeks: 4 });
    expect(percentExercises(wave.routines, wave.scheme, id => libraryExercise(id)?.kind ?? null)).toEqual([
      'lib:overhead-press', 'lib:deadlift', 'lib:barbell-bench-press', 'lib:back-squat',
    ]);
    expect(libraryProgram('nope')).toBeNull();
  });
});

describe('percentExercises', () => {
  const item = (exerciseId: string, scheme: 'percent' | 'double' | null, pct = false) => ({
    exerciseId,
    progression: scheme ? { scheme, incrementKg: null } : null,
    targets: [{ kind: 'working' as const, repsMin: 5, repsMax: 5, ...(pct ? { pctOfTm: 70 } : {}) }],
  });

  it('lists an exercise whose sets are percentages, once', () => {
    const routines = [{ items: [item('a', 'percent'), item('b', null), item('c', 'double', true)] }, { items: [item('a', 'percent')] }];
    const kindOf = (id: string) => (id === 'pullup' ? 'bodyweight_reps' as const : 'weight_reps' as const);
    expect(percentExercises(routines, 'double', kindOf)).toEqual(['a', 'c']);
    expect(percentExercises(routines, 'percent', kindOf)).toEqual(['a', 'b', 'c']);
    expect(percentExercises([{ items: [item('pullup', null)] }], 'percent', kindOf)).toEqual([]);
  });
});
