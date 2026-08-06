/**
 * One shared heartbeat for UI whose content is derived from the wall clock.
 *
 * A task row's time-derived values — a deadline countdown, a window's
 * "2h 15m left", whether that window has opened or expired yet — go stale on
 * their own, with no store mutation to trigger the re-render that would
 * refresh them. Before `TaskItem` was memoized these stayed current *by
 * accident*: an unmemoized row re-renders whenever its parent does, and on
 * Today something was always re-rendering the parent. Memoizing the row
 * removes that accident, so the heartbeat has to become explicit.
 *
 * Deliberately one interval for the whole app rather than one per row. The
 * timer tick inside `TaskItem` is already gated on `timerRunning` precisely to
 * avoid keeping an interval alive on every idle row; a per-row clock tick
 * would be that same cost paid by every row at once, forever.
 */

/** How long a row's clock-derived text is allowed to sit stale. */
export const NOW_TICK_MS = 30_000;

type Listener = (now: number) => void;

const listeners = new Set<Listener>();
let interval: ReturnType<typeof setInterval> | null = null;

function emit(): void {
  const now = Date.now();
  // Snapshotted before iterating: a listener that unsubscribes as it's
  // notified (a row unmounting mid-tick) would otherwise mutate the set
  // being walked.
  for (const listener of [...listeners]) listener(now);
}

/**
 * Start receiving the tick; returns an unsubscribe function.
 *
 * The interval is created on the first subscriber and torn down after the last
 * one leaves, so a screen with no task rows on it costs nothing at all.
 */
export function subscribeToNowTick(listener: Listener): () => void {
  listeners.add(listener);
  if (interval === null) interval = setInterval(emit, NOW_TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  };
}

/**
 * Fire the tick immediately, off-schedule.
 *
 * JS timers don't run while the app is backgrounded, so reopening it hours
 * later would otherwise leave every countdown showing its pre-background value
 * until the next interval came round. Called from the same AppState 'active'
 * handler that already refreshes the Today list.
 */
export function emitNowTick(): void {
  emit();
}
