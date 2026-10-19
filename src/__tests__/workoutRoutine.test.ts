import type { WorkoutRoutineItem } from '../types';
import {
  MAX_ROUTINE_SETS,
  MAX_WARMUP_SETS,
  addSet,
  addWarmup,
  canDuplicateSet,
  canRemoveSet,
  defaultTargets,
  describeRoutine,
  describeRoutineItem,
  describeSets,
  describeTargetReps,
  duplicateSet,
  itemShape,
  joinPrevious,
  kindsFor,
  leaveSuperset,
  newRoutineItem,
  normalizeSupersets,
  removeSet,
  routineSetLabels,
  supersetRoles,
  withProgression,
  withSetDuration,
  withSetKind,
  withSetReps,
  withSetWeight,
  warmupMode,
  withWarmupMode,
  withWarmups,
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
  it('counts each kind and reads the working sets\' values', () => {
    expect(itemShape(bench)).toEqual({
      warmups: 1, workingSets: 2, dropSets: 0, failureSets: 1,
      repsMin: 6, repsMax: 8, weightKg: 80, durationSeconds: null,
    });
    expect(itemShape({ targets: [] })).toMatchObject({ warmups: 0, workingSets: 0, repsMin: null });
  });

  it('reads a pyramid as the span of its reps', () => {
    const pyramid = { targets: [12, 10, 8].map(n => ({ kind: 'working' as const, repsMin: n, repsMax: n })) };
    expect(itemShape(pyramid)).toMatchObject({ repsMin: 8, repsMax: 12 });
  });

  it('falls back to drop or failure sets when there is no plain working set', () => {
    expect(itemShape({ targets: [{ kind: 'amrap', repsMin: 5, repsMax: 5, weightKg: 100 }] }))
      .toMatchObject({ workingSets: 0, failureSets: 1, repsMin: 5, weightKg: 100 });
  });
});

describe('one set at a time', () => {
  it('labels sets the way workout mode numbers them', () => {
    expect(routineSetLabels(bench.targets)).toEqual(['W', '1', '2', 'F']);
    expect(routineSetLabels([{ kind: 'working' }, { kind: 'drop' }, { kind: 'working' }])).toEqual(['1', 'D', '2']);
  });

  it('writes weight, reps and time on the one set it names', () => {
    const edited = withSetReps(withSetWeight(bench, 2, 82.5), 2, 10, 8);
    expect(edited.targets[2]).toMatchObject({ weightKg: 82.5, repsMin: 8, repsMax: 10 });
    expect(edited.targets.filter((_, i) => i !== 2)).toEqual(bench.targets.filter((_, i) => i !== 2));
    expect(withSetReps(bench, 1, 5, null).targets[1]).toMatchObject({ repsMin: 5, repsMax: 5 });
    expect(withSetReps(bench, 1, null, null).targets[1]).toMatchObject({ repsMin: null, repsMax: null });
    expect(withSetWeight(bench, 1, null).targets[1].weightKg).toBeNull();
    expect(withSetWeight(bench, 1, 0).targets[1].weightKg).toBeNull();
    expect(withSetDuration(newRoutineItem('plank', 'duration'), 0, 45).targets[0].durationSeconds).toBe(45);
    // An index past the end changes nothing.
    expect(withSetWeight(bench, 9, 100)).toBe(bench);
  });

  it('keeps a field it has no control for, such as a percentage of the training max', () => {
    const wave: WorkoutRoutineItem = { ...bench, targets: [{ kind: 'working', repsMin: 5, repsMax: 5, pctOfTm: 65 }] };
    expect(withSetReps(wave, 0, 3, 3).targets[0]).toEqual({ kind: 'working', repsMin: 3, repsMax: 3, pctOfTm: 65 });
  });

  it('changes a set\'s kind, moving a new warm-up up among the warm-ups and turning a ramp off', () => {
    const dropped = withSetKind(bench, 2, 'drop');
    expect(dropped.targets.map(t => t.kind)).toEqual(['warmup', 'working', 'drop', 'amrap']);
    const warm = withSetKind({ ...bench, warmupRamp: true }, 2, 'warmup');
    expect(warm.targets.map(t => t.kind)).toEqual(['warmup', 'warmup', 'working', 'amrap']);
    expect('warmupRamp' in warm).toBe(false);
  });

  it('takes a set to failure from the low end of its range', () => {
    expect(withSetKind(bench, 1, 'amrap').targets[1]).toMatchObject({ kind: 'amrap', repsMin: 6, repsMax: 6 });
  });

  it('never leaves an item without a set that isn\'t a warm-up', () => {
    const one: WorkoutRoutineItem = { ...bench, targets: [bench.targets[0], bench.targets[1]] };
    expect(canRemoveSet(one, 1)).toBe(false);
    expect(canRemoveSet(one, 0)).toBe(true);
    expect(removeSet(one, 1)).toBe(one);
    expect(kindsFor(one, 1)).toEqual(['working', 'drop', 'amrap']);
    expect(withSetKind(one, 1, 'warmup')).toBe(one);
    expect(kindsFor(bench, 1)).toEqual(['warmup', 'working', 'drop', 'amrap']);
  });

  it('duplicates a set straight after itself, up to the cap', () => {
    expect(duplicateSet(bench, 1).targets.map(t => t.kind)).toEqual(['warmup', 'working', 'working', 'working', 'amrap']);
    const full: WorkoutRoutineItem = { ...bench, targets: Array.from({ length: MAX_ROUTINE_SETS }, () => ({ kind: 'working' as const, repsMin: 5, repsMax: 5 })) };
    expect(canDuplicateSet(full, 0)).toBe(false);
    expect(duplicateSet(full, 0)).toBe(full);
    expect(addSet(full)).toBe(full);
  });

  it('adds a working set after the last one, so a set to failure stays at the end', () => {
    const more = addSet(bench);
    expect(more.targets.map(t => t.kind)).toEqual(['warmup', 'working', 'working', 'working', 'amrap']);
    expect(more.targets[3]).toEqual(bench.targets[2]);
    // With only a set to failure to copy, the copy is a plain working set.
    const failureOnly: WorkoutRoutineItem = { ...bench, targets: [{ kind: 'amrap', repsMin: 5, repsMax: 5 }] };
    expect(addSet(failureOnly).targets).toEqual([{ kind: 'amrap', repsMin: 5, repsMax: 5 }, { kind: 'working', repsMin: 5, repsMax: 5 }]);
  });

  it('adds a warm-up after the warm-ups, turning a ramp off', () => {
    const two = addWarmup(bench);
    expect(two.targets.slice(0, 2)).toEqual([bench.targets[0], bench.targets[0]]);
    const first = addWarmup({ ...withWarmupMode(bench, 'ramp') });
    expect(first.targets[0]).toEqual({ kind: 'warmup', repsMin: null, repsMax: null });
    expect('warmupRamp' in first).toBe(false);
    const full = withWarmups(bench, MAX_WARMUP_SETS);
    expect(addWarmup(full)).toBe(full);
  });

  it('reads a set\'s reps for its cell', () => {
    expect(describeTargetReps({ kind: 'working', repsMin: 6, repsMax: 8 })).toBe('6–8');
    expect(describeTargetReps({ kind: 'working', repsMin: 10, repsMax: 10 })).toBe('10');
    expect(describeTargetReps({ kind: 'warmup', repsMin: null, repsMax: null })).toBeNull();
    expect(describeTargetReps({ kind: 'amrap', repsMin: 6, repsMax: 6 })).toBe('6+');
    expect(describeTargetReps({ kind: 'amrap', repsMin: null, repsMax: null })).toBe('Max');
  });
});

