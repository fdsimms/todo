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
  copyRoutineVersionOut, deleteGym, deleteProgram, deleteRoutine, deleteWorkout, listWorkouts, mergeRoutinesOut, programHistoryOut, saveGym,
  logWorkout, nextWorkout, restoreProgramVersionOut, restoreRoutineVersionOut, routineHistoryOut, routineItemsFrom, saveProgram, saveRoutine,
  updateWorkout, scaleWorkoutWeights,
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
    for (const t of ['workout_routines', 'workout_programs', 'workout_routine_versions', 'workout_program_versions', 'workout_sessions', 'workout_sets', 'exercises', 'gyms', 'gym_exercises']) mockRaw.runSync(`DELETE FROM ${t}`);
    replica.refresh();
    entries = [];
    ledgered = withAgentLedger(replica, e => { entries.push(...e); });
  });

  describe('save_gym', () => {
    it('creates a gym with equipment and an exercise note, lists it and records it', () => {
      const { gym, note } = saveGym(ledgered, {
        name: ' Planet Fitness ', equipment: ['cable', 'dumbbell'], exerciseNotes: [{ exerciseId: FLY, notes: ' Seat 4 ' }],
      });
      expect(gym).toMatchObject({ name: 'Planet Fitness', equipment: ['dumbbell', 'cable'] });
      expect(gym.exerciseNotes).toEqual([{ exerciseId: FLY, name: expect.any(String), notes: 'Seat 4' }]);
      expect(note).toMatch(/Where a gym is can only be set on the phone/);
      expect(listWorkouts(replica).gyms.map(g => g.name)).toEqual(['Planet Fitness']);
      expect(entries).toEqual([expect.objectContaining({ action: 'created', subject: 'gym', title: 'Planet Fitness' })]);
    });

    it('changes only what it names, clears a note with an empty string, and refuses bad input', () => {
      const { gym } = saveGym(ledgered, { name: 'Home', equipment: ['barbell'], exerciseNotes: [{ exerciseId: BENCH, notes: 'Left rack' }] });
      const renamed = saveGym(ledgered, { id: gym.id, name: 'Garage', exerciseNotes: [{ exerciseId: BENCH, notes: '' }] }).gym;
      expect(renamed).toMatchObject({ name: 'Garage', equipment: ['barbell'] });
      expect(renamed.exerciseNotes).toBeUndefined();
      expect(() => saveGym(ledgered, { equipment: ['cable'] })).toThrow(/needs a name/);
      expect(() => saveGym(ledgered, { name: 'garage' })).toThrow(/already has that name/);
      expect(() => saveGym(ledgered, { id: 'gone', name: 'Y' })).toThrow(/No gym with id gone/);
      expect(() => saveGym(ledgered, { id: gym.id, exerciseNotes: [{ exerciseId: 'nope', notes: 'x' }] })).toThrow(/No exercise with id nope/);
    });

    it('keeps a bar and a load step per exercise, leaves a note alone when only those are given, and clears them with null', () => {
      const { gym } = saveGym(ledgered, { name: 'Big', exerciseNotes: [{ exerciseId: BENCH, notes: 'Rack 2' }] });
      const set = saveGym(ledgered, { id: gym.id, exerciseNotes: [{ exerciseId: BENCH, barKg: 15, incrementKg: 2 }] }).gym;
      expect(set.exerciseNotes).toEqual([{ exerciseId: BENCH, name: expect.any(String), notes: 'Rack 2', barKg: 15, incrementKg: 2 }]);
      const cleared = saveGym(ledgered, { id: gym.id, exerciseNotes: [{ exerciseId: BENCH, barKg: null, incrementKg: null }] }).gym;
      expect(cleared.exerciseNotes).toEqual([{ exerciseId: BENCH, name: expect.any(String), notes: 'Rack 2' }]);
    });

    it('makes one gym the default, moves it, and clears it only from the gym that has it', () => {
      const a = saveGym(ledgered, { name: 'Home', isDefault: true }).gym;
      expect(a.isDefault).toBe(true);
      const b = saveGym(ledgered, { name: 'Work' }).gym;
      expect(listWorkouts(replica).gyms.map(g => [g.name, g.isDefault])).toEqual([['Home', true], ['Work', undefined]]);
      saveGym(ledgered, { id: b.id, isDefault: true });
      expect(replica.defaultGymId()).toBe(b.id);
      saveGym(ledgered, { id: a.id, isDefault: false });
      expect(replica.defaultGymId()).toBe(b.id);
      saveGym(ledgered, { id: b.id, isDefault: false });
      expect(replica.defaultGymId()).toBeNull();
    });

    it('deletes a gym and its notes, and says what that leaves', () => {
      const { gym } = saveGym(ledgered, { name: 'Hotel', exerciseNotes: [{ exerciseId: BENCH, notes: 'x' }] });
      expect(deleteGym(ledgered, gym.id)).toMatchObject({ removed: { name: 'Hotel' }, note: expect.stringMatching(/keep their history/) });
      expect(listWorkouts(replica).gyms).toEqual([]);
      expect(replica.gymExercises()).toEqual([]);
      expect(entries.map(e => e.action)).toEqual(['created', 'cleared']);
    });
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

    it('keeps the agent\'s plan as a version: amending it until a workout is done on it, a new one after', () => {
      const { routine } = saveRoutine(ledgered, { name: 'Legs', exercises: [{ exerciseId: 'lib:back-squat', sets: [{ repsMin: 5 }] }] });
      const versions = () => replica.routineVersions().filter(v => v.routineId === routine.id);
      expect(versions().map(v => v.source)).toEqual(['agent']);
      saveRoutine(ledgered, { id: routine.id, exercises: [{ exerciseId: 'lib:back-squat', sets: [{ repsMin: 5 }, { repsMin: 5 }] }] });
      expect(versions()).toHaveLength(1);
      logWorkout(replica, {
        routineId: routine.id, startedAt: new Date(Date.now() - 3600_000).toISOString(),
        exercises: [{ exerciseId: 'lib:back-squat', sets: [{ weightKg: 100, reps: 5 }] }],
      });
      saveRoutine(ledgered, { id: routine.id, exercises: [{ exerciseId: 'lib:back-squat', sets: [{ repsMin: 3 }] }] });
      expect(versions().map(v => [v.source, v.items[0].targets.length])).toEqual([['agent', 2], ['agent', 1]]);
      expect(listWorkouts(replica).routines.find(r => r.id === routine.id)?.version).toBe(2);
    });

    it('restores, copies and merges by version number, recording each in Activity', () => {
      const trainOn = (routineId: string) => logWorkout(replica, {
        routineId, startedAt: new Date(Date.now() - 3600_000).toISOString(),
        exercises: [{ exerciseId: 'lib:back-squat', sets: [{ weightKg: 100, reps: 5 }] }],
      });
      const { routine } = saveRoutine(replica, { name: 'Day One', exercises: [{ exerciseId: 'lib:back-squat', sets: [{ repsMin: 5 }] }] });
      trainOn(routine.id);
      saveRoutine(replica, { id: routine.id, exercises: [{ exerciseId: BENCH, sets: [{ repsMin: 8 }] }] });

      const restored = restoreRoutineVersionOut(ledgered, { routineId: routine.id, version: 1 });
      expect(restored.routine).toMatchObject({ version: 3 });
      expect(restored.routine.exercises.map(e => e.exerciseId)).toEqual(['lib:back-squat']);
      expect(routineHistoryOut(replica, { routineId: routine.id }).versions.map(v => [v.version, v.source])).toEqual([
        [3, 'restore'], [2, 'agent'], [1, 'agent'],
      ]);
      expect(() => restoreRoutineVersionOut(ledgered, { routineId: routine.id, version: 3 })).toThrow(/already the current one/);
      expect(() => restoreRoutineVersionOut(ledgered, { routineId: routine.id, version: 9 })).toThrow(/no version 9.*routine_history/);

      const copy = copyRoutineVersionOut(ledgered, { routineId: routine.id, version: 2 });
      expect(copy.routine).toMatchObject({ name: 'Day One (version 2)', version: 1 });
      expect(copy.routine.exercises.map(e => e.exerciseId)).toEqual([BENCH]);

      const linked = createTask(replica, { title: 'Lift', category: 'Gym', newCategory: true, workoutRoutineId: copy.routine.id }).task;
      const merged = mergeRoutinesOut(ledgered, { fromId: copy.routine.id, intoId: routine.id });
      // The open task moves to the routine that was kept, through the replica's own task write.
      expect(mockRaw.getFirstSync<{ workout_routine_id: string }>('SELECT workout_routine_id FROM tasks WHERE id = ?', [linked.id])?.workout_routine_id)
        .toBe(routine.id);
      expect(merged.removed).toEqual({ id: copy.routine.id, name: 'Day One (version 2)' });
      expect(listWorkouts(replica).routines.map(r => r.name)).toEqual(['Day One']);
      expect(routineHistoryOut(replica, { routineId: routine.id }).versions).toHaveLength(4);
      expect(() => mergeRoutinesOut(ledgered, { fromId: routine.id, intoId: routine.id })).toThrow(/into itself/);
      expect(entries.map(e => [e.action, e.subject])).toEqual([
        ['edited', 'routine'], ['created', 'routine'], ['edited', 'routine'],
      ]);
      expect(entries[2].note).toMatch(/cannot be undone/);
    });

    it('reads and restores a program\'s versions', () => {
      const a = saveRoutine(replica, { name: 'A', exercises: [{ exerciseId: 'lib:back-squat', sets: [{ repsMin: 5 }] }] }).routine;
      const b = saveRoutine(replica, { name: 'B', exercises: [{ exerciseId: BENCH, sets: [{ repsMin: 5 }] }] }).routine;
      const { program } = saveProgram(replica, { name: 'HW', routineIds: [a.id, b.id], weeks: 8 });
      logWorkout(replica, {
        routineId: a.id, startedAt: new Date(Date.now() - 3600_000).toISOString(),
        exercises: [{ exerciseId: 'lib:back-squat', sets: [{ weightKg: 100, reps: 5 }] }],
      });
      saveProgram(replica, { id: program.id, routineIds: [a.id], weeks: 4 });
      const history = programHistoryOut(replica, { programId: program.id });
      expect(history.versions.map(v => [v.version, v.weeks, v.rotation.map(r => r.name)])).toEqual([[2, 4, ['A']], [1, 8, ['A', 'B']]]);
      expect(history.versions[0].changes).toBe('Removed B; 8 weeks → 4 weeks');
      const restored = restoreProgramVersionOut(ledgered, { programId: program.id, version: 1 });
      expect(restored.program).toMatchObject({ weeks: 8, rotation: ['A', 'B'] });
      expect(programHistoryOut(replica, { programId: program.id }).versions).toHaveLength(3);
      expect(entries).toEqual([expect.objectContaining({ action: 'edited', subject: 'program', title: 'HW' })]);
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

    it('refuses a warm-up ramp on an exercise that does not record weight and reps', () => {
      expect(() => saveRoutine(ledgered, {
        name: 'Pull', exercises: [{ exerciseId: 'lib:assisted-pull-up', warmupRamp: true, sets: [{ repsMin: 8 }] }],
      })).toThrow(/warm-up ramp is only for exercises that record weight and reps, and Assisted pull-up does not/);
      expect(() => saveRoutine(ledgered, { name: 'Core', exercises: [{ exerciseId: 'lib:copenhagen-plank', warmupRamp: true, sets: [{}] }] }))
        .toThrow(/Copenhagen plank/);
      expect(entries).toEqual([]);
      const { routine } = saveRoutine(ledgered, { name: 'Push', exercises: [{ exerciseId: BENCH, warmupRamp: true, sets: [{ repsMin: 5 }] }] });
      expect(routine.exercises[0].warmupRamp).toBe(true);
      // The same assisted exercise without the ramp is fine.
      expect(saveRoutine(ledgered, { name: 'Pull', exercises: [{ exerciseId: 'lib:assisted-pull-up', sets: [{ repsMin: 8 }] }] }).routine.exercises).toHaveLength(1);
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

  describe('save_program, starting the next cycle', () => {
    it('counts the weeks again from now, so a finished cycle stops offering its raise', () => {
      const a = saveRoutine(replica, { name: 'Squat day', exercises: [{ exerciseId: 'lib:back-squat', sets: [{ repsMin: 5, repsMax: 5 }] }] }).routine;
      const { program } = saveProgram(replica, {
        name: 'Wave', routineIds: [a.id], scheme: 'percent', weeks: 1, trainingMaxes: [{ exerciseId: 'lib:back-squat', kg: 100 }],
      });
      logWorkout(replica, {
        routineId: a.id, startedAt: new Date(2026, 9, 6, 18).toISOString(), exercises: [{ exerciseId: 'lib:back-squat', sets: [{ weightKg: 65, reps: 5 }] }],
      }, new Date(2026, 9, 8, 20));
      const ended = nextWorkout(replica, { programId: program.id });
      expect(ended.program).toMatchObject({ cycleDone: true, trainingMaxRaises: [{ fromKg: 100, toKg: 105 }] });
      expect(ended.note).toMatch(/startNextCycle: true/);

      const started = saveProgram(ledgered, {
        id: program.id, trainingMaxes: [{ exerciseId: 'lib:back-squat', kg: 105 }], startNextCycle: true,
      }, new Date(2026, 9, 9, 9));
      expect(started.note).toMatch(/starts again from this moment/);
      expect(started.program.cycleDone).toBeUndefined();
      expect(started.program).toMatchObject({ week: 1, workoutsDone: 0, trainingMaxes: [{ exerciseId: 'lib:back-squat', kg: 105 }] });
      expect(replica.workoutPrograms()[0].startedAt).toBe(new Date(2026, 9, 9, 9).toISOString());
      // No second raise is offered, and the next workout is read from the new maxes.
      const after = nextWorkout(replica, { programId: program.id });
      expect(after.program?.trainingMaxRaises).toBeUndefined();
      expect(after.program?.cycleDone).toBeUndefined();
      expect(after.exercises[0].proposal?.sets[0].weightKg).toBe(67.5);
      expect(entries).toEqual([expect.objectContaining({ action: 'edited', subject: 'program', title: 'Wave' })]);
    });

    it('leaves the count alone without it, and needs a program that exists', () => {
      const a = saveRoutine(replica, { name: 'A' }).routine;
      const { program } = saveProgram(replica, { name: 'P', routineIds: [a.id] });
      saveProgram(replica, { id: program.id, weeks: 4 });
      expect(replica.workoutPrograms()[0].startedAt).toBeNull();
      expect(() => saveProgram(replica, { name: 'New', startNextCycle: true })).toThrow(/give its id/);
    });
  });

  describe('next_workout', () => {
    it('reads last time from finished workouts only, not one in progress on the phone', () => {
      const a = saveRoutine(replica, { name: 'Upper A', exercises: [
        { exerciseId: BENCH, progression: 'double', sets: [{ repsMin: 6, repsMax: 8 }, { repsMin: 6, repsMax: 8 }] },
      ] }).routine;
      logWorkout(replica, {
        routineId: a.id, startedAt: new Date(2026, 9, 6, 18).toISOString(),
        exercises: [{ exerciseId: BENCH, sets: [{ weightKg: 80, reps: 8 }, { weightKg: 80, reps: 8 }] }],
      }, new Date(2026, 9, 8, 20));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useWorkoutStore } = require('../../../src/store/useWorkoutStore');
      useWorkoutStore.getState().initialize();
      const live = useWorkoutStore.getState().startSession({ title: 'Live', at: new Date(2026, 9, 9, 9) });
      useWorkoutStore.getState().logSet(live.id, { exerciseId: BENCH, weightKg: 120, reps: 8 });
      const next = nextWorkout(replica, { routineId: a.id });
      expect(next.exercises[0].proposal?.sets.map(st => st.weightKg)).toEqual([82.5, 82.5]);
      expect(next.exercises[0].proposal?.reason).toBe('Up 2.5 kg because every set last time reached 8.');
    });

    it('says the week and the history are unknown when the replica holds no workouts at all', () => {
      const a = saveRoutine(replica, { name: 'Squat day', exercises: [{ exerciseId: 'lib:back-squat', progression: 'percent', sets: [{ repsMin: 5, repsMax: 5 }] }] }).routine;
      const { program } = saveProgram(replica, { name: 'Wave', routineIds: [a.id], scheme: 'percent', trainingMaxes: [{ exerciseId: 'lib:back-squat', kg: 100 }] });
      // A percentage lift needs no history, so the per-exercise note stays quiet; the empty log is what matters.
      const none = nextWorkout(replica, { programId: program.id });
      expect(none.program).toMatchObject({ week: 1, workoutsDone: 0 });
      expect(none.note).toMatch(/holds no workouts/);
      expect(none.note).toMatch(/Include health logs/);
      logWorkout(replica, {
        routineId: a.id, startedAt: new Date(2026, 9, 6, 18).toISOString(), exercises: [{ exerciseId: 'lib:back-squat', sets: [{ weightKg: 65, reps: 5 }] }],
      }, new Date(2026, 9, 8, 20));
      expect(nextWorkout(replica, { programId: program.id }).note).not.toMatch(/holds no workouts/);
    });


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

    it('defaults to the current program once one is picked, and marks it in list_workouts', () => {
      const a = saveRoutine(replica, { name: 'A' }).routine;
      const b = saveRoutine(replica, { name: 'B' }).routine;
      const one = saveProgram(replica, { name: 'One', routineIds: [a.id] }).program;
      const two = saveProgram(replica, { name: 'Two', routineIds: [b.id] }).program;
      expect(() => nextWorkout(replica)).toThrow(/none is current/);
      expect(saveProgram(replica, { id: two.id, isCurrent: true }).program.isCurrent).toBe(true);
      expect(nextWorkout(replica).program?.id).toBe(two.id);
      const listed = listWorkouts(replica).programs;
      expect(listed.find(p => p.id === two.id)?.isCurrent).toBe(true);
      expect(listed.find(p => p.id === one.id)?.isCurrent).toBeUndefined();
      // Clearing it goes back to asking; clearing another program's pick does nothing.
      saveProgram(replica, { id: one.id, isCurrent: false });
      expect(nextWorkout(replica).program?.id).toBe(two.id);
      saveProgram(replica, { id: two.id, isCurrent: false });
      expect(() => nextWorkout(replica)).toThrow(/none is current/);
    });

    it('saves a program with no routines but says it is not current', () => {
      const empty = saveProgram(replica, { name: 'Empty', isCurrent: true });
      expect(empty.note).toMatch(/not made current/);
      expect(empty.program.isCurrent).toBeUndefined();
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

    it('leaves it flagged for the phone to write to Apple Health, which this process cannot reach', () => {
      const { workout } = logWorkout(ledgered, {
        startedAt: new Date(2026, 9, 7, 18).toISOString(), durationMinutes: 30,
        exercises: [{ exerciseId: BENCH, sets: [{ reps: 5 }] }],
      }, now);
      expect(replica.workoutSession(workout.id)).toMatchObject({ healthWritePending: true, healthWorkoutId: null });
      expect(workout.inAppleHealth).toBeUndefined();
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
      expect(replica.workoutSession(w.id)?.timesEdited).toBe(false);
      const moved = updateWorkout(ledgered, w.id, { startedAt: new Date(2026, 9, 6, 7).toISOString(), effort: 6 }).workout;
      expect(moved).toMatchObject({ effort: 6, endedAt: new Date(2026, 9, 6, 7, 40).toISOString() });
      // Recorded on the row, which carries it to the phone: a watch's copy
      // arriving later at the old times is then rewritten, never kept.
      expect(replica.workoutSession(w.id)?.timesEdited).toBe(true);
      const resetSets = updateWorkout(ledgered, w.id, { exercises: [{ exerciseId: FLY, sets: [{ weightKg: 10, reps: 15 }] }] }).workout;
      expect(resetSets.exercises.map(e => e.exerciseId)).toEqual([FLY]);
      expect(() => updateWorkout(ledgered, w.id, {})).toThrow(/Nothing to change/);
      expect(() => updateWorkout(ledgered, 'gone', { notes: 'x' })).toThrow(/No workout with id gone/);
    });

    it('keeps an exercise\'s superset and a set\'s time when its sets are replaced', () => {
      const w = log();
      const done = '2026-10-07T18:20:00.000Z';
      mockRaw.runSync('UPDATE workout_sets SET superset_key = ?, completed_at = ? WHERE session_id = ?', ['ss-1', done, w.id]);
      replica.refresh();
      updateWorkout(ledgered, w.id, { exercises: [{ exerciseId: BENCH, sets: [{ weightKg: 40, reps: 8 }, { weightKg: 45, reps: 8 }] }] });
      const sets = replica.workoutSets(w.id);
      expect(sets.map(s => [s.weightKg, s.supersetKey, s.completedAt])).toEqual([[40, 'ss-1', done], [45, 'ss-1', expect.any(String)]]);
      // An exercise the replacement adds has no superset to inherit.
      updateWorkout(ledgered, w.id, { exercises: [{ exerciseId: FLY, sets: [{ weightKg: 10, reps: 15 }] }] });
      expect(replica.workoutSets(w.id)[0].supersetKey).toBeNull();
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

    it('refuses a new time for, or a delete of, a workout the phone wrote to Apple Health, and allows the rest', () => {
      const w = log();
      // As the phone leaves it once Health has the workout.
      mockRaw.runSync('UPDATE workout_sessions SET health_workout_id = ?, health_write_pending = 0 WHERE id = ?', ['HK-1', w.id]);
      replica.refresh();
      expect(() => updateWorkout(ledgered, w.id, { startedAt: new Date(2026, 9, 6, 7).toISOString() }, new Date(2026, 9, 8)))
        .toThrow(/only the phone can correct/);
      expect(() => updateWorkout(ledgered, w.id, { durationMinutes: 55 })).toThrow(/only the phone can correct/);
      expect(updateWorkout(ledgered, w.id, { notes: 'Felt strong', effort: 8 }).workout)
        .toMatchObject({ notes: 'Felt strong', effort: 8, inAppleHealth: true });
      expect(() => deleteWorkout(ledgered, w.id)).toThrow(/only the phone can remove/);
      expect(replica.workoutSession(w.id)).toMatchObject({ healthWorkoutId: 'HK-1' });
    });

    it('leaves the workout row alone for a sets-only change, so a sync cannot send a stale copy over the phone\'s', () => {
      const w = log();
      const stamp = '2000-01-01T00:00:00.000Z';
      mockRaw.runSync('UPDATE workout_sessions SET updated_at = ? WHERE id = ?', [stamp, w.id]);
      replica.refresh();
      const updated = updateWorkout(ledgered, w.id, { exercises: [{ exerciseId: FLY, sets: [{ weightKg: 10, reps: 15 }] }] }).workout;
      expect(updated.exercises.map(e => e.exerciseId)).toEqual([FLY]);
      const row = () => mockRaw.getFirstSync<{ updated_at: string }>('SELECT updated_at FROM workout_sessions WHERE id = ?', [w.id]);
      expect(row()?.updated_at).toBe(stamp);
      updateWorkout(ledgered, w.id, { notes: 'Felt strong' });
      expect(row()?.updated_at).not.toBe(stamp);
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

  describe('scale_workout_weights', () => {
    const SQUAT = 'lib:back-squat';
    const log = (day: number) => logWorkout(ledgered, {
      startedAt: new Date(2026, 9, day, 18).toISOString(), durationMinutes: 40,
      exercises: [
        { exerciseId: BENCH, sets: [{ weightKg: 80, reps: 8 }, { weightKg: 90, reps: 5, kind: 'amrap', note: 'grindy' }] },
        { exerciseId: SQUAT, sets: [{ weightKg: 100, reps: 5 }] },
      ],
    }, new Date(2026, 9, 20)).workout;
    const weights = (id: string) => replica.workoutSets(id).map(s => [s.exerciseId, s.weightKg]);

    it('only describes the change until apply is true', () => {
      const w = log(7);
      const preview = scaleWorkoutWeights(ledgered, { exerciseIds: [BENCH], factor: 0.5 });
      expect(preview).toMatchObject({ applied: false, sets: 2, workouts: [{ id: w.id, sets: 2 }] });
      expect(preview.workouts[0].example).toBe('Barbell bench press: 80 kg to 40 kg');
      expect(weights(w.id)).toEqual([[BENCH, 80], [BENCH, 90], [SQUAT, 100]]);
    });

    it('scales the named exercises across workouts and keeps every other field', () => {
      const a = log(7);
      const b = log(8);
      const result = scaleWorkoutWeights(ledgered, { exerciseIds: [BENCH], factor: 0.5, apply: true });
      expect(result).toMatchObject({ applied: true, sets: 4 });
      expect(weights(a.id)).toEqual([[BENCH, 40], [BENCH, 45], [SQUAT, 100]]);
      expect(weights(b.id)).toEqual([[BENCH, 40], [BENCH, 45], [SQUAT, 100]]);
      const sets = replica.workoutSets(a.id);
      expect(sets[1]).toMatchObject({ reps: 5, kind: 'amrap', note: 'grindy' });
      expect(sets[0].completedAt).not.toBeNull();
    });

    it('leaves a workout with nothing to change alone, honors the range, and refuses nonsense', () => {
      const old = log(2);
      const recent = log(9);
      const stamp = '2000-01-01T00:00:00.000Z';
      mockRaw.runSync('UPDATE workout_sessions SET updated_at = ? WHERE id = ?', [stamp, recent.id]);
      replica.refresh();
      const result = scaleWorkoutWeights(ledgered, { exerciseIds: [BENCH], factor: 2, from: '2026-10-05', to: '2026-10-20', apply: true });
      expect(result.workouts.map(x => x.id)).toEqual([recent.id]);
      expect(weights(old.id)).toEqual([[BENCH, 80], [BENCH, 90], [SQUAT, 100]]);
      // A sets-only rewrite does not restamp the session, or a sync could send a stale copy over the phone's.
      expect(mockRaw.getFirstSync<{ updated_at: string }>('SELECT updated_at FROM workout_sessions WHERE id = ?', [recent.id])?.updated_at).toBe(stamp);
      expect(() => scaleWorkoutWeights(ledgered, { exerciseIds: [BENCH], factor: 1 })).toThrow(/not 1/);
      expect(() => scaleWorkoutWeights(ledgered, { exerciseIds: [BENCH], factor: 0 })).toThrow(/above 0/);
      expect(() => scaleWorkoutWeights(ledgered, { exerciseIds: ['nope'], factor: 0.5 })).toThrow(/No exercise with id nope/);
    });

    it('skips a workout still in progress on the phone', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { useWorkoutStore } = require('../../../src/store/useWorkoutStore');
      useWorkoutStore.getState().initialize();
      const live = useWorkoutStore.getState().startSession({ title: 'Live' });
      useWorkoutStore.getState().logSet(live.id, { exerciseId: BENCH, kind: 'working', weightKg: 60, reps: 5 });
      replica.refresh();
      const result = scaleWorkoutWeights(ledgered, { exerciseIds: [BENCH], factor: 0.5, apply: true });
      expect(result).toMatchObject({ sets: 0, skippedInProgress: 1 });
      expect(replica.workoutSets(live.id)[0].weightKg).toBe(60);
    });
  });
});
