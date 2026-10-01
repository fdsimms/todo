/**
 * Where a popover `CardSheet` sits, given the point it was opened from.
 *
 * The card opens below the point when that is in the top half of the screen
 * and above it otherwise, so it never has to be squeezed into the short side;
 * horizontally it hugs whichever edge the point is nearer, which for a
 * header's "…" button means right under the button. It grows out of the
 * corner nearest the point, so it reads as coming from what was tapped.
 */

export interface CardAnchor {
  /** The touch's `pageX`/`pageY`. */
  x: number;
  y: number;
}

export interface CardPlacement {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  width: number;
  /** The room between the anchor and the far safe edge. */
  maxHeight: number;
  transformOrigin: string;
}

/**
 * Gap between the touch and the card's near edge. A touch lands mid-button, so
 * this has to clear the lower half of a header's 34pt icon button.
 */
export const ANCHOR_GAP = 20;
/** How far past the touch the card's corner reaches, so it sits under the finger. */
export const ANCHOR_REACH = 24;
/** The card never sits closer to a screen edge than this. */
export const ANCHOR_EDGE = 12;

export function cardAnchorPlacement(
  anchor: CardAnchor,
  window: { width: number; height: number },
  insets: { top: number; bottom: number },
  preferredWidth: number,
): CardPlacement {
  const width = Math.min(preferredWidth, window.width - ANCHOR_EDGE * 2);
  const below = anchor.y < window.height / 2;
  const onRight = anchor.x > window.width / 2;

  const vertical = below
    ? { top: Math.max(insets.top, anchor.y + ANCHOR_GAP) }
    : { bottom: Math.max(insets.bottom, window.height - anchor.y + ANCHOR_GAP) };
  const maxHeight = below
    ? window.height - (vertical.top as number) - insets.bottom - ANCHOR_EDGE
    : window.height - (vertical.bottom as number) - insets.top - ANCHOR_EDGE;

  // Under the touch where it fits, sliding in from the edge only as far as the
  // card needs to stay on screen.
  const horizontal = onRight
    ? { right: Math.max(ANCHOR_EDGE, Math.min(window.width - anchor.x - ANCHOR_REACH, window.width - width - ANCHOR_EDGE)) }
    : { left: Math.max(ANCHOR_EDGE, Math.min(anchor.x - ANCHOR_REACH, window.width - width - ANCHOR_EDGE)) };

  return {
    ...vertical,
    ...horizontal,
    width,
    maxHeight: Math.max(0, maxHeight),
    transformOrigin: `${below ? 'top' : 'bottom'} ${onRight ? 'right' : 'left'}`,
  };
}
