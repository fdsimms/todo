import { maxRestingOffset, strandedScrollOffset } from '../utils/scrollClamp';

describe('maxRestingOffset', () => {
  it('is the content that does not fit in the viewport', () => {
    expect(maxRestingOffset(2000, 800)).toBe(1200);
  });

  it('is zero when the content fits', () => {
    expect(maxRestingOffset(600, 800)).toBe(0);
    expect(maxRestingOffset(800, 800)).toBe(0);
  });
});

describe('strandedScrollOffset', () => {
  it('leaves a list resting inside its content alone', () => {
    expect(strandedScrollOffset(400, 2000, 800)).toBeNull();
  });

  it('leaves a list resting exactly at the bottom alone', () => {
    expect(strandedScrollOffset(1200, 2000, 800)).toBeNull();
  });

  it('pulls a list back when it rests below the last of its content', () => {
    expect(strandedScrollOffset(1500, 2000, 800)).toBe(1200);
  });

  it('pulls a list back to the top when the content fits the viewport', () => {
    // The keyboard-inset case: 336pt of inset scrolled into, then the keyboard
    // closes and the whole range goes away.
    expect(strandedScrollOffset(336, 600, 800)).toBe(0);
  });

  it('handles the far-offscreen inset that a blurred tab can pick up', () => {
    expect(strandedScrollOffset(4000, 600, 800)).toBe(0);
  });

  it('ignores sub-pixel overshoot from layout rounding', () => {
    expect(strandedScrollOffset(1200.4, 2000, 800)).toBeNull();
    expect(strandedScrollOffset(1202, 2000, 800)).toBe(1200);
  });

  it('leaves an unmeasured list alone', () => {
    expect(strandedScrollOffset(500, 0, 800)).toBeNull();
    expect(strandedScrollOffset(500, 2000, 0)).toBeNull();
  });

  it('leaves a list alone when a measurement is not a number', () => {
    expect(strandedScrollOffset(NaN, 2000, 800)).toBeNull();
    expect(strandedScrollOffset(500, NaN, 800)).toBeNull();
    expect(strandedScrollOffset(500, 2000, NaN)).toBeNull();
  });

  it('never asks for a negative offset', () => {
    expect(strandedScrollOffset(-40, 600, 800)).toBeNull();
  });
});
