import type { Exercise, WorkoutProgram, WorkoutRoutine, WorkoutSession, WorkoutSet } from '../../../src/types';
import type { Replica } from '../replica';
import { DEFAULT_EXERCISE_LIMIT, TREND_POINTS, exerciseHistory, listExercises, listWorkouts } from '../workoutTools';

const custom: Exercise = {
  id: 'c1', name: 'Landmine row', kind: 'weight_reps', primaryMuscles: ['upper_back'], secondaryMuscles: [],
  equipment: 'barbell', barKg: null, notes: 'V handle', archived: false, isCustom: true, createdAt: '2026-10-01T10:00:00.000Z',
};
const session = (id: string, startedAt: string, extra: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id, routineId: 'r1', programId: 'p1', taskId: null, title: 'Upper A', startedAt, endedAt: startedAt, notes: '',
  effort: 7, healthWorkoutId: null, healthWritePending: false, ...extra,
});
const set = (id: string, exerciseId: string, extra: Partial<WorkoutSet> = {}): WorkoutSet => ({
  id, sessionId: 's1', exerciseId, position: 0, setIndex: 0, kind: 'working', weightKg: 60, reps: 8,
  durationSeconds: null, distanceM: null, rpe: null, completedAt: '2026-10-07T18:10:00.000Z', supersetKey: null, note: null, ...extra,
});
const routine: WorkoutRoutine = {
  id: 'r1', name: 'Upper A', notes: '', programId: 'p1', sortOrder: 0, createdAt: '2026-10-01T10:00:00.000Z',
  items: [{ exerciseId: 'lib:barbell-bench-press', supersetKey: null, restSeconds: 150, progression: null,
    targets: [{ kind: 'working', repsMin: 6, repsMax: 8, weightKg: 60 }] }],
};
const program: WorkoutProgram = {
  id: 'p1', name: 'Upper and lower', weeks: 8, rotation: ['r1', 'gone'], scheme: 'double',
  trainingMaxes: [{ exerciseId: 'lib:back-squat', kg: 120 }], startedAt: null, archived: false, createdAt: '2026-10-01T10:00:00.000Z',
};

const allSets: WorkoutSet[] = [
  set('o1', 'lib:barbell-bench-press', { sessionId: 's0', weightKg: 80, reps: 8, completedAt: '2026-09-01T18:10:00.000Z' }),
  set('o0', 'lib:barbell-bench-press', { sessionId: 's0', kind: 'warmup', weightKg: 40, reps: 10, setIndex: 0, completedAt: '2026-09-01T18:05:00.000Z' }),
  set('a', 'lib:barbell-bench-press', { weightKg: 82.5, reps: 8 }),
  set('b', 'lib:barbell-bench-press', { setIndex: 1, weightKg: 82.5, reps: 7 }),
  set('p', 'lib:barbell-bench-press', { setIndex: 2, weightKg: 82.5, reps: 8, completedAt: null }),
];

