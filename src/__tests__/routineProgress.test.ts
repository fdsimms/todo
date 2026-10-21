import type { WorkoutSession, WorkoutSet } from '../types';
import { routineProgress, routineSessions, volumeForChart } from '../utils/routineProgress';
import { formatProgressChange, formatTopSetLine } from '../utils/workoutRecordText';

const SQUAT = 'lib:squat';
const CURL = 'lib:curl';
const kindOf = () => 'weight_reps' as const;

function session(id: string, month: number, day: number, extra: Partial<WorkoutSession> = {}): WorkoutSession {
  const d = new Date(2026, month - 1, day, 12);
  return {
    id, routineId: 'r1', programId: null, taskId: null, title: 'HW', startedAt: d.toISOString(),
    endedAt: new Date(d.getTime() + 3600_000).toISOString(), notes: '', effort: null,
    healthWorkoutId: null, healthWritePending: false, ...extra,
  } as WorkoutSession;
}

let n = 0;
function set(sessionId: string, exerciseId: string, weightKg: number, reps: number, extra: Partial<WorkoutSet> = {}): WorkoutSet {
  n += 1;
  return {
    id: `s${n}`, sessionId, exerciseId, position: 0, setIndex: n, kind: 'working', weightKg, reps,
    durationSeconds: null, distanceM: null, rpe: null, completedAt: '2026-10-01T10:00:00.000Z',
    supersetKey: null, note: null, ...extra,
  };
}

const run = (sessions: WorkoutSession[], sets: WorkoutSet[], exerciseIds = [SQUAT, CURL]) =>
  routineProgress({
    exerciseIds,
    sessions,
    setsBySession: new Map(sessions.map(s => [s.id, sets.filter(x => x.sessionId === s.id)])),
    kindOf,
    unit: 'kg',
    dayResetTime: '00:00',
  });

describe('routineSessions', () => {
  it('keeps this routine\'s finished workouts, oldest first', () => {
    const list = routineSessions('r1', [
      session('b', 9, 20),
      session('a', 9, 10),
      session('live', 9, 25, { endedAt: null }),
      session('other', 9, 11, { routineId: 'r2' }),
    ]);
    expect(list.map(s => s.id)).toEqual(['a', 'b']);
  });
});

describe('routineProgress', () => {
  const sessions = [session('a', 9, 10), session('b', 9, 17), session('c', 9, 24)];

  it('sums each workout\'s lifted volume and reports the percent from first to latest', () => {
    const out = run(sessions, [
      set('a', SQUAT, 100, 10), // 1000
      set('b', SQUAT, 100, 12), // 1200
      set('c', SQUAT, 100, 15), // 1500
    ]);
    expect(out.workouts).toBe(3);
    expect(out.volume.map(v => v.volumeKg)).toEqual([1000, 1200, 1500]);
    expect(out.volumeChangePercent).toBe(50);
  });

  it('leaves warm-ups and sets never checked off out of the volume', () => {
    const out = run(sessions.slice(0, 2), [
      set('a', SQUAT, 100, 10),
      set('a', SQUAT, 60, 10, { kind: 'warmup' }),
      set('a', SQUAT, 100, 10, { completedAt: null }),
      set('b', SQUAT, 100, 10),
    ]);
    expect(out.volume.map(v => v.volumeKg)).toEqual([1000, 1000]);
    expect(out.volumeChangePercent).toBe(0);
  });

  it('gives no percent with one workout of volume, and no volume for a routine with no weighted work', () => {
    expect(run([sessions[0]], [set('a', SQUAT, 100, 10)]).volumeChangePercent).toBeNull();
    const none = run(sessions.slice(0, 2), []);
    expect(none.volume).toEqual([]);
    expect(none.volumeChangePercent).toBeNull();
    expect(none.workouts).toBe(2);
  });

  it('follows each exercise\'s top set, with the change and whether the latest beat the rest', () => {
    const out = run(sessions, [
      set('a', SQUAT, 20, 10), set('b', SQUAT, 30, 10), set('c', SQUAT, 40, 10),
      set('a', CURL, 15, 10), set('b', CURL, 20, 10), set('c', CURL, 15, 10),
    ]);
    const [squat, curl] = out.exercises;
    expect(squat.plot.map(p => p.value)).toEqual([20, 30, 40]);
    expect(squat.change).toBe(20);
    expect(squat.latestIsRecord).toBe(true);
    expect(curl.change).toBe(0);
    expect(curl.latestIsRecord).toBe(false);
  });

  it('reads a lighter latest as a negative change, not a record', () => {
    const out = run(sessions.slice(0, 2), [set('a', SQUAT, 40, 10), set('b', SQUAT, 35, 10)], [SQUAT]);
    expect(out.exercises[0].change).toBe(-5);
    expect(out.exercises[0].latestIsRecord).toBe(false);
  });

  it('has a first figure but no change or record for one workout, and nothing for an exercise not done', () => {
    const out = run([sessions[0]], [set('a', SQUAT, 40, 10)]);
    expect(out.exercises[0].change).toBeNull();
    expect(out.exercises[0].latestIsRecord).toBe(false);
    expect(out.exercises[0].first?.value).toBe(40);
    expect(out.exercises[1].first).toBeNull();
    expect(out.exercises[1].workouts).toBe(0);
  });

  it('lists a repeated exercise once and uses only this routine\'s sets', () => {
    const out = run(sessions.slice(0, 1), [set('a', SQUAT, 40, 10), set('elsewhere', SQUAT, 200, 1)], [SQUAT, SQUAT]);
    expect(out.exercises).toHaveLength(1);
    expect(out.exercises[0].first?.value).toBe(40);
  });

  it('shows the figures in the unit chosen', () => {
    expect(volumeForChart(1000, 'kg')).toBe(1000);
    expect(volumeForChart(1000, 'lb')).toBe(2205);
  });
});

describe('progress wording', () => {
  const best = (value: number) => ({ value, set: set('a', SQUAT, value, 10) });

  it('signs a change and says when there is none', () => {
    expect(formatProgressChange(15, 'weight_reps', 'lb')).toBe('+15 lb');
    expect(formatProgressChange(-5, 'weight_reps', 'lb')).toBe('-5 lb');
    expect(formatProgressChange(0, 'weight_reps', 'lb')).toBe('No change');
    expect(formatProgressChange(2, 'bodyweight_reps', 'lb')).toBe('+2 reps');
    expect(formatProgressChange(1, 'bodyweight_reps', 'lb')).toBe('+1 rep');
  });

  it('names the first and latest top set, or just the one when there is one workout', () => {
    expect(formatTopSetLine(best(20), best(40), 3, 'weight_reps', 'kg')).toBe('Top set 20 → 40 kg');
    expect(formatTopSetLine(best(40), best(40), 1, 'weight_reps', 'kg')).toBe('Top set 40 kg × 10');
  });
});
