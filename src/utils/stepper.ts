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
  /**
   * How many decimal places a value keeps, when that is finer than the step.
   * A weight steps by 2.5 kg but can be typed to the quarter (a 1.25 kg plate
   * a side is 82.75 on some bars); rounded to the step's one place, stepping
   * 82.75 would land on 85.3 rather than 85.25. Defaults to the step's own.
   */
  places?: number;
  /**
   * The values a press moves between, ascending, for a counter whose step
   * isn't one size (a countdown's 15s, 30s, 45s, then whole minutes). A press
   * lands on the next rung past the current value, whether or not the value
   * is on one; `step` and `places` then only matter for rounding.
   */
  ladder?: readonly number[];
}

/** How many digits after the decimal point `n` is expressed to. */
function decimalPlaces(n: number): number {
  const s = Math.abs(n).toString();
  if (s.includes('e')) return 0;
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}

/**
 * The precision a result is rounded to: `places` where the range names one,
 * else the step's own. Rounding clears the dust a repeated fractional add
 * leaves (0.30000000000000004), and is all `places` changes.
 */
function placesFor(range: StepRange, delta: number): number {
  return range.places ?? decimalPlaces(range.step ?? delta);
}

/** Pulls a value into range, for a stored number outside the current bounds. */
export function clampCount(value: number, range: StepRange): number {
  const rounded = Number(value.toFixed(placesFor(range, 1)));
  return Math.min(range.max, Math.max(range.min, rounded));
}

/**
 * The value a stepper's field writes while it is still being typed in, or
 * null to wait for the field to close: only a number the stepper would keep
 * as typed, in range and to its own decimal places. A number that would be
 * clamped ("1" on the way to "12" with a floor of 5) or an empty field waits,
 * since writing it would move the value under the person's finger.
 *
 * Written as typed rather than on blur because a sheet's Save sits outside
 * its scroll view: tapping it doesn't blur the field, so a number typed and
 * saved at once was read before the typing (see `TextField`'s doc comment).
 * Holding + or − already sends every value along the way, so a caller sees
 * nothing it doesn't see from the keys.
 */
export function typedStepperValue(text: string, range: StepRange): number | null {
  const parsed = parseStepperInput(text, range);
  if (parsed === null) return null;
  return clampCount(parsed, range) === parsed ? parsed : null;
}

/**
 * A number typed into a stepper's field, or null for anything that isn't one.
 * On a stepper with decimal places a decimal comma reads as a point ("82,5"),
 * since that is what a phone set to much of Europe types. An integer stepper
 * has no decimal part, so a comma there is a thousands separator and the text
 * is refused ("10,000" would otherwise read as 10). `range` omitted reads as a
 * decimal stepper.
 */
export function parseStepperInput(text: string, range?: StepRange): number | null {
  const trimmed = text.trim();
  const decimal = range === undefined || placesFor(range, 1) > 0;
  const pattern = decimal ? /^-?\d*(?:[.,]\d*)?$/ : /^-?\d+$/;
  if (!pattern.test(trimmed) || !/\d/.test(trimmed)) return null;
  const n = Number(trimmed.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
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
  if (range.ladder) return stepLadder(value, delta > 0 ? 1 : -1, range);
  const places = placesFor(range, delta);
  const next = Number((value + delta).toFixed(places));
  if (next > range.max) return range.max;
  if (next < range.min) return range.allowNull ? null : range.min;
  return next;
}

/** `stepCount` for a ladder: the nearest rung above or below, then the usual clamp. */
function stepLadder(value: number, direction: 1 | -1, range: StepRange): number | null {
  const ladder = range.ladder as readonly number[];
  const eps = 1e-9;
  const next = direction > 0
    ? ladder.find(rung => rung > value + eps)
    : [...ladder].reverse().find(rung => rung < value - eps);
  if (next === undefined) return direction > 0 ? range.max : range.allowNull ? null : range.min;
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
