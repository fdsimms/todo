import type { WorkoutProgram, WorkoutSession } from '../types';
import { describeProgress, liveRotation, programProgress, programSessions, weekLabel } from '../utils/workoutProgram';

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
    notes: '', effort: null, healthWorkoutId: null, healthWritePending: false, ...over,
  };
}

beforeEach(() => { day = 0; });

describe('programProgress', () => {
  it('starts at the first routine, week 1', () => {
    expect(programProgress(program(), [])).toEqual({
      sessionsDone: 0, passes: 0, nextIndex: 0, nextRoutineId: 'A', week: 1, weeks: null, cycleDone: false,
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
    expect(done).toMatchObject({ passes: 2, week: 1, weeks: 2, cycleDone: true });
    const moreOf = programProgress(p, [session('A'), session('B'), session('A'), session('B'), session('A')]);
    expect(moreOf).toMatchObject({ week: 1, cycleDone: false });
    expect(programProgress(p, [session('A'), session('B')])).toMatchObject({ week: 2, cycleDone: false });
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
    expect(describeProgress(short, programProgress(short, [session('A'), session('B')]), name)).toBe('1-week cycle done · % of max · Next: Upper A');
    expect(describeProgress(program({ rotation: [] }), programProgress(program({ rotation: [] }), []), name)).toBe('Week 1 · Rep range · No routines yet');
  });
});
