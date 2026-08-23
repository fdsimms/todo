import { useEffect, useState } from 'react';
import { useFocusStore } from '../store/useFocusStore';
import { useTaskStore } from '../store/useTaskStore';
import { isFocusRunning } from '../utils/focusPlan';
import type { FocusSession } from '../types';

/** How often a live countdown redraws. Seconds are on screen, so one second. */
const TICK_MS = 1000;

/**
 * The focus session, kept honest and kept ticking.
 *
 * Two jobs that every surface showing a session needs and neither of which
 * belongs in a component:
 *
 * - **Reconciling.** A task in the plan can be completed, archived or deleted
 *   from anywhere in the app while the session runs (the Today list is right
 *   behind the session sheet, and the row is still tappable there). Feeding
 *   the task list to `syncWithTasks` on every change is what drops its
 *   stretches out of the plan. The store no-ops when nothing matched, so this
 *   is cheap and can't loop: it writes `session`, never `tasks`.
 * - **Ticking.** Everything about the current step is derived from the wall
 *   clock (see `utils/focusPlan.ts`), so nothing re-renders on its own as the
 *   countdown runs down. The interval exists only while a step is actually
 *   running — a paused session, an over-run one waiting on the user, and a
 *   finished one all cost nothing, which is the same gate `TaskItem` puts on
 *   its own timer tick.
 *
 * Returns `now` alongside the session so callers pass the same instant to
 * every reader in one render, rather than each one calling `Date.now()` and
 * disagreeing by a millisecond across a countdown and its progress bar.
 */
export function useFocusSession(): { session: FocusSession | null; now: number } {
  const session = useFocusStore(s => s.session);
  const syncWithTasks = useFocusStore(s => s.syncWithTasks);
  const tasks = useTaskStore(s => s.tasks);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (session === null) return;
    syncWithTasks(tasks);
  }, [tasks, session === null, syncWithTasks]);

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
