import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { WorkoutSession } from '../types';
import { useSettingsStore } from '../store/useSettingsStore';
import { useDemoStore } from '../store/useDemoStore';
import { healthBridge } from '../utils/healthBridge';
import { parseWorkoutHeartRate, type WorkoutHeartRate } from '../utils/heartRateZones';

/**
 * Heart rate during one workout, read back from Apple Health for the workout
 * page's card and kept in the page's state only: a reading is never stored
 * (docs/arch/health-data.md, "Heart rate during a workout").
 *
 * Read only for a workout the Apple Watch measured and saved
 * (`measuredOnWatch` with a Health id): a workout the phone wrote has nothing
 * added to it, so asking would cost a query for a certain nothing. And only
 * while `Read Apple Health` is on, outside demo mode (`healthBridge()` refuses
 * there too), and while `active` (the page is open). Read again when the
 * workout's Health id changes (the watch's arrived while the page was open, or
 * a retime replaced it) and on foreground, the triggers every Health read here
 * uses. A read that comes back after any of that changed is dropped: the
 * answer is about the id it was asked for, never shown against another.
 *
 * Null for every reason there is no card, which is one answer by Apple's
 * design: nothing measured, a refused read, the read off.
 */
export function useWorkoutHeartRate(
  session: Pick<WorkoutSession, 'healthWorkoutId' | 'measuredOnWatch'> | null,
  active: boolean,
): WorkoutHeartRate | null {
  const readOn = useSettingsStore(s => s.healthReadEnabled);
  const demo = useDemoStore(s => s.active);
  const workoutId = session?.measuredOnWatch ? session.healthWorkoutId : null;
  const allowed = active && readOn && !demo && workoutId !== null;
  const [read, setRead] = useState<{ workoutId: string; value: WorkoutHeartRate | null } | null>(null);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => { if (state === 'active') setReads(n => n + 1); });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const health = healthBridge();
    if (!health) return;
    const asked = workoutId!;
    let current = true;
    void health.readWorkoutHeartRate(asked).then(json => {
      if (current) setRead({ workoutId: asked, value: parseWorkoutHeartRate(json) });
    });
    return () => { current = false; };
  }, [allowed, workoutId, reads]);

  return allowed && read?.workoutId === workoutId ? read.value : null;
}
