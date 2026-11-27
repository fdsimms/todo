/**
 * The look-away countdown: a tap on a daily target's nudge that carries
 * `Task.quotaCountdownSeconds` opens a card counting down that many seconds.
 * It exists for the 20/20/20 rule (every 20 minutes, look at something 20 feet
 * away for 20 seconds): the target and its nudges are the "every 20 minutes",
 * and this is the 20 seconds. Pure so the card and the tests share the arithmetic.
 */

/** What the editor offers when the countdown is switched on. */
export const LOOK_AWAY_DEFAULT_SECONDS = 20;
export const LOOK_AWAY_MIN_SECONDS = 5;
export const LOOK_AWAY_MAX_SECONDS = 300;

/** Clamps a stored or typed length to what the stepper allows. */
export function clampLookAwaySeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return LOOK_AWAY_DEFAULT_SECONDS;
  return Math.min(LOOK_AWAY_MAX_SECONDS, Math.max(LOOK_AWAY_MIN_SECONDS, Math.round(seconds)));
}

/** Whole seconds left in a countdown that ends at `endsAt` (ms), never below 0. Rounds up, so the card shows 20 first and 1 last. */
export function lookAwaySecondsLeft(endsAt: number, now: number): number {
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** 0 at the start of a countdown of `seconds`, 1 at its end. */
export function lookAwayProgress(endsAt: number, now: number, seconds: number): number {
  const total = seconds * 1000;
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - (endsAt - now) / total));
}
