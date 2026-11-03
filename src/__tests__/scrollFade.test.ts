import {
  SCROLL_FADE_HEIGHT,
  edgeFadeOpacity,
  hiddenAbove,
  hiddenAfter,
  hiddenBefore,
  hiddenBelow,
} from '../utils/scrollFade';

const metrics = (offsetY: number, contentHeight: number, viewportHeight: number) => ({
  offsetY,
  contentHeight,
  viewportHeight,
});

describe('hiddenBelow', () => {
  it('reports the content past the bottom edge', () => {
    expect(hiddenBelow(metrics(0, 900, 600))).toBe(300);
    expect(hiddenBelow(metrics(100, 900, 600))).toBe(200);
  });

  it('is zero once the list is scrolled to its end', () => {
    expect(hiddenBelow(metrics(300, 900, 600))).toBe(0);
  });

  it('clamps a rubber-band past the end rather than going negative', () => {
    expect(hiddenBelow(metrics(340, 900, 600))).toBe(0);
  });

  it('is zero for content that fits its viewport', () => {
    expect(hiddenBelow(metrics(0, 400, 600))).toBe(0);
  });

  it('is zero until both dimensions have been measured', () => {
    expect(hiddenBelow(metrics(0, 900, 0))).toBe(0);
    expect(hiddenBelow(metrics(0, 0, 600))).toBe(0);
    expect(hiddenBelow(metrics(NaN, 900, 600))).toBe(0);
  });
});

describe('hiddenAbove', () => {
  it('is the scroll offset', () => {
    expect(hiddenAbove(metrics(120, 900, 600))).toBe(120);
  });

  it('is zero at the top, and through a rubber-band above it', () => {
    expect(hiddenAbove(metrics(0, 900, 600))).toBe(0);
    expect(hiddenAbove(metrics(-40, 900, 600))).toBe(0);
  });

  it('is zero until the list has been measured', () => {
    expect(hiddenAbove(metrics(120, 0, 0))).toBe(0);
  });
});

describe('edgeFadeOpacity', () => {
  it('is full while there is more than a band-height hidden', () => {
    expect(edgeFadeOpacity(300)).toBe(1);
    expect(edgeFadeOpacity(SCROLL_FADE_HEIGHT)).toBe(1);
  });

  it('ramps down over the last stretch instead of switching off', () => {
    expect(edgeFadeOpacity(SCROLL_FADE_HEIGHT / 2)).toBeCloseTo(0.5);
    expect(edgeFadeOpacity(SCROLL_FADE_HEIGHT / 4)).toBeCloseTo(0.25);
  });

  it('is zero at the end of the list, and within sub-pixel slack of it', () => {
    expect(edgeFadeOpacity(0)).toBe(0);
    expect(edgeFadeOpacity(0.5)).toBe(0);
    expect(edgeFadeOpacity(-3)).toBe(0);
  });

  it('honours a custom ramp distance', () => {
    expect(edgeFadeOpacity(12, 24)).toBeCloseTo(0.5);
    expect(edgeFadeOpacity(24, 24)).toBe(1);
  });

  it('falls back to a hard edge rather than dividing by a bad ramp', () => {
    expect(edgeFadeOpacity(10, 0)).toBe(1);
    expect(edgeFadeOpacity(10, NaN)).toBe(1);
  });
});

// The sideways case: the hub pill row. The vertical pair above delegate to
// these, so the rules are pinned once for each axis's names.
describe('hiddenAfter and hiddenBefore', () => {
  const axis = (offset: number, content: number, viewport: number) => ({ offset, content, viewport });

  it('report the content past the far and near ends of a row that scrolls sideways', () => {
    expect(hiddenAfter(axis(0, 520, 390))).toBe(130);
    expect(hiddenBefore(axis(0, 520, 390))).toBe(0);
    expect(hiddenAfter(axis(60, 520, 390))).toBe(70);
    expect(hiddenBefore(axis(60, 520, 390))).toBe(60);
  });

  it('show nothing past either end of a row that fits', () => {
    expect(hiddenAfter(axis(0, 300, 390))).toBe(0);
    expect(hiddenBefore(axis(0, 300, 390))).toBe(0);
  });

  it('are zero at the end, through a rubber-band, and until measured', () => {
    expect(hiddenAfter(axis(130, 520, 390))).toBe(0);
    expect(hiddenAfter(axis(150, 520, 390))).toBe(0);
    expect(hiddenBefore(axis(-30, 520, 390))).toBe(0);
    expect(hiddenAfter(axis(0, 520, 0))).toBe(0);
    expect(hiddenBefore(axis(40, 0, 390))).toBe(0);
  });

  it('agree with the vertical names for the same numbers', () => {
    for (const [offset, content, viewport] of [[0, 900, 600], [120, 900, 600], [300, 900, 600], [340, 900, 600], [-40, 900, 600]]) {
      expect(hiddenBelow(metrics(offset, content, viewport))).toBe(hiddenAfter({ offset, content, viewport }));
      expect(hiddenAbove(metrics(offset, content, viewport))).toBe(hiddenBefore({ offset, content, viewport }));
    }
  });
});
