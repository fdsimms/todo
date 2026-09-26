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
  /**
   * The counter's own granularity, for a stepper whose value isn't a whole
   * number (the weight goal's rate, in quarters of a pound). Defaults to 1,
   * which is every other counter in the app. Used only to pick a rounding
   * precision — see the note on `stepCount` below — never to force a typed
   * or stored value onto the step's own grid.
   */
  step?: number;
}

/** How many digits after the decimal point `n` is expressed to. */
function decimalPlaces(n: number): number {
  const s = Math.abs(n).toString();
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}

/** Pulls a value into range, for a stored number outside the current bounds. */
export function clampCount(value: number, range: StepRange): number {
  const rounded = Number(value.toFixed(decimalPlaces(range.step ?? 1)));
  return Math.min(range.max, Math.max(range.min, rounded));
}

/**
 * The value one press of + or − lands on.
 *
 * Deliberately steps first and clamps after, so a value already outside the
 * range walks back into it by one press rather than snapping to a bound and
 * then stepping away from it.
 *
 * **Adds `delta` to `value` directly, rather than rounding `value` to a whole
 * number first.** An earlier version did `Math.round(value) + delta`, which
 * is harmless for the app's usual whole-number counters (`Math.round` is a
 * no-op on an integer) but silently breaks a fractional one: at 0.75 with a
 * step of 0.25, `Math.round(0.75)` is `1`, so a press of − computed
 * `1 - 0.25 = 0.75` — the value it started at — and the weight goal's rate
 * stepper read as stuck at 0.75 lb/week with nowhere lower to go. `toFixed`
 * still runs on the result, at a precision derived from the range's own
 * `step`, to clear the floating-point dust a repeated fractional add
 * accumulates (`0.75 - 0.25` etc.) without rounding the value onto the step's
 * grid — an off-grid value (2,006 stepping by 100) still keeps its own offset
 * forever, exactly as the component's doc comment describes.
 */
export function stepCount(value: number | null, delta: number, range: StepRange): number | null {
  if (value === null) return delta > 0 ? (range.start ?? range.min) : null;
  const places = decimalPlaces(range.step ?? delta);
  const next = Number((value + delta).toFixed(places));
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
