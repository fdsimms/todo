import { maxRestingOffset, strandedScrollOffset } from '../utils/scrollClamp';

describe('maxRestingOffset', () => {
  it('is the content that does not fit in the viewport', () => {
    expect(maxRestingOffset(2000, 800)).toBe(1200);
  });

  it('is zero when the content fits', () => {
    expect(maxRestingOffset(600, 800)).toBe(0);
    expect(maxRestingOffset(800, 800)).toBe(0);
  });

  it('counts a bottom inset as scrollable range, the way UIKit does', () => {
    expect(maxRestingOffset(2000, 800, 336)).toBe(1536);
    // An inset can open scroll range on content that would otherwise have none.
    expect(maxRestingOffset(600, 800, 336)).toBe(136);
    expect(maxRestingOffset(600, 800, 100)).toBe(0);
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

  it('leaves a list resting inside a live bottom inset alone', () => {
    // Where a bounce at the end of the content settles when the list still
    // carries a keyboard inset it never heard the dismissal for. Judged
    // against the bare content this read as stranded, and the correction was
    // the jump the user saw the moment the rubber-band finished.
    expect(strandedScrollOffset(1536, 2000, 800, 336)).toBeNull();
    expect(strandedScrollOffset(1200, 2000, 800, 336)).toBeNull();
  });

  it('still pulls back a list resting below even the inset', () => {
    expect(strandedScrollOffset(1700, 2000, 800, 336)).toBe(1536);
  });

  it('treats the inset as gone when the keyboard dismissal passes zero', () => {
    // Same list as above, one keyboard dismissal later: the range it was
    // resting in no longer exists, so it has to come back to the content.
    expect(strandedScrollOffset(1536, 2000, 800, 0)).toBe(1200);
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
    expect(strandedScrollOffset(1500, 2000, 800, NaN)).toBeNull();
  });

  it('never asks for a negative offset', () => {
    expect(strandedScrollOffset(-40, 600, 800)).toBeNull();
  });
});
