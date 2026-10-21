import type { WorkoutSet } from '../types';
import {
  afterLog,
  copyLastSet,
  joinedSuperset,
  leftSuperset,
  currentSetOf,
  finishPlan,
  formatDistance,
  formatSetLine,
  matchPrevious,
  matchPreviousByPosition,
  previousBadge,
  movedExerciseOrder,
  exerciseBlocks,
  nextSet,
  plannedSetsFor,
  plannedSetsFromHistory,
  previousSets,
  repeatedSets,
  restSecondsFor,
  sessionExercises,
  sessionMinutes,
  sessionSummary,
  setFieldsFor,
  setLabels,
  setName,
  columnLabel,
  fieldLabel,
  supersetGroup,
  valuesFromLastDone,
  walkOrder,
} from '../utils/workoutSession';

const DONE = '2026-10-07T18:10:00.000Z';

let seq = 0;
function set(exerciseId: string, position: number, setIndex: number, extra: Partial<WorkoutSet> = {}): WorkoutSet {
  seq += 1;
  return {
    id: `${exerciseId}-${setIndex}-${seq}`,
    sessionId: 's1',
    exerciseId,
    position,
    setIndex,
    kind: 'working',
    weightKg: 60,
    reps: 8,
    durationSeconds: null,
    distanceM: null,
    rpe: null,
    completedAt: null,
    supersetKey: null,
    note: null,
    ...extra,
  };
}

/** Bench on its own, then incline and fly as a superset, then triceps. */
function session(): WorkoutSet[] {
  return [
    set('bench', 0, 0, { kind: 'warmup', completedAt: DONE }),
    set('bench', 0, 1, { completedAt: DONE }),
    set('bench', 0, 2),
    set('incline', 1, 0, { supersetKey: 'ss' }),
    set('incline', 1, 1, { supersetKey: 'ss' }),
    set('fly', 2, 0, { supersetKey: 'ss' }),
    set('fly', 2, 1, { supersetKey: 'ss' }),
    set('fly', 2, 2, { supersetKey: 'ss' }),
    set('triceps', 3, 0),
  ];
}

const ids = (sets: WorkoutSet[]) => sets.map(s => `${s.exerciseId}${s.setIndex}`);

describe('sessionExercises', () => {
  it('groups sets by exercise in the session\'s order, whatever order they arrive in', () => {
    const exercises = sessionExercises([...session()].reverse());
    expect(exercises.map(e => e.exerciseId)).toEqual(['bench', 'incline', 'fly', 'triceps']);
    expect(exercises[0].sets.map(s => s.setIndex)).toEqual([0, 1, 2]);
    expect(exercises[1].supersetKey).toBe('ss');
  });
});

describe('supersetGroup and walkOrder', () => {
  it('finds the run of neighbours sharing a key, or the exercise alone', () => {
    const exercises = sessionExercises(session());
    expect(supersetGroup(exercises, 'fly').map(e => e.exerciseId)).toEqual(['incline', 'fly']);
    expect(supersetGroup(exercises, 'bench').map(e => e.exerciseId)).toEqual(['bench']);
    expect(supersetGroup(exercises, 'nope')).toEqual([]);
  });

  it('alternates a superset round by round, the longer one finishing alone', () => {
    expect(ids(walkOrder(session()))).toEqual([
      'bench0', 'bench1', 'bench2',
      'incline0', 'fly0', 'incline1', 'fly1', 'fly2',
      'triceps0',
    ]);
  });

  it('does not alternate across two exercises that share a key but sit apart', () => {
    const sets = [
      set('a', 0, 0, { supersetKey: 'k' }), set('a', 0, 1, { supersetKey: 'k' }),
      set('b', 1, 0),
      set('c', 2, 0, { supersetKey: 'k' }),
    ];
    expect(ids(walkOrder(sets))).toEqual(['a0', 'a1', 'b0', 'c0']);
  });
});

