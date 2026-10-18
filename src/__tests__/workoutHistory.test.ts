jest.mock('../utils/healthBridge', () => ({ healthBridge: () => null }));

import type { WorkoutSession } from '../types';
import type { HealthWorkout } from '../utils/healthWorkouts';
import {
  HEALTH_HISTORY_MAX_DAYS,
  healthHistoryWindow,
  healthWorkoutLine,
  healthWorkoutSource,
  healthWorkoutTitle,
  interleaveHistory,
} from '../utils/workoutHistory';

/** Local wall-clock instants, so the tests read the same in every zone. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo, d, h, mi);

function session(id: string, start: Date): WorkoutSession {
  return {
    id, routineId: null, programId: null, taskId: null, title: id,
    startedAt: start.toISOString(), endedAt: new Date(start.getTime() + 3_600_000).toISOString(),
    notes: '', effort: null, healthWorkoutId: null, healthWritePending: false,
  };
}

function workout(start: Date, over: Partial<HealthWorkout> = {}): HealthWorkout {
  return {
    start, end: new Date(start.getTime() + 1_800_000), activity: 'running',
    durationSeconds: 1830, sourceName: 'Strava', energyKcal: null, ...over,
  };
}

const NOW = at(2026, 9, 18, 12);

describe('healthHistoryWindow', () => {
  it('reads nothing with no sessions, since the history shows its empty state', () => {
    expect(healthHistoryWindow([], '00:00', NOW)).toBeNull();
  });

  it('spans the oldest listed session\'s day through today', () => {
    const w = healthHistoryWindow([session('a', at(2026, 9, 17, 18)), session('b', at(2026, 9, 12, 7))], '00:00', NOW)!;
    expect(w.anchor).toEqual(at(2026, 9, 12));
    expect(w.days).toBe(7);
  });

  it('starts each day at the reset time, so a 1 AM session belongs to the day before', () => {
    const w = healthHistoryWindow([session('late', at(2026, 9, 15, 1))], '04:00', NOW)!;
    expect(w.anchor).toEqual(at(2026, 9, 14, 4));
    expect(w.days).toBe(5);
  });

  it('reads no further back than the cap however old the history is', () => {
    const w = healthHistoryWindow([session('old', at(2024, 0, 1, 9))], '00:00', NOW)!;
    expect(w.days).toBe(HEALTH_HISTORY_MAX_DAYS);
    expect(w.anchor).toEqual(at(2026, 6, 21));
  });
});

describe('interleaveHistory', () => {
  const sessions = [session('upper', at(2026, 9, 17, 18)), session('lower', at(2026, 9, 15, 18))];

  it('puts other apps\' workouts between the sessions, newest first', () => {
    const rows = interleaveHistory(sessions, [workout(at(2026, 9, 16, 7)), workout(at(2026, 9, 14, 7), { activity: 'yoga' })], at(2026, 9, 14));
    expect(rows.map(r => (r.kind === 'session' ? r.session.id : r.workout.activity))).toEqual(['upper', 'running', 'lower', 'yoga']);
  });

  it('adds nothing when nothing came back, or nothing may be read', () => {
    expect(interleaveHistory(sessions, [], at(2026, 9, 14)).map(r => r.key)).toEqual(['upper', 'lower']);
    expect(interleaveHistory(sessions, [workout(at(2026, 9, 16, 7))], null).map(r => r.key)).toEqual(['upper', 'lower']);
  });

  it('leaves out a workout that ended before the window, and puts a session first on a tie', () => {
    const rows = interleaveHistory(sessions, [workout(at(2026, 9, 1, 7)), workout(at(2026, 9, 17, 18))], at(2026, 9, 15));
    expect(rows.map(r => r.kind)).toEqual(['session', 'health', 'session']);
  });

  it('keys each Health row apart from the sessions and from each other', () => {
    const rows = interleaveHistory([], [workout(at(2026, 9, 16, 7)), workout(at(2026, 9, 16, 7), { sourceName: 'Watch' })], at(2026, 9, 1));
    expect(new Set(rows.map(r => r.key)).size).toBe(2);
  });
});

describe('the words on a Health row', () => {
  it('names the source, and says only "From Health" when it gave none', () => {
    expect(healthWorkoutSource(workout(NOW))).toBe('From Health · Strava');
    expect(healthWorkoutSource(workout(NOW, { sourceName: '' }))).toBe('From Health');
  });

  it('calls it by its activity, "Workout" for one the table does not name', () => {
    expect(healthWorkoutTitle(workout(NOW))).toBe('Running');
    expect(healthWorkoutTitle(workout(NOW, { activity: 'other' }))).toBe('Workout');
  });

  it('gives the day and the source\'s own duration, and the day alone when it sent none', () => {
    expect(healthWorkoutLine(workout(at(2026, 9, 16, 7)))).toBe('Fri, Oct 16 · 31 min');
    expect(healthWorkoutLine(workout(at(2026, 9, 16, 7), { durationSeconds: null }))).toBe('Fri, Oct 16');
  });
});
