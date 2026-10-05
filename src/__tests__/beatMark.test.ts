import { beatMarkGeometry } from '../utils/beatMark';

describe('beatMarkGeometry', () => {
  const g = beatMarkGeometry();
  const [d1, d2] = g.dots;
  const [s, v] = g.check;

  it('sits the dots on the check\'s floor', () => {
    const checkFloor = v[1] + g.halfStroke;
    expect(d1.y + d1.r).toBeCloseTo(checkFloor, 6);
    expect(d2.y + d2.r).toBeCloseTo(checkFloor, 6);
  });

  it('spaces the dots and the check by one gap', () => {
    const dotGap = d2.x - d1.x - d1.r - d2.r;
    const checkGap = Math.hypot(s[0] - d2.x, s[1] - d2.y) - d2.r - g.halfStroke;
    expect(checkGap).toBeCloseTo(dotGap, 6);
    expect(dotGap).toBeGreaterThan(0);
  });

  it('centers the mark at the width it was asked for', () => {
    const left = d1.x - d1.r;
    const right = g.check[2][0] + g.halfStroke;
    expect(right - left).toBeCloseTo(0.7, 6);
    expect((left + right) / 2).toBeCloseTo(0.5, 6);
  });
});