describe('movedExerciseOrder', () => {
  it('moves an exercise a place past its neighbour', () => {
    expect(movedExerciseOrder(session(), 'bench', 'down')).toEqual(['incline', 'fly', 'bench', 'triceps']);
    expect(movedExerciseOrder(session(), 'triceps', 'up')).toEqual(['bench', 'triceps', 'incline', 'fly']);
  });

  it('moves a superset as one block, from either partner, so the pair is never split', () => {
    expect(movedExerciseOrder(session(), 'fly', 'up')).toEqual(['incline', 'fly', 'bench', 'triceps']);
    expect(movedExerciseOrder(session(), 'incline', 'down')).toEqual(['bench', 'triceps', 'incline', 'fly']);
  });

  it('is null at the end it would move past, or for an exercise not in the workout', () => {
    expect(movedExerciseOrder(session(), 'bench', 'up')).toBeNull();
    expect(movedExerciseOrder(session(), 'triceps', 'down')).toBeNull();
    expect(movedExerciseOrder(session(), 'squat', 'up')).toBeNull();
  });
});

describe('joinedSuperset', () => {
  const keyOf = (sets: WorkoutSet[], id: string) => [...new Set(sets.filter(x => x.exerciseId === id).map(x => x.supersetKey))];
  const orderOf = (sets: WorkoutSet[]) => sessionExercises(sets).map(e => e.exerciseId);

  it('moves the partner below the exercise and gives both one key', () => {
    const next = joinedSuperset(session(), 'bench', 'triceps', 'new')!;
    expect(orderOf(next)).toEqual(['bench', 'triceps', 'incline', 'fly']);
    expect(keyOf(next, 'bench')).toEqual(['new']);
    expect(keyOf(next, 'triceps')).toEqual(['new']);
  });

  it('joins a superset the exercise is already in, under its own key', () => {
    const [key] = keyOf(session(), 'incline');
    const next = joinedSuperset(session(), 'fly', 'triceps', 'new')!;
    expect(orderOf(next)).toEqual(['bench', 'incline', 'fly', 'triceps']);
    expect(keyOf(next, 'triceps')).toEqual([key]);
  });

  it('is null for the same exercise, one already together, or an unknown one', () => {
    expect(joinedSuperset(session(), 'bench', 'bench', 'k')).toBeNull();
    expect(joinedSuperset(session(), 'incline', 'fly', 'k')).toBeNull();
    expect(joinedSuperset(session(), 'bench', 'squat', 'k')).toBeNull();
  });
});

describe('leftSuperset', () => {
  it('takes a pair apart: the partner left alone leaves too', () => {
    const next = leftSuperset(session(), 'fly')!;
    expect(next.every(x => x.supersetKey === null)).toBe(true);
  });

  it('is null for an exercise in no superset', () => {
    expect(leftSuperset(session(), 'bench')).toBeNull();
  });
});

describe('the next set', () => {
  it('is the first set still open in walking order', () => {
    const next = nextSet(session());
    expect(next && `${next.exerciseId}${next.setIndex}`).toBe('bench2');
  });

  it('comes back to a set skipped earlier', () => {
    const sets = session().map(s => (s.exerciseId === 'incline' ? { ...s, completedAt: DONE } : s));
    expect(nextSet(sets)?.exerciseId).toBe('bench');
  });

  it('is null once everything is done, and an exercise\'s card opens on its first open set', () => {
    const all = session().map(s => ({ ...s, completedAt: DONE }));
    expect(nextSet(all)).toBeNull();
    const [bench] = sessionExercises(session());
    expect(currentSetOf(bench)?.setIndex).toBe(2);
    expect(currentSetOf(sessionExercises(all)[0])).toBeNull();
  });
});

