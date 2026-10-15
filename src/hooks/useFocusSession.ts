import { useEffect, useState } from 'react';
import { useFocusStore } from '../store/useFocusStore';
import { useTaskStore } from '../store/useTaskStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { focusPlanOptionsFrom } from '../utils/focusSettings';
import { focusStepRemaining, isFocusRunning } from '../utils/focusPlan';
import { haptics } from '../utils/haptics';
import type { FocusSession } from '../types';

/** How often a live countdown redraws. Seconds are on screen, so one second. */
const TICK_MS = 1000;

/**
 * The focus session, kept honest and kept ticking.
 *
 * - **Ticking.** Everything about the current step is derived from the wall
 *   clock (see `utils/focusPlan.ts`), so nothing re-renders on its own as the
 *   countdown runs down. The interval exists only while a step is actually
 *   running — a paused session, an over-run one waiting on the user, and a
 *   finished one all cost nothing, which is the same gate `TaskItem` puts on
 *   its own timer tick.
 *
 * Reconciling the plan with the task list is not here: it has to happen while
 * Today is a frozen tab, so it lives in `useFocusPlanReconcile` below.
 *
 * Returns `now` alongside the session so callers pass the same instant to
 * every reader in one render, rather than each one calling `Date.now()` and
 * disagreeing by a millisecond across a countdown and its progress bar.
 */
export function useFocusSession(): { session: FocusSession | null; now: number } {
  const session = useFocusStore(s => s.session);
  const [now, setNow] = useState(() => Date.now());

  const running = session !== null && isFocusRunning(session);

  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
    // Re-armed when the step changes so the first redraw of a new step is
    // immediate rather than up to a second late.
  }, [running, session?.stepIndex, session?.stepStartedAt]);

  return { session, now };
}

/**
 * How late a step's timeout may fire and still be a finish somebody watched.
 * A timer held while the app was in the background fires the moment it comes
 * back, long after the step ran out, and a buzz then would be about nothing.
 */
const STEP_DONE_LATE_MS = 2000;

/**
 * A buzz when the running focus step runs out while the app is open.
 *
 * One timeout per step rather than a tick, so it costs nothing between
 * steps, and mounted once in App.tsx for the same reason as the reconcile
 * below: the step runs out wherever the person happens to be, and the
 * FocusBar that ticks can be mounted twice (Today and the floating bar) or
 * not at all. Running out doesn't move the session on (see focusPlan.ts), so
 * this is the only thing that happens at that moment while the app is open.
 */
export function useFocusStepDoneHaptic(): void {
  const session = useFocusStore(s => s.session);
  const running = session !== null && isFocusRunning(session);
  useEffect(() => {
    if (!session || !running) return;
    const remainingMs = focusStepRemaining(session, Date.now()) * 1000;
    // Already over: that finish happened while nobody was looking.
    if (remainingMs <= 0) return;
    const due = Date.now() + remainingMs;
    const id = setTimeout(() => {
      if (Date.now() - due > STEP_DONE_LATE_MS) return;
      haptics.timerDone();
    }, remainingMs);
    return () => clearTimeout(id);
    // The step and its running segment are what the timeout is about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, session?.stepIndex, session?.stepStartedAt]);
}

/**
 * Keeps the focus plan honest against the task list, wherever the app is.
 *
 * A task in the plan can be completed, archived or deleted from anywhere in the
 * app while the session runs, including from a tab other than Today. Feeding
 * the task list to `syncWithTasks` on every change is what drops its stretches
 * out of the plan, and what keeps the Lock Screen activity, the step alarm and
 * the app shield from describing a task that is gone. The store no-ops when
 * nothing matched, so this is cheap and can't loop: it writes `session`, never
 * `tasks`.
 *
 * Mounted once in App.tsx, not in a screen. It used to run inside the hook above,
 * which only ever mounts under Today; once a blurred tab stops rendering, that
 * stopped the reconcile whenever the user was on another tab.
 */
export function useFocusPlanReconcile(): void {
  useEffect(() => {
    const reconcile = () => {
      if (useFocusStore.getState().session === null) return;
      useFocusStore.getState().syncWithTasks(
        useTaskStore.getState().tasks,
        focusPlanOptionsFrom(useSettingsStore.getState()),
      );
    };
    const unsubTasks = useTaskStore.subscribe((state, prev) => {
      if (state.tasks !== prev.tasks) reconcile();
    });
    // A session that starts, or is restored, against a list that already moved.
    const unsubFocus = useFocusStore.subscribe((state, prev) => {
      if (prev.session === null && state.session !== null) reconcile();
    });
    reconcile();
    return () => { unsubTasks(); unsubFocus(); };
  }, []);
}
