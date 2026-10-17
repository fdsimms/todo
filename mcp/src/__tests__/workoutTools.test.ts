import type { Exercise, WorkoutProgram, WorkoutRoutine, WorkoutSession, WorkoutSet } from '../../../src/types';
import type { Replica } from '../replica';
import { DEFAULT_EXERCISE_LIMIT, listExercises, listWorkouts } from '../workoutTools';

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