describe('afterLog', () => {
  const tick = (sets: WorkoutSet[], exerciseId: string, setIndex: number) => {
    const target = sets.find(s => s.exerciseId === exerciseId && s.setIndex === setIndex)!;
    const next = sets.map(s => (s.id === target.id ? { ...s, completedAt: DONE } : s));
    return { next, result: afterLog(next, target.id) };
  };

  it('keeps the card on an exercise done on its own, and starts a rest', () => {
    expect(tick(session(), 'bench', 2).result).toEqual({ showExerciseId: 'bench', rest: true });
  });

  it('turns to the partner mid-round with no rest, and rests once the round closes', () => {
    let { next, result } = tick(session(), 'incline', 0);
    expect(result).toEqual({ showExerciseId: 'fly', rest: false });
    ({ next, result } = tick(next, 'fly', 0));
    // The round is closed: rest, and the card goes back to where round two starts.
    expect(result).toEqual({ showExerciseId: 'incline', rest: true });
    ({ next, result } = tick(next, 'incline', 1));
    expect(result).toEqual({ showExerciseId: 'fly', rest: false });
    ({ next, result } = tick(next, 'fly', 1));
    // Incline has no third set, so fly's extra round is done alone, after a rest.
    expect(result).toEqual({ showExerciseId: 'fly', rest: true });
    ({ result } = tick(next, 'fly', 2));
    // Nothing left in the superset: the card stays, and the rest before triceps starts.
    expect(result).toEqual({ showExerciseId: 'fly', rest: true });
  });

  it('is null for a set it cannot find', () => {
    expect(afterLog(session(), 'nope')).toBeNull();
  });
});

describe('restSecondsFor', () => {
  const routine = { items: [
    { exerciseId: 'bench', supersetKey: null, restSeconds: 150, progression: null, targets: [] },
    { exerciseId: 'fly', supersetKey: null, restSeconds: null, progression: null, targets: [] },
    { exerciseId: 'plank', supersetKey: null, restSeconds: 0, progression: null, targets: [] },
  ] };

  it('takes the item\'s own rest, else the setting, and keeps a rest of none', () => {
    expect(restSecondsFor(routine, 'bench', 90)).toBe(150);
    expect(restSecondsFor(routine, 'fly', 90)).toBe(90);
    expect(restSecondsFor(routine, 'squat', 90)).toBe(90);
    expect(restSecondsFor(null, 'bench', 90)).toBe(90);
    expect(restSecondsFor(routine, 'plank', 90)).toBe(0);
  });
});

describe('last time', () => {
  const sessions = [
    { id: 'old', startedAt: '2026-09-01T18:00:00.000Z' },
    { id: 'last', startedAt: '2026-10-01T18:00:00.000Z' },
    { id: 's1', startedAt: '2026-10-07T18:00:00.000Z' },
  ];
  const history = [
    { ...set('bench', 0, 0, { completedAt: DONE, weightKg: 70 }), sessionId: 'old' },
    { ...set('bench', 0, 1, { completedAt: DONE, weightKg: 80, reps: 8 }), sessionId: 'last' },
    { ...set('bench', 0, 0, { completedAt: DONE, kind: 'warmup', weightKg: 40, reps: 10 }), sessionId: 'last' },
    { ...set('bench', 0, 2, { completedAt: null, weightKg: 85 }), sessionId: 'last' },
    { ...set('bench', 0, 0, { completedAt: DONE, weightKg: 90 }), sessionId: 's1' },
  ];

  it('takes the newest other session\'s done sets, in order', () => {
    const prev = previousSets(history, sessions, 's1');
    expect(prev.map(s => s.weightKg)).toEqual([40, 80]);
  });

  it('is empty for an exercise never done', () => {
    expect(previousSets([], sessions, 's1')).toEqual([]);
  });

  it('matches warm-up to warm-up and working set to working set', () => {
    const prev = previousSets(history, sessions, 's1');
    const current = [
      set('bench', 0, 0, { kind: 'warmup' }),
      set('bench', 0, 1, { kind: 'warmup' }),
      set('bench', 0, 2),
      set('bench', 0, 3),
    ];
    const matched = matchPrevious(current, prev);
    expect(current.map(s => matched.get(s.id)?.weightKg ?? null)).toEqual([40, null, 80, null]);
  });
});

