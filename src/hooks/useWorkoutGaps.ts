import { useMemo } from 'react';
import type { Gym, WorkoutSession, WorkoutSet } from '../types';
import { catalogExercise } from '../utils/exerciseCatalog';
import { swappableSets } from '../utils/exerciseSwap';
import {
  findGaps, gapSuggestions, muscleCredit, priorWeeks, routineSessionIds, type GapSuggestion,
} from '../utils/workoutGaps';
import {
  countsForRecords, muscleWeeks, recordSessions, sessionDayKey, weekKeyOf, type MuscleInfo,
} from '../utils/workoutRecords';
import { useSettingsStore } from '../store/useSettingsStore';
import { useWorkoutStore } from '../store/useWorkoutStore';

const NONE: readonly GapSuggestion[] = [];

/**
 * The picker's "Fills a gap" rows for a live workout: exercises for muscles the
 * workout isn't hitting, measured against its routine's history or, with none,
 * this week's volume (`findGaps`). Worked out only while the picker is open.
 *
 * `swapping` is the exercise being swapped out: its unticked sets are about to
 * move, so they don't count as hitting their muscles, and a suggestion that
 * would leave one of its main muscles at nothing says so.
 */
export function useWorkoutGaps(args: {
  open: boolean;
  session: WorkoutSession | null;
  sets: readonly WorkoutSet[];
  routineName: string | null;
  gym: Gym | null;
  swapping: string | null;
}): readonly GapSuggestion[] {
  const { open, session, sets, routineName, gym, swapping } = args;
  const exerciseRows = useWorkoutStore(s => s.exercises);
  const sessions = useWorkoutStore(s => s.sessions);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);

  return useMemo(() => {
    if (!open || !session) return NONE;
    const infoOf = (id: string): MuscleInfo | null => {
      const e = catalogExercise(exerciseRows, id);
      return e ? { kind: e.kind, primaryMuscles: e.primaryMuscles, secondaryMuscles: e.secondaryMuscles } : null;
    };
    const finished = sessions.filter(s => s.endedAt !== null && s.id !== session.id);
    const history = useWorkoutStore.getState().allSets();
    const bySession = new Map<string, WorkoutSet[]>();
    for (const s of history) {
      if (!bySession.has(s.sessionId)) bySession.set(s.sessionId, []);
      bySession.get(s.sessionId)!.push(s);
    }
    const leaving = swapping ? new Set(swappableSets(sets, swapping).map(s => s.id)) : null;
    const current = leaving ? sets.filter(s => !leaving.has(s.id)) : sets;
    const thisWeekKey = weekKeyOf(sessionDayKey(session.startedAt, dayResetTime), weekStartsOn);
    const weeks = muscleWeeks(history, recordSessions(finished, dayResetTime), infoOf, weekStartsOn);
    const ctx = {
      routineName,
      routineSessions: session.routineId
        ? routineSessionIds(finished, session.routineId, session.id).map(id => bySession.get(id) ?? [])
        : [],
      weeks: priorWeeks(weeks, thisWeekKey),
      thisWeek: weeks.get(thisWeekKey),
    };
    const { source, gaps } = findGaps(current, ctx, infoOf);
    if (gaps.length === 0) return NONE;
    const swappedInfo = swapping ? infoOf(swapping) : null;
    return gapSuggestions(exerciseRows, gaps, source, routineName, {
      exceptIds: sets.map(s => s.exerciseId),
      gym,
      knownIds: new Set(history.filter(countsForRecords).map(s => s.exerciseId)),
      leaving: swappedInfo ? { info: swappedInfo, haveAfter: muscleCredit(current, infoOf) } : undefined,
    });
  }, [open, session, sets, routineName, gym, swapping, exerciseRows, sessions, dayResetTime, weekStartsOn]);
}
