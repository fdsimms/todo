/**
 * The workout write tools against a real replica, since every write goes
 * through `useWorkoutStore`'s own actions and a stub would test the stub. The
 * store's own rules are tested where it lives; this holds what the tools add,
 * say and refuse, and that each write lands in Activity.
 */
import { openShimDatabase, type ShimDatabase } from '../expoSqliteShim';
import { openReplica } from '../replica';
import { withAgentLedger, type AgentLedgerEntry } from '../agentLedger';
import {
  deleteRoutine, deleteWorkout, listWorkouts, logWorkout, routineItemsFrom, saveRoutine, updateWorkout,
} from '../workoutTools';
import { createTask, getTask, updateTask } from '../tools';

let mockRaw: ShimDatabase;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { openShimDatabase } = require('../expoSqliteShim');
  mockRaw = openShimDatabase(':memory:');
  return { openDatabaseSync: () => mockRaw };
});

const BENCH = 'lib:barbell-bench-press';
const FLY = 'lib:cable-fly';

describe('the workout write tools', () => {
  let replica: ReturnType<typeof openReplica>;
  let entries: AgentLedgerEntry[];
  let ledgered: ReturnType<typeof openReplica>;

  beforeAll(() => {
    replica = openReplica(':memory:');
  });

  beforeEach(() => {
    for (const t of ['workout_routines', 'workout_sessions', 'workout_sets', 'exercises']) mockRaw.runSync(`DELETE FROM ${t}`);
    replica.refresh();
    entries = [];
    ledgered = withAgentLedger(replica, e => { entries.push(...e); });
  });

  describe('save_routine', () => {
    it('creates a routine with its sets, supersets and scheme, and lists it', () => {
      const { routine, note } = saveRoutine(ledgered, {
        name: '  Push A ',
        notes: 'Heavy day',
        exercises: [
          { exerciseId: BENCH, restSeconds: 150, progression: 'double', sets: [
            { kind: 'warmup' }, { repsMin: 6, repsMax: 8 }, { repsMin: 6, repsMax: 8, weightKg: 85 },
          ] },
          { exerciseId: 'lib:incline-dumbbell-bench-press', sets: [{ repsMin: 10, repsMax: 12 }] },
          { exerciseId: FLY, supersetWithPrevious: true, sets: [{ repsMin: 12 }] },
        ],
      });
      expect(routine).toMatchObject({ name: 'Push A', notes: 'Heavy day' });
      expect(routine.exercises.map(e => [e.exerciseId, e.restSeconds, e.progression, e.targets.length])).toEqual([
        [BENCH, 150, 'double', 3], ['lib:incline-dumbbell-bench-press', undefined, undefined, 1], [FLY, undefined, undefined, 1],
      ]);
      expect(routine.exercises[1].supersetKey).toBeTruthy();
      expect(routine.exercises[2].supersetKey).toBe(routine.exercises[1].supersetKey);
      expect(routine.exercises[2].targets[0]).toEqual({ kind: 'working', repsMin: 12, repsMax: 12 });
      expect(note).toMatch(/nothing proposes a load/);
      expect(listWorkouts(replica).routines.map(r => r.name)).toEqual(['Push A']);
      expect(entries).toEqual([expect.objectContaining({ action: 'created', subject: 'routine', title: 'Push A' })]);
    });

    it('changes only what it names, and refuses an unknown exercise, a nameless new one and a set-less exercise', () => {
      const { routine } = saveRoutine(ledgered, { name: 'Pull', exercises: [{ exerciseId: 'lib:barbell-row', sets: [{ repsMin: 8 }] }] });
      const renamed = saveRoutine(ledgered, { id: routine.id, name: 'Pull A' }).routine;
      expect(renamed).toMatchObject({ name: 'Pull A' });
      expect(renamed.exercises).toHaveLength(1);
      expect(() => saveRoutine(ledgered, { id: routine.id, exercises: [{ exerciseId: 'nope', sets: [{}] }] })).toThrow(/No exercise with id nope/);
      expect(() => saveRoutine(ledgered, { exercises: [] })).toThrow(/needs a name/);
      expect(() => saveRoutine(ledgered, { name: 'X', exercises: [{ exerciseId: BENCH, sets: [] }] })).toThrow(/at least one set/);
      expect(() => saveRoutine(ledgered, { id: 'gone', name: 'Y' })).toThrow(/No routine with id gone/);
    });

    it('deletes a routine and says what that leaves', () => {
      const { routine } = saveRoutine(ledgered, { name: 'Legs' });
      expect(deleteRoutine(ledgered, routine.id)).toMatchObject({ removed: { name: 'Legs' }, note: expect.stringMatching(/keep their history/) });
      expect(listWorkouts(replica).routines).toEqual([]);
      expect(entries.map(e => e.action)).toEqual(['created', 'cleared']);
    });

    it('keys a superset of three as one run', () => {
      let n = 0;
      const items = routineItemsFrom([
        { exerciseId: 'a', sets: [{}] },
        { exerciseId: 'b', supersetWithPrevious: true, sets: [{}] },
        { exerciseId: 'c', supersetWithPrevious: true, sets: [{}] },
        { exerciseId: 'd', sets: [{}] },
      ], () => `k${n++}`);
      expect(items.map(i => i.supersetKey)).toEqual(['k0', 'k0', 'k0', null]);
    });
  });

  describe('a task linked to a routine', () => {
    it('links on create and on update, shows the routine on get_task, and refuses one that is not there', () => {
      const { routine } = saveRoutine(replica, { name: 'Push A' });
      const created = createTask(replica, { title: 'Push day', category: 'Gym', newCategory: true, workoutRoutineId: routine.id });
      expect(getTask(replica, created.task.id)?.workout).toEqual({ routineId: routine.id, name: 'Push A' });
      expect(() => createTask(replica, { title: 'Pull day', category: 'Gym', workoutRoutineId: 'gone' }))
        .toThrow(/no routine with id gone/);
      updateTask(replica, created.task.id, { workoutRoutineId: null });
      expect(getTask(replica, created.task.id)?.workout).toBeUndefined();
    });
  });

  describe('log_workout', () => {
    const now = new Date(2026, 9, 8, 20);

    it('writes a finished workout with what was done, all sets done, and records it as a workout', () => {
      const { workout } = logWorkout(ledgered, {
        startedAt: new Date(2026, 9, 7, 18).toISOString(),
        durationMinutes: 50,
        effort: 7,
        exercises: [
          { exerciseId: BENCH, sets: [{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 7 }] },
          { exerciseId: FLY, sets: [{ weightKg: 15, reps: 12, note: ' slow ' }] },
        ],
      }, now);
      expect(workout).toMatchObject({ title: 'Workout', effort: 7, endedAt: new Date(2026, 9, 7, 18, 50).toISOString() });
      expect(workout.inProgress).toBeUndefined();
      expect(workout.exercises.map(e => e.sets.map(st => [st.weightKg, st.reps, st.done]))).toEqual([
        [[80, 8, true], [80, 7, true]], [[15, 12, true]],
      ]);
      expect(workout.exercises[1].sets[0].note).toBe('slow');
      expect(entries).toEqual([expect.objectContaining({ action: 'created', subject: 'workout', title: 'Workout' })]);
    });

    it('takes its title from the routine it followed', () => {
      const { routine } = saveRoutine(ledgered, { name: 'Push A' });
      const { workout } = logWorkout(ledgered, {
        startedAt: '2026-10-05', routineId: routine.id, exercises: [{ exerciseId: BENCH, sets: [{ reps: 5 }] }],
      }, now);
      expect(workout).toMatchObject({ title: 'Push A', routine: 'Push A', date: '2026-10-05' });
    });

    it('refuses a workout that has not happened, an unknown exercise and an unknown routine', () => {
      expect(() => logWorkout(ledgered, {
        startedAt: new Date(2026, 9, 9, 18).toISOString(), exercises: [{ exerciseId: BENCH, sets: [{ reps: 5 }] }],
      }, now)).toThrow(/has not happened|in the future/);
      expect(() => logWorkout(ledgered, {
        startedAt: '2026-10-05', exercises: [{ exerciseId: 'nope', sets: [{ reps: 5 }] }],
      }, now)).toThrow(/No exercise with id nope/);
      expect(() => logWorkout(ledgered, {
        startedAt: '2026-10-05', routineId: 'gone', exercises: [{ exerciseId: BENCH, sets: [{ reps: 5 }] }],
      }, now)).toThrow(/No routine with id gone/);
      expect(entries).toEqual([]);
    });
  });

  describe('update_workout and delete_workout', () => {
    const log = () => logWorkout(ledgered, {
      startedAt: new Date(2026, 9, 7, 18).toISOString(), durationMinutes: 40,
      exercises: [{ exerciseId: BENCH, sets: [{ weightKg: 80, reps: 8 }] }],
    }, new Date(2026, 9, 8)).workout;

    it('corrects the fields named, keeps the length when moving the start, and replaces sets whole', () => {
      const w = log();
      const moved = updateWorkout(ledgered, w.id, { startedAt: new Date(2026, 9, 6, 7).toISOString(), effort: 6 }).workout;
      expect(moved).toMatchObject({ effort: 6, endedAt: new Date(2026, 9, 6, 7, 40).toISOString() });
      const resetSets = updateWorkout(ledgered, w.id, { exercises: [{ exerciseId: FLY, sets: [{ weightKg: 10, reps: 15 }] }] }).workout;
      expect(resetSets.exercises.map(e => e.exerciseId)).toEqual([FLY]);
      expect(() => updateWorkout(ledgered, w.id, {})).toThrow(/Nothing to change/);
      expect(() => updateWorkout(ledgered, 'gone', { notes: 'x' })).toThrow(/No workout with id gone/);
    });

    it('refuses to change or delete a workout in progress on the phone', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useWorkoutStore } = require('../../../src/store/useWorkoutStore');
      useWorkoutStore.getState().initialize();
      const live = useWorkoutStore.getState().startSession({ title: 'Live' });
      expect(() => updateWorkout(ledgered, live.id, { notes: 'x' })).toThrow(/in progress on the phone/);
      expect(() => deleteWorkout(ledgered, live.id)).toThrow(/in progress on the phone/);
    });

    it('deletes a finished workout with its sets, naming what it removed', () => {
      const w = log();
      const { removed, note } = deleteWorkout(ledgered, w.id);
      expect(removed.exercises[0].sets).toHaveLength(1);
      expect(note).toMatch(/cannot be restored/);
      expect(replica.workoutSession(w.id)).toBeNull();
      expect(entries.map(e => [e.action, e.subject])).toEqual([['created', 'workout'], ['cleared', 'workout']]);
    });
  });
});
