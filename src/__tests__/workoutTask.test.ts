import type { Task, TaskDraft } from '../types';
import { linkedTaskLine, rotationPickFor, routineMergePatch, workoutTaskEffect } from '../utils/workoutTask';
import { newTaskFromDraft } from '../utils/taskDraft';
import { initDatabase } from '../db/database';

// The real schema in memory, as useWorkoutStore.test.ts does: the task built
// below comes from the app's own draft builder, which reads the settings,
// category and project stores.
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
      withTransactionSync(fn: () => void) { fn(); },
    }),
  };
});

beforeAll(() => {
  initDatabase();
});

const task = (draft: Partial<TaskDraft> = {}, extra: Partial<Task> = {}): Task => ({
  ...newTaskFromDraft({ title: 'Push day', dueDate: new Date(2026, 0, 1).toISOString(), ...draft }, new Date(2026, 0, 1).toISOString(), 0, false, 't1'),
  ...extra,
});

describe('workoutTaskEffect', () => {
  it('answers a task the way its own checkbox would', () => {
    expect(workoutTaskEffect(task())).toBe('complete');
    expect(workoutTaskEffect(task({ targetCount: 3, quotaPeriod: 'week', recurrenceType: 'weekly', recurrenceInterval: 1 }))).toBe('log-unit');
    expect(workoutTaskEffect(task({ deliverableKind: 'text' }))).toBe('ask');
  });

  it('completes a target on the unit that reaches its count', () => {
    expect(workoutTaskEffect(task({ targetCount: 3, quotaPeriod: 'week', recurrenceType: 'weekly', recurrenceInterval: 1 }, { progressCount: 2 })))
      .toBe('complete');
  });

  it('leaves alone a task done, archived, gone, or about not doing something', () => {
    expect(workoutTaskEffect(task({}, { completed: true }))).toBe('none');
    expect(workoutTaskEffect(task({}, { archived: true }))).toBe('none');
    expect(workoutTaskEffect(null)).toBe('none');
    expect(workoutTaskEffect(task({ polarity: 'negative' }))).toBe('none');
  });
});

describe('a repeating task that is not due yet', () => {
  it('is locked, not left to its row', () => {
    const future = new Date(2099, 0, 1).toISOString();
    expect(workoutTaskEffect(task({ recurrenceType: 'daily', recurrenceInterval: 1 }, { dueDate: future }))).toBe('locked');
  });
});

describe('linkedTaskLine', () => {
  it('says a task that is not due yet stays open, instead of pointing at its locked checkbox', () => {
    expect(linkedTaskLine('locked', 'Leg day')).toBe('“Leg day” isn’t due yet, so it stays open.');
    expect(linkedTaskLine('none', 'Leg day')).toContain('Check it off from its row');
    expect(linkedTaskLine('complete', 'Leg day')).toBe('Saving completes “Leg day”.');
  });
});

describe('a rotation', () => {
  const members = [
    { id: 'cardio', title: 'Cardio', linkUrl: null, workoutRoutineId: 'r1' },
    { id: 'rest', title: 'Rest day', linkUrl: null },
  ];
  const rotation = (extra: Partial<Task> = {}) => task({ rotationEnabled: true, rotationItems: members, recurrenceType: 'weekly', recurrenceInterval: 1 }, extra);
  const monday = new Date(2026, 8, 14);

  it('picks the member the workout belongs to, and names it in the summary', () => {
    const t = rotation();
    const member = rotationPickFor(t, { routineId: 'r1' }, monday, 1);
    expect(member?.id).toBe('cardio');
    expect(workoutTaskEffect(t, member)).toBe('pick');
    expect(linkedTaskLine('pick', 'Exercise routine', 'Cardio')).toBe('Saving logs Cardio on “Exercise routine”.');
  });

  it('is left alone when no member names the workout, or the task asks a question', () => {
    expect(workoutTaskEffect(rotation(), rotationPickFor(rotation(), { routineId: 'other' }, monday, 1))).toBe('none');
    const asks = rotation({ deliverableKind: 'text' });
    expect(rotationPickFor(asks, { routineId: 'r1' }, monday, 1)).toBeNull();
  });
});

describe('routineMergePatch', () => {
  const members = [
    { id: 'm1', title: 'Push', linkUrl: null, workoutRoutineId: 'old' },
    { id: 'm2', title: 'Run', linkUrl: null },
  ];
  const base = { completed: false, workoutRoutineId: null, rotationItems: [] };

  it('points a rotation member at the routine kept', () => {
    const patch = routineMergePatch({ ...base, rotationItems: members }, 'old', 'kept');
    expect(patch).toEqual({ rotationItems: [{ ...members[0], workoutRoutineId: 'kept' }, members[1]] });
  });

  it('points the task itself at it too', () => {
    expect(routineMergePatch({ ...base, workoutRoutineId: 'old' }, 'old', 'kept')).toEqual({ workoutRoutineId: 'kept' });
  });

  it('leaves a finished task, and one that names the routine nowhere, alone', () => {
    expect(routineMergePatch({ ...base, completed: true, workoutRoutineId: 'old', rotationItems: members }, 'old', 'kept')).toBeNull();
    expect(routineMergePatch({ ...base, rotationItems: members }, 'other', 'kept')).toBeNull();
  });
});
