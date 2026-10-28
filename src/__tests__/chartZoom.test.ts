import { MIN_ZOOM_SPAN, clampRange, isZoomed, pinchRange } from '@/utils/chartZoom';

describe('clampRange', () => {
  it('leaves a range inside the window alone', () => {
    expect(clampRange({ lo: 20, hi: 60 }, 180)).toEqual({ lo: 20, hi: 60 });
  });

  it('slides a range that ran off an edge back in without changing its span', () => {
    expect(clampRange({ lo: -10, hi: 30 }, 180)).toEqual({ lo: 0, hi: 40 });
    expect(clampRange({ lo: 160, hi: 200 }, 180)).toEqual({ lo: 140, hi: 180 });
  });

  it('never shows more than the whole window or less than a week', () => {
    expect(clampRange({ lo: -50, hi: 400 }, 180)).toEqual({ lo: 0, hi: 180 });
    const narrow = clampRange({ lo: 50, hi: 51 }, 180);
    expect(narrow.hi - narrow.lo).toBe(MIN_ZOOM_SPAN);
  });

  it('holds a window shorter than a week to its own length', () => {
    expect(clampRange({ lo: 1, hi: 2 }, 5)).toEqual({ lo: 0, hi: 5 });
  });
});

describe('pinchRange', () => {
  const start = { range: { lo: 0, hi: 180 }, midFraction: 0.5, distance: 100 };

  it('is the start range when the fingers have not moved', () => {
    expect(pinchRange(start, 0.5, 100, 180)).toEqual({ lo: 0, hi: 180 });
  });

  it('halves the span when the fingers spread to twice the distance, about the midpoint', () => {
    const r = pinchRange(start, 0.5, 200, 180);
    expect(r.hi - r.lo).toBeCloseTo(90);
    expect(r.lo + (r.hi - r.lo) / 2).toBeCloseTo(90);
  });

  it('keeps the day under the fingers under them while zooming off-centre', () => {
    const r = pinchRange({ ...start, midFraction: 0.25 }, 0.25, 200, 180);
    // Day 45 was a quarter of the way across; it still is.
    expect(r.lo + 0.25 * (r.hi - r.lo)).toBeCloseTo(45);
  });

  it('pans when the midpoint slides at a constant distance', () => {
    const zoomed = { range: { lo: 60, hi: 120 }, midFraction: 0.5, distance: 100 };
    const r = pinchRange(zoomed, 0.25, 100, 180);
    expect(r.hi - r.lo).toBeCloseTo(60);
    expect(r.lo).toBeCloseTo(75);
  });

  it('zooms back out past the window and stops at it', () => {
    const zoomed = { range: { lo: 60, hi: 120 }, midFraction: 0.5, distance: 200 };
    expect(pinchRange(zoomed, 0.5, 20, 180)).toEqual({ lo: 0, hi: 180 });
  });

  it('stops zooming in at a week', () => {
    const r = pinchRange(start, 0.5, 100000, 180);
    expect(r.hi - r.lo).toBeCloseTo(MIN_ZOOM_SPAN);
  });

  it('does not throw the range across the window when the fingers touch', () => {
    const r = pinchRange(start, 0.5, 0, 180);
    expect(Number.isFinite(r.lo) && Number.isFinite(r.hi)).toBe(true);
  });
});

describe('isZoomed', () => {
  it('is false for no range and for the whole window', () => {
    expect(isZoomed(null, 180)).toBe(false);
    expect(isZoomed({ lo: 0, hi: 180 }, 180)).toBe(false);
  });

  it('is true for a slice', () => {
    expect(isZoomed({ lo: 10, hi: 90 }, 180)).toBe(true);
  });
});
