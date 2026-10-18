import type { Task, WorkoutProgram, WorkoutSession } from '../types';
import {
  MAX_ROUTINE_INDEX_ENTRIES,
  buildRoutineIndex,
  newestWorkoutStart,
  parseQueuedWorkoutStarts,
  QUEUED_START_MAX_AGE_MS,
  resolveQueuedWorkoutStart,
  type QueuedWorkoutStart,
} from '../utils/workoutSiri';

describe('buildRoutineIndex', () => {
  it('lists every named routine, sorted by name so an unchanged list writes the same bytes', () => {
    const routines = [
      { id: 'r2', name: 'Push A' },
      { id: 'r1', name: ' Legs ' },
      { id: 'r3', name: 'Pull A' },
    ];
    expect(buildRoutineIndex(routines, true)).toEqual([
      { id: 'r1', name: 'Legs' },
      { id: 'r3', name: 'Pull A' },
      { id: 'r2', name: 'Push A' },
    ]);
    expect(JSON.stringify(buildRoutineIndex([...routines].reverse(), true))).toBe(JSON.stringify(buildRoutineIndex(routines, true)));
  });

  it('leaves out a routine with no name to say', () => {
    expect(buildRoutineIndex([{ id: 'r1', name: '   ' }, { id: 'r2', name: 'Push A' }], true)).toEqual([{ id: 'r2', name: 'Push A' }]);
  });

  it('is empty while the Workouts area is off', () => {
    expect(buildRoutineIndex([{ id: 'r2', name: 'Push A' }], false)).toEqual([]);
  });

  it('stops at the ceiling', () => {
    const many = Array.from({ length: MAX_ROUTINE_INDEX_ENTRIES + 5 }, (_, i) => ({ id: `r${i}`, name: `Routine ${String(i).padStart(3, '0')}` }));
    expect(buildRoutineIndex(many, true)).toHaveLength(MAX_ROUTINE_INDEX_ENTRIES);
  });
});

describe('parseQueuedWorkoutStarts', () => {
  it('reads both kinds of start, with nulls (or absent keys) for "my workout"', () => {
    const json = JSON.stringify([
      { at: '2026-10-18T09:00:00Z' },
      { routineId: 'r1', name: 'Push A', at: '2026-10-18T09:01:00Z' },
      { routineId: null, name: null, at: 'not a date' },
    ]);
    expect(parseQueuedWorkoutStarts(json)).toEqual([
      { routineId: null, name: null, at: new Date('2026-10-18T09:00:00Z') },
      { routineId: 'r1', name: 'Push A', at: new Date('2026-10-18T09:01:00Z') },
      { routineId: null, name: null, at: null },
    ]);
  });

  it('drops anything malformed rather than throwing', () => {
    expect(parseQueuedWorkoutStarts('nope')).toEqual([]);
    expect(parseQueuedWorkoutStarts('{}')).toEqual([]);
    expect(parseQueuedWorkoutStarts(JSON.stringify([null, 3, { routineId: 5 }, { name: ['x'] }]))).toEqual([]);
  });

  it('reads a blank name or id as none', () => {
    expect(parseQueuedWorkoutStarts(JSON.stringify([{ routineId: ' ', name: '  ' }]))).toEqual([{ routineId: null, name: null, at: null }]);
  });
});

describe('newestWorkoutStart', () => {
  it('is the last one queued', () => {
    const a: QueuedWorkoutStart = { routineId: 'r1', name: 'Push A', at: null };
    const b: QueuedWorkoutStart = { routineId: null, name: null, at: null };
    expect(newestWorkoutStart([a, b])).toBe(b);
    expect(newestWorkoutStart([])).toBeNull();
  });
});

