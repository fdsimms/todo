import { useEffect, useState } from 'react';
import type { RestTimer } from '../types';
import { useStepTimerStore } from '../store/useStepTimerStore';
import { haptics } from '../utils/haptics';
import { isStepTimerRunning, stepTimerRemaining } from '../utils/stepTimers';

/** A workout's rest, if one is going: the one rest timer belonging to this session. */
function selectRest(sessionId: string | undefined) {
  return (s: { timers: readonly import('../types').StepTimer[] }): RestTimer | null => {
    if (sessionId === undefined) return null;
    const t = s.timers.find(x => x.kind === 'rest' && x.sessionId === sessionId);
    return t && t.kind === 'rest' ? t : null;
  };
}

/**
 * The rest on screen in workout mode: the timer, and a clock that moves once a
 * second while there is one. After it rings it keeps ticking, because a rest
 * that ends counts up rather than stopping (docs/arch/workouts.md). Pass
 * `undefined` to bind nothing, which is what a hidden sheet does.
 */
export function useRestTimer(sessionId: string | undefined): { rest: RestTimer | null; now: number } {
  const rest = useStepTimerStore(selectRest(sessionId));
  const [now, setNow] = useState(() => Date.now());
  const live = rest !== null && isStepTimerRunning(rest);
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [live]);
  return { rest, now };
}

/**
 * How late a rest's buzz may land and still be worth giving. A timer set in
 * JS is paused while the app is in the background, so one that ran out then
 * fires the moment the app comes back; a buzz then is about a rest that ended
 * minutes ago, and the notification already said so.
 */
const BUZZ_GRACE_MS = 3000;

/**
 * Buzzes when the live session's rest runs out with the app in front,
 * whatever screen is showing. The alarm is a notification, which iOS shows a
 * foreground app as a banner at best and which quiet hours suppress entirely;
 * this is the in-app half that still comes (docs/arch/workouts.md, "Rest
 * timers respect quiet hours").
 *
 * One timeout per rest rather than a clock ticking every second, so it costs
 * nothing between sets. Mounted once, app-wide, by `WorkoutModeHost`.
 */
export function useRestChime(sessionId: string | undefined): void {
  const rest = useStepTimerStore(selectRest(sessionId));
  const key = rest && isStepTimerRunning(rest) ? `${rest.id}:${rest.startedAt}:${rest.durationSeconds}:${rest.elapsedSeconds}` : null;
  useEffect(() => {
    if (!rest || !isStepTimerRunning(rest)) return;
    const remainingMs = stepTimerRemaining(rest) * 1000;
    if (remainingMs <= 0) return;
    const due = Date.now() + remainingMs;
    const timeout = setTimeout(() => {
      if (Date.now() - due <= BUZZ_GRACE_MS) haptics.timerDone();
    }, remainingMs);
    return () => clearTimeout(timeout);
    // Keyed on the fields that move the end, not on the object, which the
    // store replaces on every write to any timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
