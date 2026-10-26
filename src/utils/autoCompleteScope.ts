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

/**
 * Whether a row that could play a requested completion is on screen to do it.
 * Today is the only place those rows live, and it is frozen while another tab
 * is focused, so a record saved from the Journal or Mood tab has no row to play
 * the tick. The store then holds the request rather than completing the task
 * with nothing to see (`requestAutoComplete`), and Today resumes it on focus.
 * On unless Today says otherwise, so a store test or the MCP server is unchanged.
 */
let rowsLive = true;

export function setAutoCompleteRowsLive(on: boolean): void {
  rowsLive = on;
}

export function autoCompleteRowsLive(): boolean {
  return rowsLive;
}

export function canAutoComplete(): boolean {
  return attended && unattendedDepth === 0;
}
