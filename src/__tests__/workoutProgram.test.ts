import type { WorkoutProgram, WorkoutSession } from '../types';
import { currentProgram, describeProgress, isRunnableProgram, liveRotation, programProgress, programSessions, weekLabel } from '../utils/workoutProgram';

const program = (over: Partial<WorkoutProgram> = {}): WorkoutProgram => ({
  id: 'p1', name: 'Upper / Lower', weeks: null, rotation: ['A', 'B'], scheme: 'double',
  trainingMaxes: [], startedAt: null, archived: false, createdAt: '2026-01-01T00:00:00.000Z', ...over,
});

let day = 0;
/** A finished session of routine `routineId`, each one a day after the last. */
function session(routineId: string | null, over: Partial<WorkoutSession> = {}): WorkoutSession {
  day += 1;
  const start = new Date(2026, 8, day, 18);
  return {
    id: `s${day}`, routineId, programId: 'p1', taskId: null, title: routineId ?? 'Workout',
    startedAt: start.toISOString(), endedAt: new Date(start.getTime() + 3600_000).toISOString(),
    notes: '', effort: null, healthWorkoutId: null, healthWritePending: false, measuredOnWatch: false, timesEdited: false, ...over,
  };
}

beforeEach(() => { day = 0; });

describe('programProgress', () => {
  it('starts at the first routine, week 1', () => {
    expect(programProgress(program(), [])).toEqual({
      sessionsDone: 0, passes: 0, nextIndex: 0, nextRoutineId: 'A', week: 1, weeks: null, cycleDone: false, cycleStartedAt: null,
    });
  });

  it('moves on one routine per finished session, and a pass is a week', () => {
    const p = programProgress(program(), [session('A'), session('B'), session('A')]);
    expect(p).toMatchObject({ sessionsDone: 3, passes: 1, nextIndex: 1, nextRoutineId: 'B', week: 2 });
  });

  it('counts only finished sessions of this program', () => {
    const p = programProgress(program(), [
      session('A'),
      session('B', { endedAt: null }),
      session('B', { programId: 'other' }),
      session('B', { programId: null }),
    ]);
    expect(p).toMatchObject({ sessionsDone: 1, nextRoutineId: 'B' });
  });

  it('follows what was done: a skipped routine is passed over', () => {
    const p = programProgress(program({ rotation: ['A', 'B', 'C'] }), [session('A'), session('C')]);
    expect(p).toMatchObject({ nextRoutineId: 'A', passes: 1, week: 2 });
  });

  it('leaves the rotation where it was for a routine it doesn’t hold', () => {
    expect(programProgress(program(), [session('A'), session('Z'), session(null)])).toMatchObject({ nextRoutineId: 'B', sessionsDone: 3 });
  });

  it('walks a rotation that comes back to a routine', () => {
    const rotation = ['A', 'B', 'A', 'C'];
    expect(programProgress(program({ rotation }), [session('A'), session('B'), session('A')]).nextRoutineId).toBe('C');
    expect(programProgress(program({ rotation }), [session('A'), session('B'), session('A'), session('C')]).nextIndex).toBe(0);
  });

  it('orders sessions by when they started, not as given', () => {
    const a = session('A');
    const b = session('B');
    expect(programProgress(program(), [b, a]).nextRoutineId).toBe('A');
  });

  it('counts weeks within a cycle and says when one has just been done', () => {
    const p = program({ weeks: 2 });
    const done = programProgress(p, [session('A'), session('B'), session('A'), session('B')]);
    expect(done).toMatchObject({ passes: 2, week: 1, weeks: 2, cycleDone: true, cycleStartedAt: null });
    // Still offered through the first week of the next cycle, with where it began.
    const cycle = [session('A'), session('B'), session('A'), session('B')];
    const first = session('A');
    const moreOf = programProgress(p, [...cycle, first]);
    expect(moreOf).toMatchObject({ week: 1, cycleDone: true, cycleStartedAt: first.startedAt });
    expect(programProgress(p, [session('A'), session('B')])).toMatchObject({ week: 2, cycleDone: false });
  });

  it('offers the next cycle when its last day was skipped', () => {
    // Week 2 of 2: A, B and C done, D (a deload day) skipped, the next cycle's A begun.
    const p = program({ rotation: ['A', 'B', 'C', 'D'], weeks: 2 });
    const cycle = [
      session('A'), session('B'), session('C'), session('D'),
      session('A'), session('B'), session('C'),
    ];
    const next = session('A');
    const done = programProgress(p, [...cycle, next]);
    expect(done).toMatchObject({ passes: 2, week: 1, nextRoutineId: 'B', cycleDone: true, cycleStartedAt: next.startedAt });
  });

  it('reads the same routine twice in a row as a redo, not a week', () => {
    const p = program({ rotation: ['Press', 'Deadlift', 'Bench', 'Squat'] });
    expect(programProgress(p, [session('Press'), session('Press')]))
      .toMatchObject({ sessionsDone: 2, passes: 0, week: 1, nextRoutineId: 'Deadlift' });
    // A two-routine rotation was the worst case: A twice made a week.
    expect(programProgress(program(), [session('A'), session('A')])).toMatchObject({ passes: 0, nextRoutineId: 'B' });
  });

  it('still moves on for a rotation of one routine', () => {
    expect(programProgress(program({ rotation: ['A'] }), [session('A'), session('A')])).toMatchObject({ passes: 2, week: 3 });
  });

  it('still reads any other earlier routine as the next week begun', () => {
    const p = program({ rotation: ['A', 'B', 'C', 'D'] });
    expect(programProgress(p, [session('A'), session('B'), session('A')])).toMatchObject({ passes: 1, week: 2, nextRoutineId: 'B' });
  });

  it('counts from startedAt, which is how a program starts over', () => {
    const old = [session('A'), session('B'), session('A')];
    const startedAt = new Date(2026, 8, day + 1).toISOString();
    expect(programProgress(program({ startedAt }), [...old, session('A')])).toMatchObject({ sessionsDone: 1, nextRoutineId: 'B' });
  });

  it('leaves out routines nobody has any more, when told which exist', () => {
    const p = program({ rotation: ['A', 'gone', 'B'] });
    expect(programProgress(p, [session('A')], [{ id: 'A' }, { id: 'B' }]).nextRoutineId).toBe('B');
    expect(liveRotation(p, null)).toEqual(['A', 'gone', 'B']);
  });

  it('has nothing next for an empty rotation', () => {
    expect(programProgress(program({ rotation: [] }), [session('A')])).toMatchObject({ nextIndex: null, nextRoutineId: null, sessionsDone: 1 });
  });
});