describe('matchPreviousByPosition', () => {
  const last = [
    set('bench', 0, 0, { kind: 'warmup', weightKg: 40 }),
    set('bench', 0, 1, { weightKg: 80, reps: 10 }),
    set('bench', 0, 2, { weightKg: 80, reps: 10 }),
    set('bench', 0, 3, { kind: 'amrap', weightKg: 80, reps: 14 }),
  ];
  const repsFor = (current: ReturnType<typeof set>[]) => {
    const m = matchPreviousByPosition(current, last);
    return current.map(s => m.get(s.id)?.reps ?? null);
  };

  it('pairs a third ordinary set with last time\'s set to failure', () => {
    const current = [set('bench', 0, 0, { kind: 'warmup' }), set('bench', 0, 1), set('bench', 0, 2), set('bench', 0, 3)];
    expect(repsFor(current)).toEqual([8, 10, 10, 14]);
  });

  it('gives a row the same previous whichever kind it is labelled', () => {
    const asWorking = [set('bench', 0, 0), set('bench', 0, 1), set('bench', 0, 2)];
    const asFailure = [set('bench', 0, 0), set('bench', 0, 1), set('bench', 0, 2, { kind: 'amrap' })];
    expect(repsFor(asWorking)).toEqual(repsFor(asFailure));
  });

  it('keeps warm-ups to their own pool', () => {
    const current = [set('bench', 0, 0), set('bench', 0, 1, { kind: 'warmup' })];
    const m = matchPreviousByPosition(current, last);
    expect(m.get(current[0].id)?.reps).toBe(10);
    expect(m.get(current[1].id)?.weightKg).toBe(40);
  });

  it('is null when there is nothing left to pair', () => {
    const current = [1, 2, 3, 4, 5].map(i => set('bench', 0, i));
    expect(repsFor(current)).toEqual([10, 10, 14, null, null]);
  });
});

describe('previousBadge', () => {
  it('marks a set to failure or a drop set, and nothing else', () => {
    expect(previousBadge({ kind: 'amrap' })).toBe('F');
    expect(previousBadge({ kind: 'drop' })).toBe('D');
    expect(previousBadge({ kind: 'working' })).toBeNull();
    expect(previousBadge({ kind: 'warmup' })).toBeNull();
  });
});

describe('repeatedSets', () => {
  it('lays out the done sets again, warm-ups included, in their order from position zero', () => {
    const done = [
      set('row', 4, 1, { weightKg: 50, reps: 10, completedAt: DONE }),
      set('row', 4, 0, { kind: 'warmup', weightKg: 30, reps: 12, completedAt: DONE }),
      set('bench', 2, 0, { weightKg: 80, reps: 8, completedAt: DONE, supersetKey: 'ss' }),
      // Planned and never ticked: not part of what was done.
      set('bench', 2, 1, { weightKg: 80, reps: 8 }),
      set('fly', 3, 0),
    ];
    expect(repeatedSets(done).map(p => [p.exerciseId, p.position, p.setIndex, p.values.kind, p.values.weightKg, p.values.reps, p.values.supersetKey]))
      .toEqual([
        ['bench', 0, 0, 'working', 80, 8, 'ss'],
        ['row', 1, 0, 'warmup', 30, 12, null],
        ['row', 1, 1, 'working', 50, 10, null],
      ]);
  });

  it('lays out nothing for a workout with no set done', () => {
    expect(repeatedSets([set('bench', 0, 0)])).toEqual([]);
  });
});

