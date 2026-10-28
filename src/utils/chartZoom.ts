/**
 * The visible slice of a chart's x-axis while it is pinched in on, in the same
 * index units the chart already plots with (a day's offset from the window's
 * start). `null` everywhere a chart holds one means "the whole window", so a
 * chart nobody has pinched draws exactly as it did before zoom existed.
 */
export interface ZoomRange {
  lo: number;
  hi: number;
}

/** What a pinch started from, so every move is measured against it, never against the last move. */
export interface PinchStart {
  range: ZoomRange;
  /** Where the fingers' midpoint sat across the plot, 0 (left edge) to 1 (right edge). */
  midFraction: number;
  /** Distance between the two fingers, in points. */
  distance: number;
}

/**
 * The narrowest slice worth drawing: a week of days, or the whole window when
 * it is already shorter. Closer than that is a handful of dots on a line with
 * nothing to compare them against.
 */
export const MIN_ZOOM_SPAN = 7;

/** Fingers closer than this are one finger as far as a ratio goes; dividing by them throws the range across the window. */
const MIN_PINCH_DISTANCE = 8;

/**
 * Fits a range inside `[0, lastIndex]`: its span is held between the minimum
 * and the whole window, then slid back inside whichever edge it overshot, so a
 * pan or a pinch stops at the ends of the data rather than drawing past them.
 */
export function clampRange(range: ZoomRange, lastIndex: number): ZoomRange {
  const whole = Math.max(lastIndex, 0);
  const minSpan = Math.min(MIN_ZOOM_SPAN, whole);
  const span = Math.min(Math.max(range.hi - range.lo, minSpan), whole);
  const lo = Math.min(Math.max(range.lo, 0), whole - span);
  return { lo, hi: lo + span };
}

/** True once a range shows less than the whole window, which is when a chart has anything to reset. */
export function isZoomed(range: ZoomRange | null, lastIndex: number): boolean {
  return range !== null && range.hi - range.lo < lastIndex - 1e-6;
}

/**
 * The range a two-finger gesture has reached. The day that was under the
 * fingers' midpoint when they landed stays under it, so spreading the fingers
 * zooms about the point being looked at and sliding them pans.
 */
export function pinchRange(
  start: PinchStart,
  midFraction: number,
  distance: number,
  lastIndex: number,
): ZoomRange {
  const startSpan = start.range.hi - start.range.lo;
  const ratio = start.distance / Math.max(distance, MIN_PINCH_DISTANCE);
  const span = startSpan * ratio;
  const anchor = start.range.lo + start.midFraction * startSpan;
  const lo = anchor - midFraction * span;
  return clampRange({ lo, hi: lo + span }, lastIndex);
}
