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

/** Runs one launch step. Returns whether it got through without throwing. */
export function runStartupStep(name: string, step: () => void): boolean {
  try {
    step();
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
