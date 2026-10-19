/**
 * Whether the app may complete a task on the person's behalf right now.
 *
 * A generated task whose reason was satisfied is only ever *marked* ready by a
 * pass (`markGeneratedReady`). It completes itself as well when what satisfied
 * it was the person doing something while they are in the app. Nothing that
 * runs without them is allowed to: the launch sequence and the background
 * refresh catch up on whatever happened while the app was closed (Siri, another
 * device, Health), and a task vanishing then is the app deciding for them.
 *
 * Off until the UI says otherwise (`setAutoCompleteAttended`), so the MCP
 * server and a cold background launch, which have no UI, never complete
 * anything here. No imports on purpose: `startup.ts` and the stores both read it.
 */
let attended = false;
let unattendedDepth = 0;

/** App.tsx calls this once the interface is up; nothing else should. */
export function setAutoCompleteAttended(on: boolean): void {
  attended = on;
}

/** Runs `fn` as work nobody is watching, so no task completes itself inside it. */
export function runUnattended<T>(fn: () => T): T {
  unattendedDepth++;
  try {
    return fn();
  } finally {
    unattendedDepth--;
  }
}

export function canAutoComplete(): boolean {
  return attended && unattendedDepth === 0;
}
