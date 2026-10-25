/**
 * Deferring work until a commit is on screen, which `InteractionManager` no
 * longer does.
 *
 * In the React Native this app ships, `InteractionManager` is a deprecated stub:
 * `runAfterInteractions` hands its task to `setImmediate`, which the new
 * architecture shims onto `queueMicrotask`
 * (`Libraries/Interaction/InteractionManager.js`, `Core/setUpTimers.js`). The
 * task runs before the JS thread yields, so the render it starts lands in the
 * same frame as the commit it was meant to follow. The UI thread mounts the
 * newest commit rather than each one, so a list's first-screenful budget
 * mounted the whole list in one go anyway, and a sheet "warmed after the
 * transition" was built during it. These wait for real.
 */

export type DeferredHandle = { cancel: () => void };

/**
 * How long a native transition (a stack push or pop, a sheet sliding up)
 * takes to finish, with a little room: iOS pushes in about 350ms.
 */
export const TRANSITION_SETTLE_MS = 450;

const nextFrame: (cb: () => void) => unknown =
  typeof requestAnimationFrame === 'function'
    ? cb => requestAnimationFrame(cb)
    : cb => setTimeout(cb, 16);

const cancelFrame: (id: unknown) => void =
  typeof cancelAnimationFrame === 'function'
    ? id => cancelAnimationFrame(id as number)
    : id => clearTimeout(id as ReturnType<typeof setTimeout>);

/**
 * Runs `task` once the frame holding the current commit has been drawn: the
 * next animation frame, then a macrotask after it so that frame can paint, then
 * `delayMs` more. `cancel` is safe at any point, including after it has run.
 */
export function runAfterPaint(task: () => void, delayMs = 0): DeferredHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let frame: unknown = nextFrame(() => {
    frame = null;
    timer = setTimeout(() => {
      timer = null;
      task();
    }, delayMs);
  });
  return {
    cancel() {
      if (frame !== null) cancelFrame(frame);
      if (timer !== null) clearTimeout(timer);
      frame = null;
      timer = null;
    },
  };
}

/**
 * Runs `task` once a navigation or sheet transition started by the current
 * commit has had time to finish (`TRANSITION_SETTLE_MS` after the first paint).
 */
export function runAfterTransition(task: () => void): DeferredHandle {
  return runAfterPaint(task, TRANSITION_SETTLE_MS);
}
