import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { WorkoutSession } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useDemoStore } from '../store/useDemoStore';
import { readHealthWorkouts, type HealthWorkout } from '../utils/healthWorkouts';
import { healthHistoryWindow } from '../utils/workoutHistory';

const NONE: HealthWorkout[] = [];

/**
 * Other apps' workouts for the window the Workouts history shows, read from
 * Health when the history is on screen and kept in this component's state
 * only: a reading is never stored (docs/arch/health-data.md).
 *
 * Reads only while `Read Apple Health` is on, outside demo mode (the bridge
 * refuses there too), and only while `active` (the History view is the one
 * showing). Read again on focus and on foreground, the three triggers every
 * Health read here uses, and when the window moves. A read that comes back
 * after the window moved or the view left is dropped rather than shown.
 *
 * Returns `{ workouts, windowStart }`; `windowStart` is null while nothing may
 * be read, which `interleaveHistory` takes as "no Health rows".
 */
export function useHealthWorkoutHistory(sessions: readonly WorkoutSession[], active: boolean): {
  workouts: HealthWorkout[];
  windowStart: Date | null;
} {
  const readOn = useSettingsStore(s => s.healthReadEnabled);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const demo = useDemoStore(s => s.active);
  const window = useMemo(() => healthHistoryWindow(sessions, dayResetTime), [sessions, dayResetTime]);
  const anchorMs = window ? window.anchor.getTime() : null;
  const days = window?.days ?? 0;
  const allowed = active && readOn && !demo && anchorMs !== null;

  const [workouts, setWorkouts] = useState<HealthWorkout[]>(NONE);
  const [reads, setReads] = useState(0);
  const again = useCallback(() => setReads(n => n + 1), []);

  useFocusEffect(again);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state === 'active') again(); });
    return () => sub.remove();
  }, [again]);

  useEffect(() => {
    if (!allowed) return;
    let current = true;
    void readHealthWorkouts(new Date(anchorMs!), days).then(read => {
      if (current) setWorkouts(read);
    });
    return () => { current = false; };
  }, [allowed, anchorMs, days, reads]);

  const windowStart = useMemo(() => (allowed ? new Date(anchorMs!) : null), [allowed, anchorMs]);
  return { workouts: allowed ? workouts : NONE, windowStart };
}
