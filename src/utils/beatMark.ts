/**
 * The geometry of the brand mark: two dots and a check sharing one floor, in a
 * 0..1 square (multiply by a size to draw it). `scripts/generate-icon.js` draws
 * the app icon from the same construction, so a change here belongs there too.
 *
 * Laid out on a 100-unit grid, where the reasons are easiest to state:
 * - the check's stroke is 13 units, and the dots are drawn 10% fuller than half
 *   of it, because a circle reads lighter than a stroke of the same width;
 * - the dots' bottoms sit on the check's lowest point, so all three share one
 *   floor;
 * - the gap between the two dots, and between the second dot and the check, is
 *   the same 7 units. Closer than that and the second dot fuses with the check
 *   at the 29 pt size Settings and Spotlight draw.
 * Then the group is scaled to `width` of the square and centered.
 */
export interface BeatMarkGeometry {
  dots: { x: number; y: number; r: number }[];
  /** The check's three points, short arm first. */
  check: [number, number][];
  /** Half the check's stroke width. */
  halfStroke: number;
}

export function beatMarkGeometry(width = 0.7): BeatMarkGeometry {
  const w = 13;
  const gap = 7;
  const r = w * 0.55;
  const dotY = w / 2 - r;
  const S: [number, number] = [-10, -10];
  const V: [number, number] = [0, 0];
  const E: [number, number] = [19, -24];
  // The second dot clears the check's short arm by `gap`; the nearest point on
  // that arm is its round-capped start S.
  const x2 = S[0] - Math.sqrt((w / 2 + r + gap) ** 2 - (dotY - S[1]) ** 2);
  const x1 = x2 - (2 * r + gap);

  const x0 = x1 - r;
  const xMax = E[0] + w / 2;
  const y0 = E[1] - w / 2;
  const yMax = w / 2;
  const k = width / (xMax - x0);
  const cx = (x0 + xMax) / 2;
  const cy = (y0 + yMax) / 2;
  const T = ([x, y]: [number, number]): [number, number] => [0.5 + (x - cx) * k, 0.5 + (y - cy) * k];
  return {
    dots: [T([x1, dotY]), T([x2, dotY])].map(([x, y]) => ({ x, y, r: r * k })),
    check: [T(S), T(V), T(E)],
    halfStroke: (w / 2) * k,
  };
}

/**
 * The beat's step: dot, dot, check land this far apart, and the haptic's
 * light, light, heavy and the three notes in `assets/sounds/beat.wav` keep the
 * same time.
 */
export const BEAT_STEP_MS = 240;
