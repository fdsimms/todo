/**
 * How soon after one foreground catch-up another is worth running.
 *
 * The catch-up (`useForegroundCatchUp`) is some forty passes over the task
 * list, and iOS reports the app as back in front for every glance away from
 * it: the notification shade, Control Centre, a Face ID prompt, a share sheet.
 * Run each time, a person tapping the moment they come back waits behind
 * passes that ran seconds ago and have nothing new to find.
 */
export const CATCH_UP_QUIET_MS = 30_000;

/** When the catch-up last ran, and the logical day it ran in. */
export interface CatchUpRun { at: number; dayKey: string }

/**
 * Whether the catch-up should run now. Always on a new logical day, which is
 * what most of its passes exist for, whatever the clock says about the gap;
 * otherwise only once `CATCH_UP_QUIET_MS` has gone by. A clock that moved
 * backwards (a time zone change, a manual set) runs it too.
 */
export function shouldCatchUp(last: CatchUpRun | null, now: number, dayKey: string): boolean {
  if (last === null || last.dayKey !== dayKey) return true;
  const since = now - last.at;
  return since < 0 || since >= CATCH_UP_QUIET_MS;
}
