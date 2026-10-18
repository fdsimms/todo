import type { WorkoutRoutineItem } from '../types';
import {
  defaultTargets,
  describeRoutine,
  describeRoutineItem,
  describeSets,
  itemShape,
  joinPrevious,
  leaveSuperset,
  newRoutineItem,
  normalizeSupersets,
  supersetRoles,
  withProgression,
  withReps,
  withTargetDuration,
  withTargetWeight,
  withWarmups,
  withWorkingSets,
} from '../utils/workoutRoutine';

const bench: WorkoutRoutineItem = {
  exerciseId: 'lib:barbell-bench-press',
  supersetKey: null,
  restSeconds: 150,
  progression: { scheme: 'double', incrementKg: 2.5 },
  targets: [
    { kind: 'warmup', repsMin: 10, repsMax: 10, weightKg: 40 },
    { kind: 'working', repsMin: 6, repsMax: 8, weightKg: 80 },
    { kind: 'working', repsMin: 6, repsMax: 8, weightKg: 80 },
    { kind: 'amrap', repsMin: 6, repsMax: null, weightKg: 75 },
  ],
};

describe('itemShape', () => {
  it('reads the counts and the first working target\'s values', () => {
    expect(itemShape(bench)).toEqual({
      warmups: 1, workingSets: 3, repsMin: 6, repsMax: 8, weightKg: 80, durationSeconds: null,
    });
    expect(itemShape({ targets: [] })).toMatchObject({ warmups: 0, workingSets: 0, repsMin: null });
  });
});

describe('editing an item', () => {
  it('adds working sets as copies of the last, and drops from the end', () => {
    const more = withWorkingSets(bench, 5);
    expect(more.targets.map(t => t.kind)).toEqual(['warmup', 'working', 'working', 'amrap', 'amrap', 'amrap']);
    const fewer = withWorkingSets(bench, 1);
    expect(fewer.targets).toEqual(bench.targets.slice(0, 2));
    // Never fewer than one working set, never more than the cap.
    expect(itemShape(withWorkingSets(bench, 0)).workingSets).toBe(1);
    expect(itemShape(withWorkingSets(bench, 99)).workingSets).toBe(20);
  });

  it('adds warm-ups ahead of the work, naming no weight, and keeps the ones there', () => {
    const two = withWarmups(bench, 2);
    expect(two.targets.slice(0, 2)).toEqual([
      { kind: 'warmup', repsMin: 10, repsMax: 10, weightKg: 40 },
      { kind: 'warmup', repsMin: null, repsMax: null },
    ]);
    expect(withWarmups(bench, 0).targets.map(t => t.kind)).toEqual(['working', 'working', 'amrap']);
  });

  it('writes reps and weight onto every working set and nothing else of them', () => {
    const edited = withTargetWeight(withReps(bench, 10, 8), 82.5);
    expect(edited.targets[0]).toEqual(bench.targets[0]);
    expect(edited.targets.slice(1).map(t => [t.kind, t.repsMin, t.repsMax, t.weightKg])).toEqual([
      ['working', 8, 10, 82.5], ['working', 8, 10, 82.5], ['amrap', 8, 10, 82.5],
    ]);
    expect(withReps(bench, 5, null).targets[1]).toMatchObject({ repsMin: 5, repsMax: 5 });
    expect(withTargetWeight(bench, null).targets[1].weightKg).toBeNull();
    expect(withTargetDuration(newRoutineItem('plank', 'duration'), 45).targets[0].durationSeconds).toBe(45);
  });

  it('stores a scheme choice, keeping its step, and clears it', () => {
    expect(withProgression(bench, 'linear').progression).toEqual({ scheme: 'linear', incrementKg: 2.5 });
    expect(withProgression(newRoutineItem('x', 'weight_reps'), 'rpe').progression).toEqual({ scheme: 'rpe', incrementKg: null });
    expect(withProgression(bench, null).progression).toBeNull();
  });

  it('starts a new item from what the exercise records', () => {
    expect(newRoutineItem('a', 'weight_reps')).toEqual({
      exerciseId: 'a', supersetKey: null, restSeconds: null, progression: null,
      targets: [0, 1, 2].map(() => ({ kind: 'working', repsMin: 8, repsMax: 12 })),
    });
    expect(defaultTargets('duration')[0]).toMatchObject({ durationSeconds: 30, repsMin: null });
    expect(defaultTargets('distance')[0]).toMatchObject({ repsMin: null, repsMax: null });
  });
});

