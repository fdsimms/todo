import { isDemoModeActive } from './demoState';

/**
 * Things arriving from outside the app — a link from a Shortcut or dictation, a
 * Live Activity's Done, a notification's Complete or Snooze — held while demo
 * mode is on and replayed against the real data when it ends.
 *
 * Each of them names real data (a real task's id, a real thing to capture),
 * and during a demo every store answers about the throwaway database instead:
 * a completion found no such task and was dropped, a dictated task landed in a
 * database about to be discarded. Refusing them would lose them just the same,
 * so they wait, the way the widget and Siri queues already do.
 *
 * In memory on purpose: demo mode itself doesn't survive a relaunch, and a
 * cold launch is never inside one.
 */
const held: Array<() => void> = [];

/** Runs `action` now, or once demo mode ends if it's on. */
export function runOrHoldForDemo(action: () => void): void {
  if (isDemoModeActive()) held.push(action);
  else action();
}

/** Runs everything held during the demo, in arrival order. */
export function replayHeldForDemo(): void {
  for (const action of held.splice(0)) {
    try {
      action();
    } catch {
      // One stale link (a task deleted since) mustn't cost the rest.
    }
  }
}
