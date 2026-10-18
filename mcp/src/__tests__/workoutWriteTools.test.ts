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
  deleteProgram, deleteRoutine, deleteWorkout, listWorkouts, logWorkout, nextWorkout, routineItemsFrom, saveProgram, saveRoutine,
  updateWorkout,
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
    for (const t of ['workout_routines', 'workout_programs', 'workout_sessions', 'workout_sets', 'exercises']) mockRaw.runSync(`DELETE FROM ${t}`);
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
      expect(note).toMatch(/nothing applies one unasked/);
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

  describe('a task linked to a program', () => {
    it('links a program in place of a routine, names its next routine, and never holds both', () => {
      const a = saveRoutine(replica, { name: 'Upper A' }).routine;
      const b = saveRoutine(replica, { name: 'Lower A' }).routine;
      const { program } = saveProgram(replica, { name: 'Upper / Lower', routineIds: [a.id, b.id] });
      const created = createTask(replica, { title: 'Lift', category: 'Gym', newCategory: true, workoutRoutineId: a.id });
      updateTask(replica, created.task.id, { workoutProgramId: program.id });
      expect(getTask(replica, created.task.id)?.workout).toEqual({ programId: program.id, name: 'Upper / Lower', next: 'Upper A' });
      updateTask(replica, created.task.id, { workoutRoutineId: b.id });
      expect(getTask(replica, created.task.id)?.workout).toEqual({ routineId: b.id, name: 'Lower A' });
      expect(() => updateTask(replica, created.task.id, { workoutRoutineId: a.id, workoutProgramId: program.id })).toThrow(/not both/);
      expect(() => createTask(replica, { title: 'Gym', category: 'Gym', workoutProgramId: 'gone' })).toThrow(/no program with id gone/);
    });
  });

  describe('save_program and delete_program', () => {
    it('creates a program over routines, files them under it, and records it in Activity', () => {
      const a = saveRoutine(replica, { name: 'Push' }).routine;
      const b = saveRoutine(replica, { name: 'Pull' }).routine;
      const { program, note } = saveProgram(ledgered, {
        name: 'Push / Pull', routineIds: [a.id, b.id, a.id], scheme: 'percent', weeks: 4,
        trainingMaxes: [{ exerciseId: BENCH, kg: 100 }],
      });
      expect(program).toMatchObject({
        name: 'Push / Pull', scheme: 'percent', weeks: 4, rotation: ['Push', 'Pull', 'Push'], rotationIds: [a.id, b.id, a.id],
        trainingMaxes: [{ exerciseId: BENCH, name: 'Barbell bench press', kg: 100 }], week: 1, workoutsDone: 0,
        next: { routineId: a.id, name: 'Push' },
      });
      expect(note).toMatch(/worked out from the workouts finished/);
      expect(listWorkouts(replica).routines.map(r => r.program)).toEqual(['Push / Pull', 'Push / Pull']);
      expect(entries).toEqual([expect.objectContaining({ action: 'created', subject: 'program', title: 'Push / Pull' })]);
    });

    it('changes only what it names, and refuses an unknown routine, exercise or program', () => {
      const a = saveRoutine(replica, { name: 'Push' }).routine;
      const { program } = saveProgram(replica, { name: 'P', routineIds: [a.id] });
      expect(saveProgram(ledgered, { id: program.id, weeks: 6 }).program).toMatchObject({ name: 'P', weeks: 6, rotationIds: [a.id] });
      expect(entries).toEqual([expect.objectContaining({ action: 'edited', subject: 'program' })]);
      expect(() => saveProgram(replica, { id: program.id, routineIds: ['gone'] })).toThrow(/No routine with id gone/);
      expect(() => saveProgram(replica, { id: program.id, trainingMaxes: [{ exerciseId: 'nope', kg: 50 }] })).toThrow(/No exercise with id nope/);
      expect(() => saveProgram(replica, { routineIds: [a.id] })).toThrow(/needs a name/);
      expect(() => saveProgram(replica, { id: 'gone', weeks: 2 })).toThrow(/No program with id gone/);
    });

    it('deletes a program and leaves its routines', () => {
      const a = saveRoutine(replica, { name: 'Push' }).routine;
      const { program } = saveProgram(replica, { name: 'P', routineIds: [a.id] });
      const { removed, note } = deleteProgram(ledgered, program.id);
      expect(removed).toEqual({ id: program.id, name: 'P' });
      expect(note).toMatch(/routines stay/);
      expect(listWorkouts(replica).programs).toEqual([]);
      expect(listWorkouts(replica).routines.map(r => [r.name, r.program])).toEqual([['Push', undefined]]);
      expect(entries).toEqual([expect.objectContaining({ action: 'cleared', subject: 'program' })]);
      expect(() => deleteProgram(replica, program.id)).toThrow(/No program with id/);
    });
  });

  describe('next_workout', () => {
    it('proposes the next routine\'s loads from history, and moves on as workouts are logged', () => {
      const a = saveRoutine(replica, { name: 'Upper A', exercises: [
        { exerciseId: BENCH, progression: 'double', warmupRamp: true, sets: [{ repsMin: 6, repsMax: 8 }, { repsMin: 6, repsMax: 8 }] },
      ] }).routine;
      const b = saveRoutine(replica, { name: 'Lower A', exercises: [{ exerciseId: 'lib:back-squat', sets: [{ repsMin: 5, repsMax: 5 }] }] }).routine;
      const { program } = saveProgram(replica, { name: 'Upper / Lower', routineIds: [a.id, b.id], scheme: 'linear' });
      expect(nextWorkout(replica).routine).toEqual({ id: a.id, name: 'Upper A' });
      logWorkout(replica, {
        routineId: a.id, startedAt: new Date(2026, 9, 6, 18).toISOString(),
        exercises: [{ exerciseId: BENCH, sets: [{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }] }],
      }, new Date(2026, 9, 8, 20));
      const next = nextWorkout(replica, { programId: program.id });
      expect(next.routine.name).toBe('Lower A');
      expect(next.program).toMatchObject({ week: 1, workoutsDone: 1 });
      const upper = nextWorkout(replica, { routineId: a.id });
      expect(upper.exercises[0]).toMatchObject({
        exerciseId: BENCH, scheme: 'double',
        proposal: { move: 'up', headline: 'Today 2 × 6–8 at 82.5 kg.', reason: 'Up 2.5 kg because every set last time reached 8.' },
      });
      expect(upper.exercises[0].proposal!.sets).toEqual([{ kind: 'working', weightKg: 82.5, reps: 6 }, { kind: 'working', weightKg: 82.5, reps: 6 }]);
      expect(upper.exercises[0].proposal!.warmups?.map(w => w.weightKg)).toEqual([32.5, 50, 65]);
      // The squat follows the program's scheme and has no history to move on from.
      expect(next.exercises[0]).toEqual({ exerciseId: 'lib:back-squat', name: 'Barbell back squat', scheme: 'linear' });
      expect(next.note).toMatch(/Proposals only/);
    });

    it('asks which program when there are several, and says when there is none', () => {
      expect(() => nextWorkout(replica)).toThrow(/No program/);
      const a = saveRoutine(replica, { name: 'A' }).routine;
      saveProgram(replica, { name: 'One', routineIds: [a.id] });
      saveProgram(replica, { name: 'Two', routineIds: [a.id] });
      expect(() => nextWorkout(replica)).toThrow(/Several programs/);
      expect(() => nextWorkout(replica, { programId: 'gone' })).toThrow(/No program with id gone/);
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

    it('takes a bare date of today as now, not noon, so a morning workout can be logged', () => {
      const morning = new Date(2026, 9, 18, 8);
      const { workout } = logWorkout(ledgered, {
        startedAt: '2026-10-18', exercises: [{ exerciseId: BENCH, sets: [{ reps: 5 }] }],
      }, morning);
      expect(new Date(workout.startedAt).getTime()).toBe(morning.getTime());
      expect(() => logWorkout(ledgered, {
        startedAt: '2026-10-19', exercises: [{ exerciseId: BENCH, sets: [{ reps: 5 }] }],
      }, morning)).toThrow(/in the future/);
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

    it('moves the sets with the start, and refuses a start in the future', () => {
      const w = log();
      const before = replica.workoutSets(w.id)[0].completedAt!;
      updateWorkout(ledgered, w.id, { startedAt: new Date(2026, 9, 6, 18).toISOString() }, new Date(2026, 9, 8));
      const after = replica.workoutSets(w.id)[0].completedAt!;
      expect(new Date(before).getTime() - new Date(after).getTime()).toBe(24 * 3600 * 1000);
      expect(() => updateWorkout(ledgered, w.id, { startedAt: new Date(2026, 9, 20, 9).toISOString() }, new Date(2026, 9, 8)))
        .toThrow(/in the future/);
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