describe('supersets', () => {
  const items = (...keys: (string | null)[]) => keys.map(supersetKey => ({ supersetKey }));

  it('gives each item its place in its run', () => {
    expect(supersetRoles(items(null, 'a', 'a', 'a', null, 'b'))).toEqual(['none', 'first', 'middle', 'last', 'none', 'none']);
  });

  it('clears a key left on its own and a second run reusing one', () => {
    expect(normalizeSupersets(items('a', null, 'b', 'b', 'a', 'a')).map(i => i.supersetKey))
      .toEqual([null, null, 'b', 'b', null, null]);
  });

  it('joins an item to the one before, starting a superset or growing one', () => {
    expect(joinPrevious(items(null, null, null), 1, 'new').map(i => i.supersetKey)).toEqual(['new', 'new', null]);
    expect(joinPrevious(items('a', 'a', null), 2, 'new').map(i => i.supersetKey)).toEqual(['a', 'a', 'a']);
    expect(joinPrevious(items(null), 0, 'new').map(i => i.supersetKey)).toEqual([null]);
  });

  it('takes an item out, and a partner left alone with it', () => {
    expect(leaveSuperset(items('a', 'a'), 1).map(i => i.supersetKey)).toEqual([null, null]);
    expect(leaveSuperset(items('a', 'a', 'a'), 0).map(i => i.supersetKey)).toEqual([null, 'a', 'a']);
    // Out of the middle of three: the two ends are each alone, so neither is a superset.
    expect(leaveSuperset(items('a', 'a', 'a'), 1).map(i => i.supersetKey)).toEqual([null, null, null]);
    // Out of the middle of four: the half below is a superset of its own.
    const split = leaveSuperset(items('a', 'a', 'a', 'a', 'a'), 2).map(i => i.supersetKey);
    expect(split.slice(0, 3)).toEqual(['a', 'a', null]);
    expect(split[3]).toBeTruthy();
    expect(split[3]).toBe(split[4]);
    expect(split[3]).not.toBe('a');
  });
});

describe('describing an item', () => {
  const opts = { kind: 'weight_reps' as const, unit: 'kg' as const, defaultRestSeconds: 90, role: 'none' as const };

  it('reads warm-ups, sets, weight, the scheme and the rest', () => {
    expect(describeRoutineItem(bench, opts)).toBe('1 warm-up · 3 × 6–8 · 80 kg · rep range · rest 2:30');
    expect(describeRoutineItem(newRoutineItem('a', 'weight_reps'), opts)).toBe('3 × 8–12 · rest 1:30');
    expect(describeRoutineItem({ ...newRoutineItem('a', 'weight_reps'), restSeconds: 0 }, opts)).toBe('3 × 8–12 · no rest');
    expect(describeRoutineItem(withTargetWeight(bench, 61.235), { ...opts, unit: 'lb' })).toContain('135 lb');
  });

  it('says the rest only on the last of a superset, as coming after it', () => {
    expect(describeRoutineItem(newRoutineItem('a', 'weight_reps'), { ...opts, role: 'first' })).toBe('3 × 8–12');
    expect(describeRoutineItem(newRoutineItem('a', 'weight_reps'), { ...opts, role: 'last' })).toBe('3 × 8–12 · rest 1:30 after the superset');
  });

  it('reads a hold as a time and an item with nothing set as a count', () => {
    expect(describeSets(newRoutineItem('plank', 'duration'), 'duration')).toBe('3 × 0:30');
    expect(describeSets(newRoutineItem('run', 'distance'), 'distance')).toBe('3 sets');
    expect(describeSets({ targets: [{ kind: 'working', repsMin: 5, repsMax: 5 }] }, 'weight_reps')).toBe('1 × 5');
  });
});

describe('describeRoutine', () => {
  const muscles: Record<string, ('chest' | 'triceps' | 'front_delts' | 'side_delts')[]> = {
    bench: ['chest', 'triceps'],
    press: ['front_delts', 'triceps'],
    raise: ['side_delts'],
  };
  const of = (id: string) => muscles[id] ?? [];

  it('counts the exercises and names the first three muscles they work', () => {
    expect(describeRoutine([{ exerciseId: 'bench' }, { exerciseId: 'press' }, { exerciseId: 'raise' }], of))
      .toBe('3 exercises · Chest, Triceps, Front delts');
    expect(describeRoutine([{ exerciseId: 'unknown' }], of)).toBe('1 exercise');
    expect(describeRoutine([], of)).toBe('No exercises yet');
  });
});
