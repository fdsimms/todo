/**
 * Against a real schema (expo-sqlite swapped for an in-memory better-sqlite3,
 * as database.test.ts does), because half of what this store promises is
 * about the rows: that a reload reads back what was written, that a deleted
 * session takes its sets with it, and that a renumber after a delete lands in
 * the database and not only in memory.
 */
import { initDatabase, dbGetWorkoutSets, dbGetAllExercises } from '../db/database';
import { useWorkoutStore, workoutContentCount } from '../store/useWorkoutStore';
import { catalogExercise } from '../utils/exerciseCatalog';
import { newTaskFromDraft } from '../utils/taskDraft';
import type { Task, TaskDraft } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockRawDb: any;

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const BS = require('better-sqlite3');
  mockRawDb = new BS(':memory:');
  return {
    openDatabaseSync: () => ({
      execSync(sql: string) { mockRawDb.exec(sql); },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      runSync(sql: string, params: any[] = []) { return mockRawDb.prepare(sql).run(...params); },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getAllSync<T>(sql: string, params: any[] = []): T[] { return mockRawDb.prepare(sql).all(...params) as T[]; },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getFirstSync<T>(sql: string, params: any[] = []): T | null { return (mockRawDb.prepare(sql).get(...params) as T) ?? null; },
      withTransactionSync(fn: () => void) {
        mockRawDb.exec('BEGIN');
        try { fn(); mockRawDb.exec('COMMIT'); } catch (e) { mockRawDb.exec('ROLLBACK'); throw e; }
      },
    }),
  };
});

// The task store as a fake: the real one loads the notification and native
// bridges, and what is under test here is only that finishing asks it to
// complete the right task.
const mockCompleteTask = jest.fn();
const mockLogQuotaUnit = jest.fn();
let mockTasks: Task[] = [];
jest.mock('../store/useTaskStore', () => ({
  useTaskStore: { getState: () => ({ tasks: mockTasks, completeTask: mockCompleteTask, logQuotaUnit: mockLogQuotaUnit }) },
}));
const task = (id: string, draft: Partial<TaskDraft> = {}, extra: Partial<Task> = {}): Task =>
  ({ ...newTaskFromDraft({ title: id, dueDate: new Date(2026, 0, 1).toISOString(), ...draft }, new Date(2026, 0, 1).toISOString(), 0, false, id), ...extra });

beforeAll(() => {
  initDatabase();
});

beforeEach(() => {
  for (const t of ['exercises', 'workout_routines', 'workout_programs', 'workout_sessions', 'workout_sets']) {
    mockRawDb.exec(`DELETE FROM ${t}`);
  }
  useWorkoutStore.getState().initialize();
  mockTasks = [];
  jest.clearAllMocks();
});

const state = () => useWorkoutStore.getState();
const reload = () => state().initialize();
const ok = <T,>(v: T | string): T => {
  if (typeof v === 'string') throw new Error(`refused: ${v}`);
  return v;
};

