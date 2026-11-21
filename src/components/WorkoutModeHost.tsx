import React, { useEffect } from 'react';
import { DeliverablePromptQueue } from './DeliverablePromptQueue';
import { useWorkoutModeStore } from '../store/useWorkoutModeStore';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { useStepTimerStore } from '../store/useStepTimerStore';
import { useAnswerFirstCompletion } from '../hooks/useAnswerFirstCompletion';
import { useRestChime } from '../hooks/useRestTimer';

/**
 * What workout mode needs app-wide while its page (`WorkoutModeScreen`) is
 * not the one showing, mounted once beside the navigator the way `CookRecap`
 * is. The page itself is a root-stack card, opened through
 * `useWorkoutModeStore`.
 *
 * Three things live here rather than on the page:
 *
 * - **Dropping a rest whose session is over**, however it ended, so the
 *   workout store never has to reach into the timers.
 * - **The buzz when a rest runs out** (`useRestChime`), which has to come
 *   whatever screen is showing, not only while the page is up.
 * - **The question a linked task asks on completion.** Saving leaves the
 *   page and hands the task over (`askAfterClose`); the queue asks it once the
 *   page has finished leaving, because a sheet presented while the pop is
 *   still animating is dropped. The navigator marks that moment
 *   (`markAskReady`), and a timeout covers a transition that never reports,
 *   so the question is late rather than lost.
 */
export function WorkoutModeHost() {
  const ask = useWorkoutModeStore(s => s.ask);
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
  const askPending = ask !== null && !ask.ready;
  useEffect(() => {
    if (!askPending) return;
    const fallback = setTimeout(() => useWorkoutModeStore.getState().markAskReady(), ASK_FALLBACK_MS);
    return () => clearTimeout(fallback);
  }, [askPending]);
  const readyTaskId = ask?.ready ? ask.taskId : null;
  useEffect(() => {
    if (!readyTaskId) return;
    useWorkoutModeStore.getState().clearAsk();
    enqueue([readyTaskId]);
  }, [readyTaskId, enqueue]);
  return <DeliverablePromptQueue {...queueProps} />;
}

// Longer than a native-stack pop, so it only ever fires when `transitionEnd` didn't.
const ASK_FALLBACK_MS = 1500;
