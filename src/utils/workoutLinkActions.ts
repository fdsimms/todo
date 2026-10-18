import type { RestTimer } from '../types';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useWorkoutModeStore } from '../store/useWorkoutModeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useStepTimerStore } from '../store/useStepTimerStore';
import { resetToToday, resetToWorkouts } from '../navigation/navigationRef';
import { haptics } from './haptics';
import { planWorkoutLink, type WorkoutLink } from './workoutLink';
import { tickSet } from './workoutTick';
import { REST_NUDGE_FORWARD_SECONDS } from './stepTimers';

/**
 * What a workout link does once deepLinks.ts has parsed it: the half that
 * writes. Its own module so the URL parsing stays importable without the
 * workout stores behind it. `planWorkoutLink` (workoutLink.ts) decides whether
 * the action still applies; this applies it and opens workout mode.
 */

/**
 * Applies a workout link and opens workout mode on it. The open comes after
 * `requestDismissAllSheets` (see `useTaskDeepLinks`), which closes workout mode
 * along with every other sheet; asking for it again here is what keeps a Lock
 * Screen button from dropping the person out of their workout. Done set opens
 * it on the card the tick leads to, as a tick in the sheet would. With no
 * workout going there is nothing to open, so it lands on the Workouts screen,
 * or Today with the area switched off.
 */
export function applyWorkoutLink(link: WorkoutLink): void {
  const workouts = useWorkoutStore.getState();
  const live = workouts.liveSession();
  if (!live) {
    if (useSettingsStore.getState().workoutsEnabled) resetToWorkouts();
    else resetToToday();
    return;
  }
  const timers = useStepTimerStore.getState();
  const rest = timers.timers.find((t): t is RestTimer => t.kind === 'rest' && t.sessionId === live.id) ?? null;
  const plan = planWorkoutLink(link, live, workouts.setsBySession[live.id] ?? workouts.loadSets(live.id), rest);
  const mode = useWorkoutModeStore.getState();
  if (plan.kind === 'setDone') {
    const next = tickSet(live.id, plan.setId);
    if (next) {
      haptics.success();
      mode.showExercise(next.showExerciseId);
      return;
    }
  } else if (plan.kind === 'restAdd') {
    timers.addTime(plan.restId, REST_NUDGE_FORWARD_SECONDS);
  } else if (plan.kind === 'skipRest') {
    timers.remove(plan.restId);
  }
  mode.show();
}

/**
 * A rest's own timer activity's Done (`stopTimer?key=rest:<id>`): skips the
 * rest, the way the footer's Skip rest does, and moves nothing else on. While
 * a workout is in progress, workout mode opens again after the dismiss-all
 * that every incoming link runs, which would otherwise have closed it under
 * the person mid-workout. That holds even when the rest has already gone (
 * skipped or replaced in the app before the card caught up): the tap still
 * came from a workout's card.
 */
export function skipRestFromLink(restId: string): void {
  useStepTimerStore.getState().remove(restId);
  if (useWorkoutStore.getState().liveSession()) useWorkoutModeStore.getState().show();
}
