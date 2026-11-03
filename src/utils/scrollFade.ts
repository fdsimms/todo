/**
 * How much of a scrolling list is hidden past its own edges, and how strongly
 * to fade that edge to say so.
 *
 * A list bounded by chrome — a pinned footer, a sheet's bottom edge, a card
 * with a `maxHeight` — ends at a hard line whether or not there is more below
 * it. With `showsVerticalScrollIndicator={false}` on top of that (and worse,
 * `bounces={false}`), a full-looking region and a two-thirds-full one render
 * identically, so the rows past the fold are reachable only by someone who
 * already guessed they were there. `ScrollEdgeFade` dissolves the last stretch
 * of content into the surface behind it; these are the numbers behind it.
 */

/** Default height of the fade band, and the distance its opacity ramps over. */
export const SCROLL_FADE_HEIGHT = 44;

/**
 * Sub-pixel slack. Layout rounding routinely leaves a list a fraction of a
 * point short of its own content, and a fade that never quite reaches zero at
 * the bottom of the list reads as a rendering fault rather than a cue.
 */
export const SCROLL_FADE_TOLERANCE = 1;

export interface ScrollEdgeMetrics {
  /** `contentOffset.y`. */
  offsetY: number;
  /** `contentSize.height`. */
  contentHeight: number;
  /** `layoutMeasurement.height` — the visible window, not the content. */
  viewportHeight: number;
}

/**
 * The same three numbers along either axis, for a list that scrolls sideways
 * (the hub pill row). The vertical `ScrollEdgeMetrics` above is this with the
 * y names, and `hiddenBelow`/`hiddenAbove` delegate to the two functions
 * below, so there is one rule for what counts as hidden and not two.
 */
export interface ScrollAxisMetrics {
  /** `contentOffset.x` or `.y`. */
  offset: number;
  /** `contentSize.width` or `.height`. */
  content: number;
  /** `layoutMeasurement.width` or `.height` — the visible window, not the content. */
  viewport: number;
}

/** Points of content hidden past the far end (right, or bottom), clamped at zero. */
export function hiddenAfter(m: ScrollAxisMetrics): number {
  if (!isAxisMeasured(m)) return 0;
  return Math.max(0, m.content - m.viewport - m.offset);
}

/** Points of content hidden past the near end (left, or top), clamped at zero. */
export function hiddenBefore(m: ScrollAxisMetrics): number {
  if (!isAxisMeasured(m)) return 0;
  return Math.max(0, m.offset);
}

const downTheY = (m: ScrollEdgeMetrics): ScrollAxisMetrics => ({
  offset: m.offsetY,
  content: m.contentHeight,
  viewport: m.viewportHeight,
});

/**
 * Points of content hidden below the bottom edge, clamped at zero.
 *
 * Overscroll (a rubber-band past either end) is what the clamp is for: during
 * a bounce the offset legitimately runs past its own limits, and a negative
 * result there would otherwise flip the fade on at the very end of the list.
 */
export function hiddenBelow(m: ScrollEdgeMetrics): number {
  return hiddenAfter(downTheY(m));
}

/** Points of content hidden above the top edge, clamped at zero. */
export function hiddenAbove(m: ScrollEdgeMetrics): number {
  return hiddenBefore(downTheY(m));
}

/**
 * How opaque the fade at one edge should be, given the points hidden past it.
 *
 * A ramp rather than a switch: the band dissolves over the last `rampOver`
 * points of travel instead of blinking out the moment the list reaches its
 * end, which is what a boolean threshold looks like at 60fps. Below
 * `SCROLL_FADE_TOLERANCE` it is flatly zero, so a list that fits its viewport
 * carries no fade at all.
 */
export function edgeFadeOpacity(hidden: number, rampOver: number = SCROLL_FADE_HEIGHT): number {
  if (!Number.isFinite(hidden) || hidden <= SCROLL_FADE_TOLERANCE) return 0;
  if (!Number.isFinite(rampOver) || rampOver <= 0) return 1;
  return Math.min(1, hidden / rampOver);
}

/**
 * A list nobody has measured yet — either dimension still zero, or a value
 * that isn't a number — is treated as having nothing hidden. The first
 * `onLayout`/`onContentSizeChange` pair is what turns the fade on, and
 * guessing before then means a band flashing over an empty region on mount.
 */
function isAxisMeasured(m: ScrollAxisMetrics): boolean {
  return (
    Number.isFinite(m.offset) &&
    Number.isFinite(m.content) &&
    Number.isFinite(m.viewport) &&
    m.content > 0 &&
    m.viewport > 0
  );
}
