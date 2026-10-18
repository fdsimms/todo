/**
 * How long the workout analysis takes over a year of training: about 5,000
 * sets across 200 sessions and 30 exercises. Run with `npm run bench`; like
 * the selector benchmark it is not part of `npm test` (timings are too noisy
 * to gate on).
 *
 * "Cold" hands each run a fresh array, which is what happens after any change
 * to the log (the memoization is keyed on the array); "warm" hands the same
 * one back, which is every other render of a screen reading it.
 */
import type { ExerciseKind, MuscleGroup, WorkoutSet } from '../types';
import {
  analyzeAll,
  analyzeExercise,
  muscleWeeks,
  recentRecords,
  recordSessions,
} from '../utils/workoutRecords';

const SESSIONS = Number(process.env.BENCH_SESSIONS ?? 200);
const EXERCISES = 30;
const SETS_PER_EXERCISE = 4;
const EXERCISES_PER_SESSION = 6;
const ITERATIONS = 30;
const WARMUP = 5;

const kindOf = (): ExerciseKind => 'weight_reps';
const MUSCLES: MuscleGroup[] = ['chest', 'lats', 'quads', 'hamstrings', 'biceps', 'triceps'];
const infoOf = (id: string) => ({
  kind: 'weight_reps' as const,
  primaryMuscles: [MUSCLES[Number(id.slice(2)) % MUSCLES.length]],
  secondaryMuscles: [MUSCLES[(Number(id.slice(2)) + 1) % MUSCLES.length]],
});

function build() {
  const sessions: { id: string; startedAt: string }[] = [];
  const sets: WorkoutSet[] = [];
  for (let s = 0; s < SESSIONS; s++) {
    const started = new Date(2026, 0, 1 + Math.floor((s * 365) / SESSIONS), 18);
    sessions.push({ id: `s${s}`, startedAt: started.toISOString() });
    for (let e = 0; e < EXERCISES_PER_SESSION; e++) {
      const exerciseId = `ex${(s + e * 5) % EXERCISES}`;
      for (let i = 0; i < SETS_PER_EXERCISE; i++) {
        sets.push({
          id: `s${s}-${e}-${i}`, sessionId: `s${s}`, exerciseId, position: e, setIndex: i,
          kind: i === 0 && e % 2 === 0 ? 'warmup' : 'working',
          weightKg: 40 + ((s * 7 + e * 3) % 60), reps: 5 + ((s + i) % 6),
          durationSeconds: null, distanceM: null, rpe: null,
          completedAt: started.toISOString(), supersetKey: null, note: null,
        });
      }
    }
  }
  return { sessions, sets };
}

interface Result { name: string; median: number; p95: number }
const results: Result[] = [];

function bench(name: string, fn: () => unknown): void {
  for (let i = 0; i < WARMUP; i++) fn();
  const times: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  results.push({
    name,
    median: times[Math.floor(times.length / 2)],
    p95: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)],
  });
}

it('measures the workout records over a year of sets', () => {
  const { sessions, sets } = build();
  const recSessions = recordSessions(sessions, '00:00');
  const oneExercise = sets.filter(s => s.exerciseId === 'ex0');

  bench('analyzeAll, cold (every exercise, every record)', () => analyzeAll(sets.slice(), recSessions, kindOf));
  bench('analyzeAll, warm (same array)', () => analyzeAll(sets, recSessions, kindOf));
  bench('analyzeExercise, cold (one exercise page)', () => analyzeExercise('ex0', 'weight_reps', oneExercise.slice(), recSessions));
  bench('muscleWeeks, cold', () => muscleWeeks(sets.slice(), recSessions, infoOf, 1));
  bench('recentRecords over a warm analysis', () => recentRecords(analyzeAll(sets, recSessions, kindOf).values(), '2026-12-31'));

  const header = `\nBenchmark: ${sets.length} sets in ${sessions.length} sessions, ${ITERATIONS} runs each, times in ms\n`;
  const rows = results.map(r =>
    `  ${r.name.padEnd(54)} median ${r.median.toFixed(2).padStart(8)}   p95 ${r.p95.toFixed(2).padStart(8)}`);
  process.stdout.write(`${header}${rows.join('\n')}\n\n`);

  expect(results.every(r => Number.isFinite(r.median))).toBe(true);
}, 120000);