describe('custom exercises', () => {
  const fly = { name: 'Cable fly crossover', kind: 'weight_reps' as const, equipment: 'cable' as const, primaryMuscles: ['chest' as const] };

  it('adds one that survives a reload', () => {
    const e = ok(state().addExercise({ ...fly, secondaryMuscles: ['front_delts'], notes: ' Low pulleys ' }));
    reload();
    expect(state().exercises).toEqual([e]);
    expect(e).toMatchObject({ isCustom: true, notes: 'Low pulleys', archived: false });
  });

  it('refuses a blank name, and one already on offer, built-in or custom', () => {
    expect(state().addExercise({ ...fly, name: '  ' })).toBe('blank');
    expect(state().addExercise({ ...fly, name: 'cable FLY' })).toBe('taken');
    ok(state().addExercise(fly));
    expect(state().addExercise({ ...fly, name: 'Cable  fly crossover ' })).toBe('taken');
  });

  // Archiving keeps the exercise and its history, so its name stays its own.
  it('keeps an archived custom exercise\'s name taken, but frees an archived built-in\'s', () => {
    const e = ok(state().addExercise(fly));
    ok(state().updateExercise(e.id, { archived: true }));
    expect(state().addExercise(fly)).toBe('taken');
    ok(state().updateExercise('lib:pec-deck', { archived: true }));
    expect(state().addExercise({ ...fly, name: 'Pec deck' })).not.toBe('taken');
  });

  it('edits every field of a custom exercise, refusing a taken name', () => {
    const e = ok(state().addExercise(fly));
    const edited = ok(state().updateExercise(e.id, { name: 'Standing fly', equipment: 'band', primaryMuscles: ['chest', 'front_delts'] }));
    expect(edited).toMatchObject({ name: 'Standing fly', equipment: 'band', primaryMuscles: ['chest', 'front_delts'] });
    expect(state().updateExercise(e.id, { name: 'Pec deck' })).toBe('taken');
    expect(state().updateExercise('nobody', { name: 'x' })).toBe('notFound');
  });

  it('archives a custom exercise rather than removing it, with or without sets here', () => {
    // Another device's sets never arrive over iCloud, so "no sets" on this
    // device is not evidence there are none: a removal would sync out and
    // leave them pointing at nothing.
    const unused = ok(state().addExercise(fly));
    expect(state().deleteExercise(unused.id)).toBe(true);
    expect(dbGetAllExercises()).toEqual([expect.objectContaining({ id: unused.id, archived: true })]);
    expect(state().deleteExercise(unused.id)).toBe(true);

    const used = ok(state().addExercise({ ...fly, name: 'Landmine row' }));
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: used.id, weightKg: 20, reps: 12 }));
    expect(state().deleteExercise(used.id)).toBe(true);
    reload();
    expect(state().exercises.find(e => e.id === used.id)).toMatchObject({ archived: true });
    expect(dbGetAllExercises()).toHaveLength(2);
  });
});

describe('changes to a built-in exercise', () => {
  it('writes one row under the built-in id, carrying only what the person changed', () => {
    ok(state().updateExercise('lib:barbell-bench-press', { name: 'Flat bench', notes: 'Pause on the chest', primaryMuscles: ['calves'] }));
    reload();
    expect(state().exercises).toHaveLength(1);
    expect(state().exercises[0]).toMatchObject({ id: 'lib:barbell-bench-press', isCustom: false });
    const bench = catalogExercise(state().exercises, 'lib:barbell-bench-press')!;
    expect(bench).toMatchObject({ name: 'Flat bench', notes: 'Pause on the chest' });
    // The muscles stay the library's.
    expect(bench.primaryMuscles).toEqual(['chest']);
  });

  it('puts the library back when the changes are deleted', () => {
    ok(state().updateExercise('lib:back-squat', { notes: 'High bar' }));
    expect(state().deleteExercise('lib:back-squat')).toBe(true);
    expect(state().exercises).toEqual([]);
    expect(catalogExercise([], 'lib:back-squat')?.notes).toBe('');
  });

  it('does not count as content the person made', () => {
    ok(state().updateExercise('lib:back-squat', { notes: 'High bar' }));
    expect(workoutContentCount(state())).toBe(0);
  });
});

