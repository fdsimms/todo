import { HEIGHT_EPSILON, nextMeasuredHeight } from '../utils/measuredHeight';

describe('nextMeasuredHeight', () => {
  it('accepts the first measurement', () => {
    expect(nextMeasuredHeight(null, 217.5)).toBe(217.5);
  });

  it('accepts zero as a first measurement', () => {
    // Distinct from "never measured": a caller starting at null needs to be
    // able to learn that a section really is empty.
    expect(nextMeasuredHeight(null, 0)).toBe(0);
  });

  it('keeps the previous value when nothing changed', () => {
    expect(nextMeasuredHeight(217.5, 217.5)).toBe(217.5);
  });

  it('keeps the previous value for pixel-grid rounding', () => {
    // A third of a point is what a 3x grid can shift a frame by.
    expect(nextMeasuredHeight(217.5, 217.5 + 1 / 3)).toBe(217.5);
    expect(nextMeasuredHeight(217.5, 217.5 - 1 / 3)).toBe(217.5);
    // And a half at 2x, which is the largest rounding step we can see.
    expect(nextMeasuredHeight(217.5, 217.5 - 0.49)).toBe(217.5);
  });

  it('accepts a change at or beyond the epsilon, in both directions', () => {
    expect(nextMeasuredHeight(217.5, 217.5 + HEIGHT_EPSILON)).toBe(217.5 + HEIGHT_EPSILON);
    expect(nextMeasuredHeight(217.5, 217.5 - HEIGHT_EPSILON)).toBe(217.5 - HEIGHT_EPSILON);
  });

  it('accepts a real content change', () => {
    // A row appearing or a notes line wrapping is orders of magnitude clear of
    // the guard — nothing about it should be borderline.
    expect(nextMeasuredHeight(217.5, 261)).toBe(261);
    expect(nextMeasuredHeight(261, 0)).toBe(0);
  });

  it('does not drift under repeated sub-epsilon noise', () => {
    // The failure the guard exists to stop: accepting each nudge would walk the
    // stored height away from the truth one rounding step at a time, and every
    // step is a React commit landing on whatever is animating.
    let height = nextMeasuredHeight(null, 200);
    for (let i = 0; i < 100; i++) {
      height = nextMeasuredHeight(height, 200 + (i % 2 === 0 ? 1 / 3 : -1 / 3));
    }
    expect(height).toBe(200);
  });

  it('ignores a non-finite measurement rather than storing it', () => {
    expect(nextMeasuredHeight(200, NaN)).toBe(200);
    expect(nextMeasuredHeight(200, Infinity)).toBe(200);
  });
});
