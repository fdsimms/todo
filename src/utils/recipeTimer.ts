import type { Recipe } from '../types';

/**
 * Countdown math for a recipe's cook and prep timers — the same banked-segment
 * design as src/utils/timer.ts for timed tasks, with Recipe.estimatedMinutes/
 * Recipe.prepMinutes as the target duration instead of Task.timedMinutes. See
 * that file's header for why nothing but each pair's two raw fields
 * (`*TimerStartedAt`, `*TimerElapsedSeconds`) is ever stored: how much time
 * has elapsed or remains is always *derived* against the current clock, so a
 * phone backgrounded or killed mid-cook comes back with the right answer for
 * free.
 *
 * Recipe has no separate "timed vs. estimated" split the way Task does
 * (estimatedMinutes for workload, timedMinutes as an opt-in countdown
 * target) — a recipe's duration and the length to time it for are the same
 * number, so `estimatedMinutes`/`prepMinutes` each double as their own
 * timer's target here.
 *
 * Cook and prep are two independent timers (mise en place while something
 * else already simmers), each with its own raw field pair, but identical
 * math — `bankedElapsedSeconds` is that shared math, and every other
 * function below is a thin, explicitly-typed wrapper over it so a call site
 * reads "cookTimerElapsed(recipe)" rather than a generic "timerElapsed(recipe,
 * 'cook')" that leaves which fields it touches to be looked up.
 */
export type CookTimerState = Pick<Recipe, 'estimatedMinutes' | 'timerElapsedSeconds' | 'timerStartedAt'>;
export type PrepTimerState = Pick<Recipe, 'prepMinutes' | 'prepTimerElapsedSeconds' | 'prepTimerStartedAt'>;

function bankedElapsedSeconds(startedAt: string | null, bankedSeconds: number, now: number): number {
  const banked = Math.max(0, bankedSeconds ?? 0);
  if (startedAt === null) return banked;
  const started = new Date(startedAt).getTime();
  // A clock that moved backwards (timezone change, manual set) would otherwise
  // hand back a negative segment and rewind the countdown.
  return banked + Math.max(0, (now - started) / 1000);
}

/** Does this recipe have a cook duration to count down against? A non-positive value is treated as none. */
export function hasCookTimer(recipe: CookTimerState): boolean {
  return recipe.estimatedMinutes != null && recipe.estimatedMinutes > 0;
}

/** Is a cook run segment in flight right now? */
export function isCookTimerRunning(recipe: CookTimerState): boolean {
  return recipe.timerStartedAt !== null;
}

/** Total seconds spent cooking, banked segments plus the one currently running. */
export function cookTimerElapsed(recipe: CookTimerState, now: number = Date.now()): number {
  return bankedElapsedSeconds(recipe.timerStartedAt, recipe.timerElapsedSeconds, now);
}

/**
 * Seconds left on the cook countdown. Goes negative once time is up — callers
 * that display it should clamp (`formatStopwatch` already does), but
 * `isCookTimerReady` needs the sign. Always 0 for a recipe with no duration.
 */
export function cookTimerRemaining(recipe: CookTimerState, now: number = Date.now()): number {
  if (!hasCookTimer(recipe)) return 0;
  return (recipe.estimatedMinutes as number) * 60 - cookTimerElapsed(recipe, now);
}

/** How far through the cook countdown, 0–1. 0 for a recipe with no duration. */
export function cookTimerProgress(recipe: CookTimerState, now: number = Date.now()): number {
  if (!hasCookTimer(recipe)) return 0;
  const total = (recipe.estimatedMinutes as number) * 60;
  return Math.min(1, Math.max(0, cookTimerElapsed(recipe, now) / total));
}

/** Has the cook countdown run out? Never blocks anything — it's purely what the UI shows. */
export function isCookTimerReady(recipe: CookTimerState, now: number = Date.now()): boolean {
  return hasCookTimer(recipe) && cookTimerRemaining(recipe, now) <= 0;
}

/** Does this recipe have a prep duration to count down against? A non-positive value is treated as none. */
export function hasPrepTimer(recipe: PrepTimerState): boolean {
  return recipe.prepMinutes != null && recipe.prepMinutes > 0;
}

/** Is a prep run segment in flight right now? */
export function isPrepTimerRunning(recipe: PrepTimerState): boolean {
  return recipe.prepTimerStartedAt !== null;
}

/** Total seconds spent on prep, banked segments plus the one currently running. */
export function prepTimerElapsed(recipe: PrepTimerState, now: number = Date.now()): number {
  return bankedElapsedSeconds(recipe.prepTimerStartedAt, recipe.prepTimerElapsedSeconds, now);
}

/** Seconds left on the prep countdown. Always 0 for a recipe with no prep duration. */
export function prepTimerRemaining(recipe: PrepTimerState, now: number = Date.now()): number {
  if (!hasPrepTimer(recipe)) return 0;
  return (recipe.prepMinutes as number) * 60 - prepTimerElapsed(recipe, now);
}

/** How far through the prep countdown, 0–1. 0 for a recipe with no prep duration. */
export function prepTimerProgress(recipe: PrepTimerState, now: number = Date.now()): number {
  if (!hasPrepTimer(recipe)) return 0;
  const total = (recipe.prepMinutes as number) * 60;
  return Math.min(1, Math.max(0, prepTimerElapsed(recipe, now) / total));
}

/** Has the prep countdown run out? Never blocks anything — it's purely what the UI shows. */
export function isPrepTimerReady(recipe: PrepTimerState, now: number = Date.now()): boolean {
  return hasPrepTimer(recipe) && prepTimerRemaining(recipe, now) <= 0;
}
