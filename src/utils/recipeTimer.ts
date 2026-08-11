import type { Recipe } from '../types';

/**
 * Countdown math for a recipe's cook timer — the same banked-segment design
 * as src/utils/timer.ts for timed tasks, with Recipe.estimatedMinutes as the
 * target duration instead of Task.timedMinutes. See that file's header for
 * why nothing but the two raw fields (`timerStartedAt`, `timerElapsedSeconds`)
 * is ever stored: how much time has elapsed or remains is always *derived*
 * against the current clock, so a phone backgrounded or killed mid-cook comes
 * back with the right answer for free.
 *
 * Recipe has no separate "timed vs. estimated" split the way Task does
 * (estimatedMinutes for workload, timedMinutes as an opt-in countdown
 * target) — a recipe's duration and the length to time it for are the same
 * number, so `estimatedMinutes` alone doubles as the target here.
 */
export type CookTimerState = Pick<Recipe, 'estimatedMinutes' | 'timerElapsedSeconds' | 'timerStartedAt'>;

/** Does this recipe have a duration to count down against? A non-positive value is treated as none. */
export function hasCookTimer(recipe: CookTimerState): boolean {
  return recipe.estimatedMinutes != null && recipe.estimatedMinutes > 0;
}

/** Is a run segment in flight right now? */
export function isCookTimerRunning(recipe: CookTimerState): boolean {
  return recipe.timerStartedAt !== null;
}

/** Total seconds spent cooking, banked segments plus the one currently running. */
export function cookTimerElapsed(recipe: CookTimerState, now: number = Date.now()): number {
  const banked = Math.max(0, recipe.timerElapsedSeconds ?? 0);
  if (recipe.timerStartedAt === null) return banked;
  const started = new Date(recipe.timerStartedAt).getTime();
  // A clock that moved backwards (timezone change, manual set) would otherwise
  // hand back a negative segment and rewind the countdown.
  return banked + Math.max(0, (now - started) / 1000);
}

/**
 * Seconds left on the countdown. Goes negative once time is up — callers that
 * display it should clamp (`formatStopwatch` already does), but
 * `isCookTimerReady` needs the sign. Always 0 for a recipe with no duration.
 */
export function cookTimerRemaining(recipe: CookTimerState, now: number = Date.now()): number {
  if (!hasCookTimer(recipe)) return 0;
  return (recipe.estimatedMinutes as number) * 60 - cookTimerElapsed(recipe, now);
}

/** How far through the countdown, 0–1. 0 for a recipe with no duration. */
export function cookTimerProgress(recipe: CookTimerState, now: number = Date.now()): number {
  if (!hasCookTimer(recipe)) return 0;
  const total = (recipe.estimatedMinutes as number) * 60;
  return Math.min(1, Math.max(0, cookTimerElapsed(recipe, now) / total));
}

/** Has the countdown run out? Never blocks anything — it's purely what the UI shows. */
export function isCookTimerReady(recipe: CookTimerState, now: number = Date.now()): boolean {
  return hasCookTimer(recipe) && cookTimerRemaining(recipe, now) <= 0;
}
