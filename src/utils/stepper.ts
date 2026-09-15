/**
 * The arithmetic behind `CountStepper` — the half of a stepper that can be
 * tested without a renderer. The other half is a press handler and lives in
 * the component.
 */

export interface StepRange {
  min: number;
  max: number;
  /**
   * Whether stepping below `min` clears the value instead of sticking at the
   * floor. The editor's Daily target uses it — "not a quota" is a real state
   * and the minus key is where you'd look for it. Quick add's Target mode
   * doesn't: there the mode *is* the quota, so there's nothing to clear to.
   */
  allowNull?: boolean;
  /**
   * Where a first press from empty lands, if not `min`. For most counters
   * `min` already is the sensible landing spot (Daily target turning on at
   * 2), which is why this defaults to it. It stops being sensible once the
   * range's floor is a rare extreme rather than a plausible starting value —
   * a birth year's `min` is 1900, an absurdity floor nobody was actually born
   * near, so turning the field on at `min` meant the *next* several dozen
   * presses were spent walking away from it before reaching a real year.
   */
  start?: number;
}

/** Pulls a value into range, for a stored number outside the current bounds. */
export function clampCount(value: number, range: StepRange): number {
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/**
 * The value one press of + or − lands on.
 *
 * Deliberately steps first and clamps after, so a value already outside the
 * range walks back into it by one press rather than snapping to a bound and
 * then stepping away from it.
 */
export function stepCount(value: number | null, delta: number, range: StepRange): number | null {
  if (value === null) return delta > 0 ? (range.start ?? range.min) : null;
  const next = Math.round(value) + delta;
  if (next > range.max) return range.max;
  if (next < range.min) return range.allowNull ? null : range.min;
  return next;
}

/** Whether that press would change anything — drives the disabled state. */
export function canStep(value: number | null, delta: number, range: StepRange): boolean {
  return stepCount(value, delta, range) !== value;
}

/**
 * Delay before auto-repeat step `tick` while a key is held down (0-based).
 *
 * The long first delay is what keeps a plain tap a plain tap; after that it
 * ramps so a target of 30 is a second of holding rather than 28 taps.
 */
export function holdRepeatDelay(tick: number): number {
  if (tick <= 0) return 400;
  if (tick < 5) return 140;
  if (tick < 12) return 70;
  return 40;
}
