import { useMemo } from 'react';
import type { ExerciseKind } from '../types';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { catalogExercise } from '../utils/exerciseCatalog';
import {
  analyzeAll,
  muscleWeeks,
  recentRecords,
  recentWeekBars,
  recordSessions,
  sessionsPerWeek,
  topMuscles,
  weekKeyOf,
  type MuscleInfo,
  type MuscleRow,
  type RecordEvent,
  type WeekBar,
} from '../utils/workoutRecords';

/** How many weeks of workouts the Stats bars show. */
export const WORKOUT_STATS_WEEKS = 8;

export interface WorkoutStatsRecord {
  event: RecordEvent;
  name: string;
  kind: ExerciseKind;
}

export interface WorkoutStats {
  weeks: WeekBar[];
  muscles: MuscleRow[];
  records: WorkoutStatsRecord[];
}

/**
 * What the Stats screen's WORKOUTS section shows, worked out from the workout
 * log. Null while the Workouts area is off or nothing has been finished, so
 * the screen draws no section for it.
 *
 * **Finished workouts only.** A session still in progress is not a workout yet
 * (its sets can still be unchecked), so it is handed to none of the reads: the
 * bars, the muscle sets and the records all describe the same workouts.
 *
 * Every set is read once (`allSets`) and held until the session list changes,
 * which is when a workout is finished, deleted or arrives from another device;
 * the records' own memoization is keyed on that array.
 */
export function useWorkoutStats(enabled: boolean, todayKey: string): WorkoutStats | null {
  const sessions = useWorkoutStore(s => s.sessions);
  const exercises = useWorkoutStore(s => s.exercises);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);

  const finished = useMemo(() => sessions.filter(s => s.endedAt !== null), [sessions]);
  const recSessions = useMemo(() => recordSessions(finished, dayResetTime), [finished, dayResetTime]);
  const sets = useMemo(
    () => (enabled && finished.length > 0 ? useWorkoutStore.getState().allSets() : []),
    [enabled, finished],
  );

  const lookups = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof catalogExercise>>();
    const find = (id: string) => {
      if (!cache.has(id)) cache.set(id, catalogExercise(exercises, id));
      return cache.get(id) ?? null;
    };
    return {
      find,
      kindOf: (id: string): ExerciseKind => find(id)?.kind ?? 'weight_reps',
      infoOf: (id: string): MuscleInfo | null => {
        const e = find(id);
        return e ? { kind: e.kind, primaryMuscles: e.primaryMuscles, secondaryMuscles: e.secondaryMuscles } : null;
      },
    };
  }, [exercises]);

  return useMemo(() => {
    if (!enabled || finished.length === 0) return null;
    const weeks = recentWeekBars(sessionsPerWeek(finished, dayResetTime, weekStartsOn), todayKey, weekStartsOn, WORKOUT_STATS_WEEKS);
    const thisWeek = muscleWeeks(sets, recSessions, lookups.infoOf, weekStartsOn).get(weekKeyOf(todayKey, weekStartsOn));
    const analyses = analyzeAll(sets, recSessions, lookups.kindOf);
    const records = recentRecords(analyses.values(), todayKey, 5).map(event => ({
      event,
      name: lookups.find(event.exerciseId)?.name ?? 'Unknown exercise',
      kind: lookups.kindOf(event.exerciseId),
    }));
    return { weeks, muscles: topMuscles(thisWeek, 6), records };
  }, [enabled, finished, sets, recSessions, lookups, dayResetTime, weekStartsOn, todayKey]);
}