describe('programSessions', () => {
  it('lists the counted sessions oldest first', () => {
    const a = session('A');
    const b = session('B');
    expect(programSessions(program(), [b, a]).map(s => s.id)).toEqual([a.id, b.id]);
  });
});

describe('the words', () => {
  it('says the week, with its length when there is one', () => {
    expect(weekLabel({ week: 2, weeks: 8 })).toBe('Week 2 of 8');
    expect(weekLabel({ week: 3, weeks: null })).toBe('Week 3');
  });

  it('describes where a program is', () => {
    const name = (id: string) => ({ A: 'Upper A', B: 'Lower A' } as Record<string, string>)[id] ?? null;
    const p = program({ weeks: 8 });
    expect(describeProgress(p, programProgress(p, [session('A')]), name)).toBe('Week 1 of 8 · Rep range · Next: Lower A');
    const short = program({ weeks: 1, scheme: 'percent' });
    expect(describeProgress(program({ scheme: null }), programProgress(program({ scheme: null }), [session('A')]), name)).not.toContain('Rep range');
    expect(describeProgress(short, programProgress(short, [session('A'), session('B')]), name)).toBe('1-week program done · % of max · Next: Upper A');
    expect(describeProgress(program({ rotation: [] }), programProgress(program({ rotation: [] }), []), name)).toBe('Week 1 · Rep range · No routines yet');
  });
});

describe('currentProgram', () => {
  const a = program({ id: 'a' });
  const b = program({ id: 'b' });

  it('is the picked program when it is in use', () => {
    expect(currentProgram([a, b], 'b')).toBe(b);
  });

  it('is the only program in use when nothing is picked', () => {
    expect(currentProgram([a], null)).toBe(a);
    expect(currentProgram([a, program({ id: 'old', archived: true })], undefined)).toBe(a);
  });

  it('is none with several in use and no pick, so a caller asks', () => {
    expect(currentProgram([a, b], null)).toBeNull();
    expect(currentProgram([], null)).toBeNull();
  });

  it('passes over a pick that was archived, emptied or deleted', () => {
    expect(currentProgram([a, program({ id: 'b', archived: true })], 'b')).toBe(a);
    expect(currentProgram([a, program({ id: 'b', rotation: [] })], 'b')).toBe(a);
    expect(currentProgram([a, b], 'gone')).toBeNull();
  });

  it('needs a rotation and not to be archived to be runnable', () => {
    expect(isRunnableProgram(a)).toBe(true);
    expect(isRunnableProgram(program({ rotation: [] }))).toBe(false);
    expect(isRunnableProgram(program({ archived: true }))).toBe(false);
  });
});