describe('routines and programs', () => {
  const item = { exerciseId: 'lib:back-squat', restSeconds: 180, progression: null, targets: [{ kind: 'working' as const, repsMin: 5, repsMax: 5, weightKg: 100 }] };

  it('adds routines in order, with their items, surviving a reload', () => {
    const a = ok(state().addRoutine('Push A', [item]));
    const b = ok(state().addRoutine('Pull A'));
    reload();
    expect(state().routines.map(r => r.name)).toEqual(['Push A', 'Pull A']);
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
    expect(state().routines[0].items).toEqual([{ ...item, supersetKey: null }]);
    expect(state().addRoutine('   ')).toBe('blank');
  });

  it('edits a routine', () => {
    const r = ok(state().addRoutine('Push A'));
    const edited = ok(state().updateRoutine(r.id, { name: 'Push B', notes: 'Shoulders first', items: [item] }));
    expect(edited).toMatchObject({ name: 'Push B', notes: 'Shoulders first' });
    expect(edited.items).toHaveLength(1);
    expect(state().updateRoutine(r.id, { name: '' })).toBe('blank');
  });

  it('takes a deleted routine out of every rotation it was in', () => {
    const a = ok(state().addRoutine('Upper'));
    const b = ok(state().addRoutine('Lower'));
    const p = ok(state().addProgram({ name: 'Upper and lower', rotation: [a.id, b.id, a.id] }));
    state().deleteRoutine(a.id);
    reload();
    expect(state().programs.find(x => x.id === p.id)?.rotation).toEqual([b.id]);
  });

  it('leaves a deleted program\'s routines as routines on their own', () => {
    const p = ok(state().addProgram({ name: '5x5', weeks: 12, scheme: 'linear', trainingMaxes: [{ exerciseId: 'lib:back-squat', kg: 120 }] }));
    expect(p).toMatchObject({ weeks: 12, scheme: 'linear', trainingMaxes: [{ exerciseId: 'lib:back-squat', kg: 120 }] });
    const r = ok(state().addRoutine('Day A', [], p.id));
    state().deleteProgram(p.id);
    reload();
    expect(state().programs).toEqual([]);
    expect(state().routines.find(x => x.id === r.id)?.programId).toBeNull();
  });

  it('edits a program, and refuses one nobody knows', () => {
    const p = ok(state().addProgram({ name: 'Wave' }));
    expect(ok(state().updateProgram(p.id, { weeks: 4, archived: true }))).toMatchObject({ weeks: 4, archived: true });
    expect(state().updateProgram('nope', { weeks: 4 })).toBe('notFound');
    expect(state().addProgram({ name: '' })).toBe('blank');
  });
});

