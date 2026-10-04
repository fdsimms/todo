import { BURST_GRAVITY, burstOffset, burstOpacity, burstPieces } from '../utils/coinBurst';

describe('burstPieces', () => {
  it('makes the number asked for, the same every time', () => {
    expect(burstPieces(12)).toHaveLength(12);
    expect(burstPieces(12)).toEqual(burstPieces(12));
  });

  it('fans every piece upward', () => {
    for (const p of burstPieces(20)) {
      expect(Math.sin(p.angle)).toBeLessThan(0);
    }
  });

  it('mixes coins with confetti, mostly coins', () => {
    const kinds = burstPieces(12).map(p => p.kind);
    expect(kinds.filter(k => k === 'spark').length).toBeGreaterThan(0);
    expect(kinds.filter(k => k === 'coin').length).toBeGreaterThan(kinds.filter(k => k === 'spark').length);
  });

  it('handles a single piece without dividing by zero', () => {
    const [only] = burstPieces(1);
    expect(Number.isFinite(only.angle)).toBe(true);
  });
});

describe('burstOffset', () => {
  const straightUp = { angle: -Math.PI / 2, distance: 100, turns: 1, size: 0, kind: 'coin' as const };

  it('starts at the launch point', () => {
    expect(burstOffset(straightUp, 0)).toEqual({ x: expect.closeTo(0), y: 0 });
  });

  it('rises first and falls below the launch point by the end', () => {
    expect(burstOffset(straightUp, 0.4).y).toBeLessThan(0);
    expect(burstOffset(straightUp, 1).y).toBeCloseTo(-100 + BURST_GRAVITY);
  });

  it('stays put outside 0..1', () => {
    expect(burstOffset(straightUp, 2)).toEqual(burstOffset(straightUp, 1));
    expect(burstOffset(straightUp, -1)).toEqual(burstOffset(straightUp, 0));
  });
});

describe('burstOpacity', () => {
  it('is invisible before and after the flight, solid in the first half', () => {
    expect(burstOpacity(0)).toBe(0);
    expect(burstOpacity(1)).toBe(0);
    expect(burstOpacity(0.3)).toBe(1);
  });

  it('fades on the way out', () => {
    expect(burstOpacity(0.8)).toBeGreaterThan(0);
    expect(burstOpacity(0.8)).toBeLessThan(1);
  });
});