describe('editing an item', () => {
  it('adds warm-ups ahead of the work, naming no weight, and keeps the ones there', () => {
    const two = withWarmups(bench, 2);
    expect(two.targets.slice(0, 2)).toEqual([
      { kind: 'warmup', repsMin: 10, repsMax: 10, weightKg: 40 },
      { kind: 'warmup', repsMin: null, repsMax: null },
    ]);
    expect(withWarmups(bench, 0).targets.map(t => t.kind)).toEqual(['working', 'working', 'amrap']);
  });

  it('switches between no warm-up, a ramp and a count of warm-ups', () => {
    expect(warmupMode(bench)).toBe('sets');
    const ramp = withWarmupMode(bench, 'ramp');
    expect(ramp.warmupRamp).toBe(true);
    expect(ramp.targets.map(t => t.kind)).toEqual(['working', 'working', 'amrap']);
    expect(warmupMode(ramp)).toBe('ramp');
    // Counting warm-ups again starts at two, and the ramp key goes rather than turning false.
    const sets = withWarmupMode(ramp, 'sets');
    expect('warmupRamp' in sets).toBe(false);
    expect(itemShape(sets).warmups).toBe(2);
    expect(itemShape(withWarmupMode(bench, 'sets')).warmups).toBe(1);
    const none = withWarmupMode(ramp, 'none');
    expect(warmupMode(none)).toBe('none');
    expect('warmupRamp' in none).toBe(false);
    expect('warmupRamp' in withWarmups(ramp, 3)).toBe(false);
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
    expect(describeRoutineItem(bench, opts)).toBe('1 warm-up · 2 × 6–8 · 1 to failure · 80 kg · rep range · rest 2:30');
    expect(describeRoutineItem(withWarmupMode(bench, 'ramp'), opts)).toBe('ramp warm-up · 2 × 6–8 · 1 to failure · 80 kg · rep range · rest 2:30');
    expect(describeRoutineItem(newRoutineItem('a', 'weight_reps'), opts)).toBe('3 × 8–12 · rest 1:30');
    expect(describeRoutineItem({ ...newRoutineItem('a', 'weight_reps'), restSeconds: 0 }, opts)).toBe('3 × 8–12 · no rest');
    expect(describeRoutineItem(withSetWeight(bench, 1, 61.235), { ...opts, unit: 'lb' })).toContain('135 lb');
  });

  it('says the rest only on the last of a superset, as coming after it', () => {
    expect(describeRoutineItem(newRoutineItem('a', 'weight_reps'), { ...opts, role: 'first' })).toBe('3 × 8–12');
    expect(describeRoutineItem(newRoutineItem('a', 'weight_reps'), { ...opts, role: 'last' })).toBe('3 × 8–12 · rest 1:30 after the superset');
  });

  it('reads a hold as a time and an item with nothing set as a count', () => {
    expect(describeSets(newRoutineItem('plank', 'duration'), 'duration')).toBe('3 × 0:30');
    expect(describeSets(newRoutineItem('run', 'distance'), 'distance')).toBe('3 sets');
    expect(describeSets({ targets: [{ kind: 'working', repsMin: 5, repsMax: 5 }] }, 'weight_reps')).toBe('1 × 5');
    expect(describeSets({ targets: [
      { kind: 'working', repsMin: 8, repsMax: 8 }, { kind: 'drop', repsMin: 12, repsMax: 12 }, { kind: 'drop', repsMin: 12, repsMax: 12 },
    ] }, 'weight_reps')).toBe('1 × 8 · 2 drop sets');
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
