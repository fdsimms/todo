/**
 * Hears that the device's Calendar database changed, so the in-memory calendar
 * window can be read again sooner than the next time the app is foregrounded.
 *
 * The bridge call is resolved lazily, like every other use of
 * `todo-eventkit-bridge`, so importing this loads nothing native and a test
 * never reaches the module. Where the module is missing, or the build predates
 * the event, `onEventStoreChanged` hands back a listener that never fires and
 * the foreground refresh is all there is, exactly as before.
 */

/** Calls `run` once, `delayMs` after the first `fire()`, however many follow. */
export interface CoalescedTrigger {
  fire(): void;
  cancel(): void;
}

/**
 * A burst of change notifications (one edit in the Calendar app can post
 * several) becomes one call. The window opens on the first notification and is
 * not pushed back by later ones, so a calendar that never stops changing still
 * gets read every `delayMs` rather than never.
 */
export function createCoalescedTrigger(run: () => void, delayMs: number): CoalescedTrigger {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    fire() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delayMs);
    },
    cancel() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
    },
  };
}

/** Calls `listener` when the Calendar database changes. Returns the unsubscribe. */
export function onEventStoreChanged(listener: () => void): () => void {
  try {
    const bridge = require('todo-eventkit-bridge') as typeof import('todo-eventkit-bridge');
    return bridge.addEventStoreChangeListener(listener);
  } catch {
    return () => {};
  }
}
