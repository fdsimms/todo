/**
 * Fault isolation for the launch sequence.
 *
 * App.tsx runs a dozen things on mount — database init, settings load, four
 * maintenance passes, two permission requests, a native capability check. They
 * are independent of each other, and none of them is worth the whole app for:
 * a retention purge that throws should cost the purge, not the task list.
 *
 * Without this they cost the task list. A throw from a root `useEffect` has no
 * error boundary above it to stop at — `<ErrorBoundary>` is rendered *by* the
 * component running these, so it is a child and catches nothing its own parent
 * throws — and React's response to an uncaught error is to unmount the entire
 * root. The app hands off from the splash, commits its first frame, throws in
 * the effect, and is torn down to a black screen with no message anywhere. That
 * is a launch failure with the diagnosis deleted.
 *
 * So every step is named and isolated: one bad pass is logged with the name of
 * the pass and skipped, and the app opens. console.error rather than a silent
 * catch because that reaches the device log (Settings › Privacy › Analytics
 * Data on iOS) without a debugger attached, same as ErrorBoundary.
 */

import { timed } from './perfLog';
import { runUnattended } from './autoCompleteScope';

/**
 * Runs one launch step. Returns whether it got through without throwing. How
 * long it took is recorded under its name (see perfLog.ts), failed or not.
 */
export function runStartupStep(name: string, step: () => void): boolean {
  try {
    // Launch and background steps catch up on time that passed with nobody
    // there, so nothing they notice may complete a task for the person.
    runUnattended(() => timed(name, step));
    return true;
  } catch (error) {
    console.error(`Startup step "${name}" failed`, error);
    return false;
  }
}

/**
 * Runs each step in order, isolated from the others, and returns the names of
 * the ones that threw. Order is preserved and never short-circuits — a failed
 * step is skipped, not a reason to abandon the ones after it, because they
 * don't depend on each other.
 */
export function runStartupSequence(steps: Array<[string, () => void]>): string[] {
  const failed: string[] = [];
  for (const [name, step] of steps) {
    if (!runStartupStep(name, step)) failed.push(name);
  }
  return failed;
}

/** How long a run of deferred steps may hold the JS thread before it lets a tap in. */
const STEP_SLICE_MS = 8;

/**
 * `runStartupSequence` for the steps that run once the first frame is up, with
 * the JS thread handed back between slices of them. Run in one go they were a
 * single block of several dozen passes, and a tap made in the first moment
 * after the splash waited behind all of it. The order is the same and each
 * step is still isolated; `done` is called with the names that threw once the
 * last one has run. `cancel` stops before the next slice.
 */
export function runStartupSequenceSpaced(
  steps: Array<[string, () => void]>,
  done: (failed: string[]) => void,
): { cancel: () => void } {
  const failed: string[] = [];
  let next = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let cancelled = false;
  const slice = () => {
    timer = null;
    const started = Date.now();
    while (next < steps.length) {
      const [name, step] = steps[next++];
      if (!runStartupStep(name, step)) failed.push(name);
      if (next < steps.length && Date.now() - started >= STEP_SLICE_MS) {
        timer = setTimeout(slice, 0);
        return;
      }
    }
    if (!cancelled) done(failed);
  };
  slice();
  return {
    cancel() {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      next = steps.length;
    },
  };
}

