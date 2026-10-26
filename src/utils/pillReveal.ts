/**
 * Where a horizontally scrolling pill row should scroll so its chosen pill is
 * on screen: a hub opened from the menu on its fifth member showed the first
 * four and left the one you were on past the edge.
 *
 * A pill already wholly in view (with `margin` to spare, the row's own
 * padding) moves nothing, so a row nobody needs to scroll never does. One that
 * isn't is centred, clamped to the ends of the row.
 */
export function pillRevealOffset(
  pill: { x: number; width: number },
  viewport: number,
  content: number,
  current: number,
  margin: number,
): number | null {
  if (viewport <= 0) return null;
  const visible = pill.x - margin >= current && pill.x + pill.width + margin <= current + viewport;
  if (visible) return null;
  const max = Math.max(0, content - viewport);
  const centred = pill.x + pill.width / 2 - viewport / 2;
  return Math.min(max, Math.max(0, centred));
}