describe('laying sets out', () => {
  const previous = [
    set('bench', 0, 0, { kind: 'warmup', weightKg: 40, reps: 10, completedAt: DONE }),
    set('bench', 0, 1, { weightKg: 80, reps: 8, completedAt: DONE }),
    set('bench', 0, 2, { weightKg: 80, reps: 7, completedAt: DONE }),
  ];

  it('fills a target from the routine where it names a weight, else from last time', () => {
    const planned = plannedSetsFor({
      supersetKey: 'ss',
      targets: [
        { kind: 'warmup', repsMin: null, repsMax: null },
        { kind: 'working', repsMin: 6, repsMax: 8, weightKg: 82.5 },
        { kind: 'working', repsMin: 6, repsMax: 8 },
        { kind: 'working', repsMin: 6, repsMax: 8 },
      ],
    }, previous);
    expect(planned.map(p => [p.kind, p.weightKg, p.reps])).toEqual([
      ['warmup', 40, 10],
      ['working', 82.5, 8],
      ['working', 80, 7],
      // No third working set last time: no weight, and the top of the range.
      ['working', null, 8],
    ]);
    expect(planned.every(p => p.supersetKey === 'ss')).toBe(true);
  });

  it('lays out a ramp ahead of the work from the first working weight', () => {
    const ramp = (kg: number | null) => (kg === null ? [] : [{ kg: kg / 2, reps: 8 }, { kg: kg * 0.75, reps: 4 }]);
    const item = { warmupRamp: true, targets: [{ kind: 'working' as const, repsMin: 6, repsMax: 8, weightKg: 80 }] };
    expect(plannedSetsFor(item, [], ramp).map(p => [p.kind, p.weightKg, p.reps])).toEqual([
      ['warmup', 40, 8], ['warmup', 60, 4], ['working', 80, 8],
    ]);
    // No weight to ramp to, no ramp; and an item without one ignores it.
    expect(plannedSetsFor({ ...item, targets: [{ kind: 'working', repsMin: 6, repsMax: 8 }] }, [], ramp)).toHaveLength(1);
    expect(plannedSetsFor({ targets: item.targets }, [], ramp)).toHaveLength(1);
  });

  it('lays out last time again for an exercise added mid-session, or one empty set', () => {
    expect(plannedSetsFromHistory(previous).map(p => p.weightKg)).toEqual([40, 80, 80]);
    expect(plannedSetsFromHistory([])).toEqual([
      { kind: 'working', weightKg: null, reps: null, durationSeconds: null, distanceM: null, supersetKey: null },
    ]);
  });

  it('adds a set like the last one, and a warm-up copied becomes work', () => {
    expect(copyLastSet(previous)).toMatchObject({ kind: 'working', weightKg: 80, reps: 7 });
    expect(copyLastSet([previous[0]])).toMatchObject({ kind: 'working', weightKg: 40 });
    expect(copyLastSet([set('x', 0, 0, { kind: 'drop', weightKg: 50 })])).toMatchObject({ kind: 'drop' });
    expect(copyLastSet([]).weightKg).toBeNull();
  });

  it('copies the done set nearest above onto an open one', () => {
    const sets = [previous[1], { ...previous[2], completedAt: null }, set('bench', 0, 3)];
    expect(valuesFromLastDone(sets, sets[2].id)).toEqual({ weightKg: 80, reps: 8, durationSeconds: null, distanceM: null });
    expect(valuesFromLastDone([set('bench', 0, 0)], 'nope')).toBeNull();
  });
});

describe('what a set records, and how it reads', () => {
  it('uses the fields the exercise\'s kind takes', () => {
    expect(setFieldsFor('weight_reps')).toEqual(['weight', 'reps']);
    expect(setFieldsFor('bodyweight_reps')).toEqual(['reps']);
    expect(setFieldsFor('duration')).toEqual(['duration']);
    expect(setFieldsFor('weight_distance')).toEqual(['weight', 'distance']);
  });

  it('writes a set as one short line, in the unit shown', () => {
    expect(formatSetLine({ weightKg: 80, reps: 8, durationSeconds: null, distanceM: null }, 'weight_reps', 'kg')).toBe('80 × 8');
    expect(formatSetLine({ weightKg: 61.235, reps: 5, durationSeconds: null, distanceM: null }, 'weight_reps', 'lb')).toBe('135 × 5');
    expect(formatSetLine({ weightKg: null, reps: 12, durationSeconds: null, distanceM: null }, 'bodyweight_reps', 'kg')).toBe('12 reps');
    expect(formatSetLine({ weightKg: null, reps: null, durationSeconds: 45, distanceM: null }, 'duration', 'kg')).toBe('0:45');
    expect(formatSetLine({ weightKg: 24, reps: null, durationSeconds: null, distanceM: 40 }, 'weight_distance', 'kg')).toBe('24 × 40 m');
    expect(formatSetLine({ weightKg: null, reps: null, durationSeconds: null, distanceM: null }, 'weight_reps', 'kg')).toBeNull();
    expect(formatDistance(1500)).toBe('1.5 km');
  });

  it('names the unit on the weight when asked, and an assisted weight as the assistance', () => {
    const line = (weightKg: number | null, reps: number | null, kind: Parameters<typeof formatSetLine>[1], distanceM: number | null = null) =>
      formatSetLine({ weightKg, reps, durationSeconds: null, distanceM }, kind, 'kg', true);
    expect(line(82.5, 8, 'weight_reps')).toBe('82.5 kg × 8');
    expect(formatSetLine({ weightKg: 61.235, reps: 5, durationSeconds: null, distanceM: null }, 'weight_reps', 'lb', true)).toBe('135 lb × 5');
    expect(line(20, 8, 'assisted_reps')).toBe('−20 kg × 8');
    expect(line(0, 8, 'assisted_reps')).toBe('0 kg × 8');
    expect(line(24, null, 'weight_distance', 40)).toBe('24 kg × 40 m');
    expect(line(null, 12, 'bodyweight_reps')).toBe('12 reps');
    expect(line(null, null, 'weight_reps')).toBeNull();
  });

  it('numbers the working sets and letters the rest', () => {
    const sets = [
      set('a', 0, 0, { kind: 'warmup' }), set('a', 0, 1), set('a', 0, 2, { kind: 'amrap' }), set('a', 0, 3, { kind: 'drop' }),
    ];
    const labels = setLabels(sets);
    expect(sets.map(s => labels.get(s.id))).toEqual(['W', '1', 'F', 'D']);
    expect(sets.map(s => setName(s.kind, labels.get(s.id)!))).toEqual(['Warm-up', 'Set 1', 'To failure', 'Drop set']);
  });

  it('heads a weight column with the unit, minus for assistance, and names it in words', () => {
    expect(columnLabel('weight', 'weight_reps', 'kg')).toBe('kg');
    expect(columnLabel('weight', 'assisted_reps', 'lb')).toBe('−lb');
    expect(columnLabel('reps', 'weight_reps', 'kg')).toBe('Reps');
    expect(fieldLabel('weight', 'assisted_reps')).toBe('Assistance');
    expect(fieldLabel('duration', 'duration')).toBe('Time');
  });
});

