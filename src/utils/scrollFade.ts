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
 * Points of content hidden below the bottom edge, clamped at zero.
 *
 * Overscroll (a rubber-band past either end) is what the clamp is for: during
 * a bounce the offset legitimately runs past its own limits, and a negative
 * result there would otherwise flip the fade on at the very end of the list.
 */
export function hiddenBelow(m: ScrollEdgeMetrics): number {
  if (!isMeasured(m)) return 0;
  return Math.max(0, m.contentHeight - m.viewportHeight - m.offsetY);
}

/** Points of content hidden above the top edge, clamped at zero. */
export function hiddenAbove(m: ScrollEdgeMetrics): number {
  if (!isMeasured(m)) return 0;
  return Math.max(0, m.offsetY);
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
function isMeasured(m: ScrollEdgeMetrics): boolean {
  return (
    Number.isFinite(m.offsetY) &&
    Number.isFinite(m.contentHeight) &&
    Number.isFinite(m.viewportHeight) &&
    m.contentHeight > 0 &&
    m.viewportHeight > 0
  );
}
