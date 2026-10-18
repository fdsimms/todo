import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { RestTimer } from '../types';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useStepTimerStore } from '../store/useStepTimerStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { buildWorkoutRun, type WorkoutRun } from '../utils/workoutLiveActivity';
import { widgetBridge } from '../utils/widgetBridge';

const DEBOUNCE_MS = 300;

// Through widgetBridge(), which answers not-iOS, demo mode and a build with no
// native half at once. Optional on the bridge: a binary built before the
// workout activity has no such function, and a JS update can reach it first.
function syncNative(run: WorkoutRun | null): void {
  const bridge = widgetBridge();
  if (!bridge?.syncWorkoutLiveActivity) return;
  // Fire-and-forget: a failed reconcile must never surface in the app.
  bridge.syncWorkoutLiveActivity(run ? JSON.stringify(run) : '').catch(() => {});
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingRun: WorkoutRun | null = null;

function scheduleSync(run: WorkoutRun | null): void {
  pendingRun = run;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => syncNative(pendingRun), DEBOUNCE_MS);
}

/**
 * Keeps the workout's Live Activity in step with the live session (see
 * src/utils/workoutLiveActivity.ts). Subscribed to the stores rather than
 * threaded through every action that ticks, edits, rests or finishes, for the
 * reason `useTimerLiveActivitySync` gives; debounced, because a weight stepped
 * up and down is a burst of writes and only the last one needs saying.
 */
export function useWorkoutLiveActivitySync(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;

    const sync = () => {
      const workouts = useWorkoutStore.getState();
      const settings = useSettingsStore.getState();
      const session = workouts.liveSession();
      const rest = session
        ? useStepTimerStore.getState().timers.find((t): t is RestTimer => t.kind === 'rest' && t.sessionId === session.id) ?? null
        : null;
      scheduleSync(buildWorkoutRun(
        {
          session,
          sets: session ? workouts.setsBySession[session.id] ?? [] : [],
          exercises: workouts.exercises,
          unit: settings.workoutUnit,
          rest,
        },
        { enabled: settings.workoutLiveActivity, workoutsEnabled: settings.workoutsEnabled },
      ));
    };

    const unsubWorkouts = useWorkoutStore.subscribe((state, prev) => {
      if (
        state.sessions !== prev.sessions ||
        state.setsBySession !== prev.setsBySession ||
        state.exercises !== prev.exercises
      ) {
        sync();
      }
    });
    const unsubTimers = useStepTimerStore.subscribe((state, prev) => {
      if (state.timers !== prev.timers) sync();
    });
    const unsubSettings = useSettingsStore.subscribe((state, prev) => {
      if (
        state.workoutLiveActivity !== prev.workoutLiveActivity ||
        state.workoutsEnabled !== prev.workoutsEnabled ||
        state.workoutUnit !== prev.workoutUnit
      ) {
        sync();
      }
    });

    sync();

    return () => {
      unsubWorkouts();
      unsubTimers();
      unsubSettings();
    };
  }, []);
}