function fakeReplica(over: Partial<Replica> = {}): Replica {
  const sessions = [session('s1', '2026-10-07T18:00:00.000Z'), session('s0', '2026-09-01T18:00:00.000Z')];
  return {
    exercises: () => [custom],
    workoutRoutines: () => [routine],
    workoutPrograms: () => [program],
    workoutSessions: (from: string, to: string) => sessions.filter(s => s.startedAt.slice(0, 10) >= from && s.startedAt.slice(0, 10) <= to),
    workoutSets: (id: string) => (id === 's1'
      ? [set('a', 'lib:barbell-bench-press'), set('b', 'lib:barbell-bench-press', { setIndex: 1, reps: 7 }), set('c', 'c1', { position: 1, completedAt: null })]
      : []),
    workoutSession: (id: string) => sessions.find(x => x.id === id) ?? null,
    workoutExerciseSets: (id: string) => allSets.filter(x => x.exerciseId === id),
    todayKey: () => '2026-10-08',
    shiftDayKey: (key: string, days: number) => {
      const d = new Date(`${key}T12:00:00`);
      d.setDate(d.getDate() + days);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    logicalDayKeyOf: (iso: string) => iso.slice(0, 10),
    ...over,
  } as unknown as Replica;
}

describe('list_exercises', () => {
  it('lists the library with the person\'s own exercises, capped, and says how many matched', () => {
    const result = listExercises(fakeReplica());
    expect(result.exercises).toHaveLength(DEFAULT_EXERCISE_LIMIT);
    expect(result.total).toBeGreaterThan(150);
    expect(result.note).toMatch(/Showing 50/);
  });

  it('marks a custom exercise and carries the library cue on a built-in', () => {
    const { exercises } = listExercises(fakeReplica(), { query: 'row', equipment: 'barbell', limit: 250 });
    expect(exercises.find(e => e.id === 'c1')).toMatchObject({ name: 'Landmine row', custom: true, notes: 'V handle' });
    const barbellRow = exercises.find(e => e.id === 'lib:barbell-row');
    expect(barbellRow?.cue).toBeTruthy();
    expect(barbellRow?.custom).toBeUndefined();
  });

  it('narrows by muscle', () => {
    const { exercises } = listExercises(fakeReplica(), { muscle: 'calves', limit: 250 });
    expect(exercises.length).toBeGreaterThan(0);
    expect(exercises.every(e => e.primaryMuscles.includes('calves'))).toBe(true);
  });

  it('leaves archived exercises out unless asked', () => {
    const replica = fakeReplica({ exercises: () => [{ ...custom, archived: true }] });
    expect(listExercises(replica, { query: 'landmine row' }).exercises).toEqual([]);
    expect(listExercises(replica, { query: 'landmine row', includeArchived: true }).exercises).toEqual([
      expect.objectContaining({ id: 'c1', archived: true }),
    ]);
  });
});

describe('list_workouts', () => {
  it('lists the range\'s workouts with their sets grouped by exercise, in kg', () => {
    const result = listWorkouts(fakeReplica());
    expect(result.range).toEqual({ from: '2026-10-02', to: '2026-10-08' });
    expect(result.workouts).toHaveLength(1);
    const [w] = result.workouts;
    expect(w).toMatchObject({ id: 's1', title: 'Upper A', date: '2026-10-07', routine: 'Upper A', program: 'Upper and lower', effort: 7 });
    expect(w.exercises.map(e => [e.name, e.sets.length])).toEqual([['Barbell bench press', 2], ['Landmine row', 1]]);
    expect(w.exercises[0].sets[1]).toEqual({ kind: 'working', weightKg: 60, reps: 7, done: true });
    expect(w.exercises[1].sets[0].done).toBe(false);
    expect(result.note).toBeUndefined();
  });

  it('says a live workout is in progress', () => {
    const replica = fakeReplica({ workoutSessions: () => [session('s1', '2026-10-08T18:00:00.000Z', { endedAt: null })] });
    expect(listWorkouts(replica).workouts[0]).toMatchObject({ inProgress: true });
  });

  it('reports the routines and programs whatever the health switch says', () => {
    const result = listWorkouts(fakeReplica({ workoutSessions: () => [] }));
    expect(result.workouts).toEqual([]);
    expect(result.note).toMatch(/Include health logs/);
    expect(result.routines[0]).toMatchObject({ name: 'Upper A', program: 'Upper and lower' });
    expect(result.routines[0].exercises[0]).toMatchObject({ name: 'Barbell bench press', restSeconds: 150 });
    expect(result.programs[0]).toMatchObject({
      name: 'Upper and lower', rotation: ['Upper A', 'A deleted routine'],
      trainingMaxes: [{ exerciseId: 'lib:back-squat', name: 'Barbell back squat', kg: 120 }],
    });
  });
});

describe('exercise_history', () => {
  const BENCH = 'lib:barbell-bench-press';

  it('reports the records, the estimated 1RM trend and the last session', () => {
    const result = exerciseHistory(fakeReplica(), { exerciseId: BENCH });
    expect(result.exercise).toMatchObject({ id: BENCH, name: 'Barbell bench press', kind: 'weight_reps' });
    expect(result).toMatchObject({ sessions: 2, firstDate: '2026-09-01', lastDate: '2026-10-07' });
    expect(result.personalRecords.find(r => r.type === 'e1rm')).toEqual({
      record: 'Estimated 1RM', type: 'e1rm', value: 104.5, unit: 'kg', date: '2026-10-07', estimated: true,
    });
    expect(result.personalRecords.find(r => r.type === 'weight')).toMatchObject({ value: 82.5, unit: 'kg', reps: 8, date: '2026-10-07' });
    expect(result.estimatedOneRepMaxTrend).toEqual([
      { date: '2026-09-01', estimatedKg: 101.3 }, { date: '2026-10-07', estimatedKg: 104.5 },
    ]);
    expect(result.trendNote).toMatch(/Estimated, not lifted/);
  });

  it('shows the last session\'s sets, planned ones marked not done, warm-ups kept', () => {
    const { lastSession } = exerciseHistory(fakeReplica(), { exerciseId: BENCH });
    expect(lastSession).toMatchObject({ id: 's1', title: 'Upper A', date: '2026-10-07' });
    expect(lastSession!.sets.map(s => [s.weightKg, s.reps])).toEqual([[82.5, 8], [82.5, 7]]);
  });

  it('keeps warm-ups out of the records', () => {
    const result = exerciseHistory(fakeReplica(), { exerciseId: BENCH });
    expect(result.personalRecords.some(r => r.value === 40)).toBe(false);
  });

  it('names a record\'s unit by what the exercise measures', () => {
    const replica = fakeReplica({
      workoutExerciseSets: () => [
        set('x', 'lib:pull-up', { weightKg: null, reps: 8 }),
        set('y', 'lib:pull-up', { sessionId: 's0', weightKg: null, reps: 6, completedAt: '2026-09-01T18:10:00.000Z' }),
      ],
    });
    const result = exerciseHistory(replica, { exerciseId: 'lib:pull-up' });
    expect(result.estimatedOneRepMaxTrend).toBeUndefined();
    expect(result.personalRecords.map(r => [r.type, r.unit, r.value])).toEqual([['best', 'reps', 8], ['volume', 'reps', 8]]);
  });

  it('says the history may be withheld when there are no sets', () => {
    const result = exerciseHistory(fakeReplica({ workoutExerciseSets: () => [] }), { exerciseId: BENCH });
    expect(result).toMatchObject({ sessions: 0, personalRecords: [] });
    expect(result.note).toMatch(/Include health logs/);
  });

  it('refuses an exercise nobody knows, pointing at list_exercises', () => {
    expect(() => exerciseHistory(fakeReplica(), { exerciseId: 'nope' })).toThrow(/list_exercises/);
  });

  it('caps the trend', () => {
    const many: WorkoutSet[] = [];
    const sessions: WorkoutSession[] = [];
    for (let i = 0; i < TREND_POINTS + 5; i++) {
      const day = `2026-0${1 + Math.floor(i / 28)}-${String(1 + (i % 28)).padStart(2, '0')}`;
      sessions.push(session(`m${i}`, `${day}T18:00:00.000Z`));
      many.push(set(`m${i}`, BENCH, { sessionId: `m${i}`, weightKg: 60 + i, reps: 5, completedAt: `${day}T18:10:00.000Z` }));
    }
    const replica = fakeReplica({ workoutSessions: () => sessions, workoutExerciseSets: () => many });
    expect(exerciseHistory(replica, { exerciseId: BENCH }).estimatedOneRepMaxTrend).toHaveLength(TREND_POINTS);
  });
});
