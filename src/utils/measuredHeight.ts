/**
 * Deciding when an `onLayout` measurement is actually *new*.
 *
 * Several components measure a child and feed the result back into an animated
 * height above it (`AnimatedCollapsible`'s collapse clamp, `TaskItem`'s
 * expansion panel). That makes the measurement an input to the layout it
 * describes, so every accepted value costs a React commit — and a commit
 * landing mid-animation is visible, because a Reanimated-owned layout prop is
 * not part of React's committed tree and is re-applied *after* it.
 *
 * Layout arrives on a pixel grid (1/2pt at 2x, 1/3pt at 3x), and a frame's
 * worth of rounding is enough to make an exact `!==` comparison report a change
 * that isn't one. `EPSILON` sits above that noise and far below any real
 * content change: nothing in the app grows or shrinks by half a point.
 */

/** Half a point — larger than any pixel-grid rounding, smaller than any real change. */
export const HEIGHT_EPSILON = 0.5;

/**
 * The height to keep after a measurement: `next` when it differs meaningfully
 * from `prev`, otherwise `prev` unchanged (so `useState` bails out and no
 * commit happens).
 *
 * `null` is "never measured" and always accepts, which is what lets a caller
 * distinguish an unmeasured section from a genuinely zero-height one.
 */
export function nextMeasuredHeight(prev: number | null, next: number): number {
  if (prev === null) return next;
  if (!Number.isFinite(next)) return prev;
  return Math.abs(prev - next) < HEIGHT_EPSILON ? prev : next;
}
