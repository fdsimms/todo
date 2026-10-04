/**
 * The multiplier a fixed text-bearing dimension (an alignment column's width,
 * a list row's pinned height) should be scaled by, given the system font scale
 * and the cap `AppFont.tsx` holds every `Text` to.
 *
 * Text never grows past the cap, so neither does the box. And the box never
 * shrinks below its drawn size at a smaller system setting: shrunk text still
 * fits, and a column or row narrower than the one the layout was drawn at gains
 * nothing and can cut into padding that isn't scaling with it.
 *
 * A garbage scale (0, NaN) reads as 1, the size the layout was drawn at.
 */
export function clampTextScale(fontScale: number, cap: number): number {
  if (!Number.isFinite(fontScale) || fontScale <= 1) return 1;
  return Math.min(fontScale, Math.max(1, cap));
}

/** `size` grown with the text it holds; see `clampTextScale`. Rounded to a whole point. */
export function scaledTextBox(size: number, fontScale: number, cap: number): number {
  return Math.round(size * clampTextScale(fontScale, cap));
}