describe('a live session', () => {
  it('starts one at a time, titled after its routine', () => {
    const r = ok(state().addRoutine('Push A'));
    const s = ok(state().startSession({ routineId: r.id }));
    expect(s).toMatchObject({ title: 'Push A', endedAt: null, routineId: r.id });
    expect(state().liveSession()?.id).toBe(s.id);
    expect(state().startSession()).toBe('live');
  });

  it('reloads with the live session\'s sets already loaded', () => {
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 }));
    useWorkoutStore.setState({ setsBySession: {} });
    reload();
    expect(state().setsBySession[s.id]).toHaveLength(1);
    expect(state().setCounts[s.id]).toBe(1);
  });

  it('keeps an exercise in its place and counts its sets from 0', () => {
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 }));
    ok(state().logSet(s.id, { exerciseId: 'lib:romanian-deadlift', weightKg: 80, reps: 8 }));
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 }));
    const sets = dbGetWorkoutSets(s.id);
    expect(sets.map(x => [x.exerciseId, x.position, x.setIndex])).toEqual([
      ['lib:back-squat', 0, 0], ['lib:back-squat', 0, 1], ['lib:romanian-deadlift', 1, 0],
    ]);
  });

  it('cleans what a set records, and refuses an unknown session or exercise', () => {
    const s = ok(state().startSession());
    const set = ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', weightKg: -5, reps: 5.4, rpe: 8.3, note: '  ' }));
    expect(set).toMatchObject({ weightKg: null, reps: 5, rpe: 8.5, note: null, kind: 'working' });
    expect(set.completedAt).not.toBeNull();
    expect(state().logSet('nope', { exerciseId: 'lib:back-squat' })).toBe('notFound');
    expect(state().logSet(s.id, { exerciseId: 'nobody' })).toBe('notFound');
  });

  it('lays a set out as planned when completedAt is null', () => {
    const s = ok(state().startSession());
    expect(ok(state().logSet(s.id, { exerciseId: 'lib:plank', durationSeconds: 60, completedAt: null })).completedAt).toBeNull();
  });

  it('edits a set, and the edit is what reloads', () => {
    const s = ok(state().startSession());
    const set = ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 }));
    ok(state().editSet(s.id, set.id, { weightKg: 102.5, reps: 4, kind: 'amrap' }));
    expect(dbGetWorkoutSets(s.id)[0]).toMatchObject({ weightKg: 102.5, reps: 4, kind: 'amrap' });
    expect(state().editSet(s.id, 'nope', { reps: 1 })).toBe('notFound');
  });

  it('closes the gap a deleted set leaves, in the database too', () => {
    const s = ok(state().startSession());
    const first = ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', reps: 5 }));
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', reps: 5 }));
    const only = ok(state().logSet(s.id, { exerciseId: 'lib:leg-press', reps: 10 }));
    state().deleteSet(s.id, first.id);
    expect(dbGetWorkoutSets(s.id).map(x => [x.exerciseId, x.position, x.setIndex])).toEqual([
      ['lib:back-squat', 0, 0], ['lib:leg-press', 1, 0],
    ]);
    state().deleteSet(s.id, only.id);
    expect(state().setCounts[s.id]).toBe(1);
  });

  it('puts exercises in a new order, keeping the ones not named after', () => {
    const s = ok(state().startSession());
    for (const id of ['lib:back-squat', 'lib:leg-press', 'lib:leg-extension']) ok(state().logSet(s.id, { exerciseId: id, reps: 5 }));
    state().reorderExercises(s.id, ['lib:leg-extension', 'lib:back-squat']);
    expect(dbGetWorkoutSets(s.id).map(x => x.exerciseId)).toEqual(['lib:leg-extension', 'lib:back-squat', 'lib:leg-press']);
  });

  it('finishes once, with the effort typed and nothing derived', () => {
    const s = ok(state().startSession());
    const done = ok(state().finishSession(s.id, { effort: 7.6, notes: ' Felt strong ' }));
    expect(done).toMatchObject({ effort: 8, notes: 'Felt strong' });
    expect(done.endedAt).not.toBeNull();
    expect(state().liveSession()).toBeNull();
    expect(state().finishSession(s.id)).toBe('finished');
  });

  it('keeps the planned sets when a finish is refused for ending before it started', () => {
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', reps: 5 }));
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', reps: 5, completedAt: null }));
    const early = new Date(new Date(s.startedAt).getTime() - 60000).toISOString();
    expect(state().finishSession(s.id, { endedAt: early })).toBe('order');
    expect(state().liveSession()?.id).toBe(s.id);
    expect(dbGetWorkoutSets(s.id)).toHaveLength(2);
    expect(state().loadSets(s.id)).toHaveLength(2);
  });

  it('throws the live session away with its sets', () => {
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', reps: 5 }));
    state().discardSession();
    expect(state().sessions).toEqual([]);
    expect(dbGetWorkoutSets(s.id)).toEqual([]);
    expect(state().setCounts[s.id]).toBeUndefined();
  });
});