describe('resolveQueuedWorkoutStart', () => {
  const NOW = new Date('2026-10-18T09:00:00Z');
  const myWorkout: QueuedWorkoutStart = { routineId: null, name: null, at: NOW };
  const routines = [{ id: 'r1', name: 'Push A' }, { id: 'r2', name: 'Pull A' }, { id: 'r3', name: 'Legs' }];
  const program = (extra: Partial<WorkoutProgram> = {}): WorkoutProgram => ({
    id: 'p1',
    name: 'Push/Pull/Legs',
    weeks: null,
    rotation: ['r1', 'r2', 'r3'],
    scheme: 'double',
    trainingMaxes: [],
    startedAt: null,
    archived: false,
    createdAt: '2026-10-01T00:00:00Z',
    ...extra,
  });
  const finished = (routineId: string, programId: string | null = 'p1'): Pick<WorkoutSession, 'programId' | 'routineId' | 'endedAt' | 'startedAt'> =>
    ({ routineId, programId, startedAt: '2026-10-10T09:00:00Z', endedAt: '2026-10-10T10:00:00Z' });
  const task = (id: string, extra: Partial<Task> = {}): Task =>
    ({ id, title: id, completed: false, archived: false, workoutRoutineId: null, workoutProgramId: null, ...extra }) as Task;
  const ctx = (extra: Partial<Parameters<typeof resolveQueuedWorkoutStart>[1]> = {}): Parameters<typeof resolveQueuedWorkoutStart>[1] => ({
    workoutsEnabled: true,
    live: null,
    routines,
    programs: [],
    sessions: [],
    todayTasks: [],
    now: NOW,
    ...extra,
  });

  it('does nothing with the Workouts area off, or nothing queued', () => {
    expect(resolveQueuedWorkoutStart([myWorkout], ctx({ workoutsEnabled: false }))).toEqual({ kind: 'none' });
    expect(resolveQueuedWorkoutStart([{ routineId: 'r1', name: 'Push A', at: NOW }], ctx({ workoutsEnabled: false }))).toEqual({ kind: 'none' });
    expect(resolveQueuedWorkoutStart([], ctx())).toEqual({ kind: 'none' });
  });

  describe('a routine by name', () => {
    it('starts the routine the entity query picked', () => {
      expect(resolveQueuedWorkoutStart([{ routineId: 'r2', name: 'Pull A', at: NOW }], ctx()))
        .toEqual({ kind: 'start', input: { routineId: 'r2', taskId: null } });
    });

    it('falls back to the spoken name when the id has gone, with the area’s own name key', () => {
      expect(resolveQueuedWorkoutStart([{ routineId: 'gone', name: '  pull   a ', at: NOW }], ctx()))
        .toEqual({ kind: 'start', input: { routineId: 'r2', taskId: null } });
    });

    it('starts it for the task on Today that names it, so finishing completes that task', () => {
      const today = [task('t0', { workoutRoutineId: 'r1' }), task('t1', { workoutRoutineId: 'r2' })];
      expect(resolveQueuedWorkoutStart([{ routineId: 'r2', name: 'Pull A', at: NOW }], ctx({ todayTasks: today })))
        .toEqual({ kind: 'start', input: { routineId: 'r2', taskId: 't1' } });
    });

    it('opens the Workouts screen for a routine nothing matches', () => {
      expect(resolveQueuedWorkoutStart([{ routineId: 'gone', name: 'Arms', at: NOW }], ctx())).toEqual({ kind: 'openWorkouts' });
    });

    it('leaves a workout already going to startWorkout to speak about', () => {
      expect(resolveQueuedWorkoutStart([{ routineId: 'r1', name: 'Push A', at: NOW }], ctx({ live: { id: 'w1', routineId: 'r2' } })))
        .toEqual({ kind: 'start', input: { routineId: 'r1', taskId: null } });
    });
  });

  it('just opens the routine asked for when it is the one already going', () => {
    expect(resolveQueuedWorkoutStart([{ routineId: 'r1', name: 'Push A', at: NOW }], ctx({ live: { id: 'w1', routineId: 'r1' } })))
      .toEqual({ kind: 'showLive' });
  });

  it('drops a start asked for too long ago, or with no time', () => {
    const late = new Date(NOW.getTime() - QUEUED_START_MAX_AGE_MS - 1000);
    const recent = new Date(NOW.getTime() - QUEUED_START_MAX_AGE_MS + 1000);
    expect(resolveQueuedWorkoutStart([{ ...myWorkout, at: late }], ctx({ programs: [program()] }))).toEqual({ kind: 'none' });
    expect(resolveQueuedWorkoutStart([{ ...myWorkout, at: null }], ctx({ programs: [program()] }))).toEqual({ kind: 'none' });
    expect(resolveQueuedWorkoutStart([{ ...myWorkout, at: recent }], ctx({ programs: [program()] })))
      .toEqual({ kind: 'start', input: { programId: 'p1' } });
  });

  describe('"my workout"', () => {
    it('opens the workout already going first', () => {
      const today = [task('t1', { workoutRoutineId: 'r2' })];
      expect(resolveQueuedWorkoutStart([myWorkout], ctx({ live: { id: 'w1', routineId: null }, todayTasks: today }))).toEqual({ kind: 'showLive' });
    });

    it('then starts the first workout task on Today, in Today’s order, for that task', () => {
      const today = [
        task('plain'),
        task('done', { workoutRoutineId: 'r1', completed: true }),
        task('t1', { workoutRoutineId: 'r2' }),
        task('t2', { workoutRoutineId: 'r3' }),
      ];
      expect(resolveQueuedWorkoutStart([myWorkout], ctx({ todayTasks: today })))
        .toEqual({ kind: 'start', input: { routineId: 'r2', taskId: 't1' } });
    });

    it('starts a program task’s next routine through its program', () => {
      const today = [task('t1', { workoutProgramId: 'p1' })];
      expect(resolveQueuedWorkoutStart([myWorkout], ctx({ todayTasks: today, programs: [program()] })))
        .toEqual({ kind: 'start', input: { programId: 'p1', taskId: 't1' } });
    });

    it('passes over a task whose program is archived or has nothing next', () => {
      const today = [task('t0', { workoutProgramId: 'p0' }), task('t1', { workoutProgramId: 'p2' }), task('t2', { workoutRoutineId: 'r3' })];
      const programs = [program({ id: 'p0', archived: true }), program({ id: 'p2', rotation: [] })];
      expect(resolveQueuedWorkoutStart([myWorkout], ctx({ todayTasks: today, programs })))
        .toEqual({ kind: 'start', input: { routineId: 'r3', taskId: 't2' } });
    });

    it('passes over a task whose routine or program is gone', () => {
      const today = [task('t0', { workoutRoutineId: 'gone' }), task('t1', { workoutProgramId: 'gone' }), task('t2', { workoutRoutineId: 'r3' })];
      expect(resolveQueuedWorkoutStart([myWorkout], ctx({ todayTasks: today })))
        .toEqual({ kind: 'start', input: { routineId: 'r3', taskId: 't2' } });
    });

    it('with no workout task, starts the one program’s next routine', () => {
      const plan = resolveQueuedWorkoutStart([myWorkout], ctx({ programs: [program()], sessions: [finished('r1')] }));
      expect(plan).toEqual({ kind: 'start', input: { programId: 'p1' } });
    });

    it('counts only programs in use, and opens the Workouts screen with several or none', () => {
      expect(resolveQueuedWorkoutStart([myWorkout], ctx({ programs: [program(), program({ id: 'p0', archived: true })] })))
        .toEqual({ kind: 'start', input: { programId: 'p1' } });
      expect(resolveQueuedWorkoutStart([myWorkout], ctx({ programs: [program(), program({ id: 'p2' })] }))).toEqual({ kind: 'openWorkouts' });
      expect(resolveQueuedWorkoutStart([myWorkout], ctx())).toEqual({ kind: 'openWorkouts' });
    });

    it('opens the Workouts screen for a program with nothing in its rotation', () => {
      expect(resolveQueuedWorkoutStart([myWorkout], ctx({ programs: [program({ rotation: [] })] }))).toEqual({ kind: 'openWorkouts' });
    });
  });

  it('acts on the newest start only, however many were queued', () => {
    const queued: QueuedWorkoutStart[] = [
      { routineId: 'r1', name: 'Push A', at: NOW },
      { routineId: 'r3', name: 'Legs', at: NOW },
    ];
    expect(resolveQueuedWorkoutStart(queued, ctx())).toEqual({ kind: 'start', input: { routineId: 'r3', taskId: null } });
  });
});
