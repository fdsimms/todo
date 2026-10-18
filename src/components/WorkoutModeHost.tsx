import React, { useCallback, useEffect } from 'react';
import { WorkoutModeSheet } from './WorkoutModeSheet';
import { DeliverablePromptQueue } from './DeliverablePromptQueue';
import { useWorkoutModeStore } from '../store/useWorkoutModeStore';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useStepTimerStore } from '../store/useStepTimerStore';
import { useAnswerFirstCompletion } from '../hooks/useAnswerFirstCompletion';
import { useRestChime } from '../hooks/useRestTimer';

/**
 * Workout mode, mounted once beside the navigator, the way `CookRecap` is: a
 * task row on any screen, the Workouts screen and its Resume all open the
 * same sheet (`useWorkoutModeStore`), and a second copy mounted on a blurred
 * tab would present a second Modal for the same session.
 *
 * Three things live here rather than in the sheet:
 *
 * - **Dropping a rest whose session is over**, however it ended, so the
 *   workout store never has to reach into the timers.
 * - **The buzz when a rest runs out** (`useRestChime`), which has to come
 *   whatever screen is showing, not only while the sheet is up.
 * - **The question a linked task asks on completion.** Saving closes the
 *   sheet and hands the task here, and the queue asks it as the sheet goes:
 *   closing one sheet and opening another in one commit is safe, holding both
 *   open is not (see "Two sibling Modals" in CLAUDE.md).
 */
export function WorkoutModeHost() {
  const open = useWorkoutModeStore(s => s.open);
  const hide = useWorkoutModeStore(s => s.hide);
  const liveId = useWorkoutStore(s => s.sessions.find(x => x.endedAt === null)?.id);
  const workoutsLoaded = useWorkoutStore(s => s.initialized);
  const timersLoaded = useStepTimerStore(s => s.hydrated);
  const { enqueue, queueProps } = useAnswerFirstCompletion();
  useRestChime(liveId);
  // A rest outlives nothing: once its session is finished, thrown away or
  // deleted on another device, it goes, alarm and all. Only once both stores
  // have loaded, since mid-launch every session looks absent.
  useEffect(() => {
    if (workoutsLoaded && timersLoaded) useStepTimerStore.getState().removeRestsOutside(liveId ?? null);
  }, [workoutsLoaded, timersLoaded, liveId]);
  const onSaved = useCallback((askTaskId: string | null) => {
    if (askTaskId) enqueue([askTaskId]);
  }, [enqueue]);
  return (
    <>
      <WorkoutModeSheet visible={open} onClose={hide} onSaved={onSaved} />
      <DeliverablePromptQueue {...queueProps} />
    </>
  );
}