describe('a session from a routine', () => {
  const bench = 'lib:barbell-bench-press';
  const fly = 'lib:cable-fly';
  const items = [
    { exerciseId: bench, supersetKey: null, restSeconds: 150, progression: null, targets: [
      { kind: 'warmup' as const, repsMin: null, repsMax: null },
      { kind: 'working' as const, repsMin: 6, repsMax: 8 },
      { kind: 'working' as const, repsMin: 6, repsMax: 8, weightKg: 85 },
    ] },
    { exerciseId: fly, supersetKey: 'ss', restSeconds: null, progression: null, targets: [
      { kind: 'working' as const, repsMin: 12, repsMax: 15 },
    ] },
    { exerciseId: 'not-an-exercise', supersetKey: null, restSeconds: null, progression: null, targets: [
      { kind: 'working' as const, repsMin: 5, repsMax: 5 },
    ] },
  ];

  it('lays the routine\'s sets out as planned, from the routine and from last time', () => {
    const r = ok(state().addRoutine('Push A', items));
    const before = ok(state().startSession({ routineId: r.id, at: new Date(2026, 9, 1, 18) }));
    for (const s of state().loadSets(before.id)) {
      ok(state().editSet(before.id, s.id, { weightKg: s.kind === 'warmup' ? 40 : 80, reps: 8, completedAt: new Date(2026, 9, 1, 18, 10).toISOString() }));
    }
    ok(state().finishSession(before.id));

    const s = ok(state().startSession({ routineId: r.id }));
    const sets = dbGetWorkoutSets(s.id);
    expect(sets.map(x => [x.exerciseId, x.position, x.setIndex, x.kind, x.weightKg, x.reps, x.completedAt])).toEqual([
      [bench, 0, 0, 'warmup', 40, 8, null],
      [bench, 0, 1, 'working', 80, 8, null],
      // The routine's own weight wins over last time's.
      [bench, 0, 2, 'working', 85, 8, null],
      [fly, 1, 0, 'working', 80, 8, null],
    ]);
    expect(sets[3].supersetKey).toBe('ss');
    expect(state().setsBySession[s.id]).toHaveLength(4);
    expect(state().lastTimeFor(bench, s.id).map(x => x.weightKg)).toEqual([40, 80, 80]);
  });

  it('finishes by dropping the sets never ticked', () => {
    const r = ok(state().addRoutine('Push A', items));
    const s = ok(state().startSession({ routineId: r.id }));
    const [, second] = state().loadSets(s.id);
    ok(state().editSet(s.id, second.id, { completedAt: new Date().toISOString() }));
    ok(state().finishSession(s.id));
    expect(dbGetWorkoutSets(s.id).map(x => [x.exerciseId, x.setIndex])).toEqual([[bench, 0]]);
    expect(state().setCounts[s.id]).toBe(1);
  });

  it('completes the task it was started from, once, and only an open one', () => {
    mockTasks = [task('t1'), task('t2', {}, { completed: true, completedAt: new Date().toISOString() })];
    const a = ok(state().startSession({ taskId: 't1' }));
    ok(state().finishSession(a.id));
    expect(mockCompleteTask).toHaveBeenCalledWith('t1');
    const b = ok(state().startSession({ taskId: 't2' }));
    ok(state().finishSession(b.id));
    const c = ok(state().startSession({ taskId: 'gone' }));
    ok(state().finishSession(c.id));
    expect(mockCompleteTask).toHaveBeenCalledTimes(1);
  });

  it('logs one workout on a target below its count, the way its checkbox would', () => {
    mockTasks = [task('t3', { targetCount: 3, quotaPeriod: 'week', recurrenceType: 'weekly', recurrenceInterval: 1 })];
    const s = ok(state().startSession({ taskId: 't3' }));
    ok(state().finishSession(s.id));
    expect(mockLogQuotaUnit).toHaveBeenCalledWith('t3');
    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it('leaves the task alone when asked to, for a task that asks a question first', () => {
    mockTasks = [task('t1')];
    const s = ok(state().startSession({ taskId: 't1' }));
    ok(state().finishSession(s.id, { completeLinkedTask: false }));
    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it('adds an exercise mid-session laid out like last time, once', () => {
    const s = ok(state().startSession());
    const added = ok(state().addSessionExercise(s.id, 'lib:back-squat'));
    expect(added.map(x => [x.position, x.setIndex, x.kind, x.completedAt])).toEqual([[0, 0, 'working', null]]);
    expect(state().addSessionExercise(s.id, 'lib:back-squat')).toBe('taken');
    expect(state().addSessionExercise(s.id, 'nobody')).toBe('notFound');
  });

  it('adds a set like the exercise\'s last', () => {
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', kind: 'warmup', weightKg: 60, reps: 5 }));
    const added = ok(state().addPlannedSet(s.id, 'lib:back-squat'));
    expect(added).toMatchObject({ kind: 'working', weightKg: 60, reps: 5, setIndex: 1, completedAt: null });
    expect(state().addPlannedSet(s.id, 'lib:leg-press')).toBe('notFound');
  });
});

describe('a workout logged after the fact', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 5, h, m).toISOString();

  it('writes a finished session with its sets in order, all done, while another is live', () => {
    ok(state().startSession());
    const { session, sets } = ok(state().addFinishedSession({
      title: '  Legs ', startedAt: at(7), endedAt: at(8), effort: 7, notes: ' Heavy ',
      sets: [
        { exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 },
        { exerciseId: 'lib:leg-press', weightKg: 200, reps: 10 },
        { exerciseId: 'lib:back-squat', weightKg: 100, reps: 4 },
      ],
    }));
    expect(session).toMatchObject({ title: 'Legs', endedAt: at(8), effort: 7, notes: 'Heavy', taskId: null });
    expect(sets.map(x => [x.exerciseId, x.position, x.setIndex, x.completedAt])).toEqual([
      ['lib:back-squat', 0, 0, at(8)], ['lib:leg-press', 1, 0, at(8)], ['lib:back-squat', 0, 1, at(8)],
    ]);
    reload();
    expect(state().sessions.find(x => x.id === session.id)?.endedAt).toBe(at(8));
    expect(mockCompleteTask).not.toHaveBeenCalled();
  });

  it('refuses one with no sets, one that ends first, and an unknown exercise', () => {
    expect(state().addFinishedSession({ startedAt: at(7), endedAt: at(8), sets: [] })).toBe('empty');
    expect(state().addFinishedSession({ startedAt: at(8), endedAt: at(7), sets: [{ exerciseId: 'lib:back-squat' }] })).toBe('order');
    expect(state().addFinishedSession({ startedAt: at(7), endedAt: at(8), sets: [{ exerciseId: 'nobody' }] })).toBe('notFound');
    expect(state().sessions).toEqual([]);
  });

  it('replaces a session\'s sets to correct it', () => {
    const { session } = ok(state().addFinishedSession({
      startedAt: at(7), endedAt: at(8), sets: [{ exerciseId: 'lib:back-squat', weightKg: 100, reps: 5 }],
    }));
    const sets = ok(state().replaceSets(session.id, [{ exerciseId: 'lib:front-squat', weightKg: 80, reps: 3 }]));
    expect(dbGetWorkoutSets(session.id)).toEqual(sets);
    expect(sets[0]).toMatchObject({ exerciseId: 'lib:front-squat', completedAt: at(8) });
    expect(state().replaceSets('nope', [])).toBe('notFound');
  });
});

describe('history', () => {
  it('lists sessions newest first and loads a finished one\'s sets on demand', () => {
    const older = ok(state().startSession({ title: 'Older', at: new Date(2026, 9, 1, 18) }));
    ok(state().logSet(older.id, { exerciseId: 'lib:back-squat', reps: 5, completedAt: new Date(2026, 9, 1, 18, 5).toISOString() }));
    ok(state().finishSession(older.id));
    const newer = ok(state().startSession({ title: 'Newer', at: new Date(2026, 9, 3, 18) }));
    ok(state().finishSession(newer.id));
    reload();
    expect(state().sessions.map(s => s.title)).toEqual(['Newer', 'Older']);
    expect(state().setsBySession[older.id]).toBeUndefined();
    expect(state().setCounts[older.id]).toBe(1);
    expect(state().loadSets(older.id)).toHaveLength(1);
    expect(state().exerciseHistory('lib:back-squat')).toHaveLength(1);
  });

  it('deletes a finished session and its sets', () => {
    const s = ok(state().startSession());
    ok(state().logSet(s.id, { exerciseId: 'lib:back-squat', reps: 5 }));
    ok(state().finishSession(s.id));
    state().deleteSession(s.id);
    reload();
    expect(state().sessions).toEqual([]);
    expect(dbGetWorkoutSets(s.id)).toEqual([]);
  });

  it('edits a session, refusing a blank title', () => {
    const s = ok(state().startSession({ title: 'Legs' }));
    expect(ok(state().updateSession(s.id, { title: 'Leg day', effort: 11 }))).toMatchObject({ title: 'Leg day', effort: null });
    expect(state().updateSession(s.id, { title: ' ' })).toBe('blank');
    expect(state().updateSession(s.id, { endedAt: new Date(2000, 0, 1).toISOString() })).toBe('order');
    expect(state().updateSession('nope', {})).toBe('notFound');
  });

  it('counts sessions, routines, programs and custom exercises as content', () => {
    ok(state().startSession());
    ok(state().addRoutine('A'));
    ok(state().addProgram({ name: 'P' }));
    ok(state().addExercise({ name: 'Landmine row', kind: 'weight_reps', equipment: 'barbell', primaryMuscles: ['upper_back'] }));
    expect(workoutContentCount(state())).toBe(4);
  });
});