describe('finishing', () => {
  it('drops the sets never ticked and counts the ones that were', () => {
    const plan = finishPlan(session());
    expect(plan.loggedCount).toBe(2);
    expect(plan.dropSetIds).toHaveLength(7);
  });

  it('sums up time, sets and each exercise\'s heaviest set, from what was ticked only', () => {
    const sets = [
      set('bench', 0, 0, { kind: 'warmup', weightKg: 100, completedAt: DONE }),
      set('bench', 0, 1, { weightKg: 80, reps: 8, completedAt: DONE }),
      set('bench', 0, 2, { weightKg: 82.5, reps: 6, completedAt: DONE }),
      set('bench', 0, 3, { weightKg: 82.5, reps: 7, completedAt: DONE }),
      set('bench', 0, 4, { weightKg: 200 }),
      set('plank', 1, 0, { weightKg: null, reps: null, durationSeconds: 60, completedAt: DONE }),
      set('skipped', 2, 0),
    ];
    const summary = sessionSummary(
      { startedAt: '2026-10-07T18:00:00.000Z', endedAt: '2026-10-07T18:52:40.000Z' }, sets,
    );
    expect(summary.minutes).toBe(52);
    expect(summary.setsDone).toBe(5);
    expect(summary.exercises.map(e => e.exerciseId)).toEqual(['bench', 'plank']);
    // The warm-up is heavier but is not the top set; ties on weight go to more reps.
    expect(summary.exercises[0]).toMatchObject({ sets: 4, heaviest: { weightKg: 82.5, reps: 7 } });
    expect(summary.exercises[1].heaviest).toBeNull();
  });

  it('counts a workout in whole minutes, to now while it is live, and never below zero', () => {
    expect(sessionMinutes({ startedAt: '2026-10-07T18:00:00.000Z', endedAt: '2026-10-07T18:52:59.000Z' })).toBe(52);
    expect(sessionMinutes({ startedAt: '2026-10-07T18:00:00.000Z', endedAt: null }, new Date('2026-10-07T18:10:30.000Z'))).toBe(10);
    expect(sessionMinutes({ startedAt: '2026-10-07T18:00:00.000Z', endedAt: '2026-10-07T17:59:00.000Z' })).toBe(0);
  });
});

describe('exerciseBlocks', () => {
  it('makes a superset one block and every other exercise its own', () => {
    expect(exerciseBlocks(session()).map(b => b.map(e => e.exerciseId))).toEqual([['bench'], ['incline', 'fly'], ['triceps']]);
  });

  it('is empty for no sets', () => {
    expect(exerciseBlocks([])).toEqual([]);
  });
});
