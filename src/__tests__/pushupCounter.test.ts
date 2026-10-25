import {
  PUSHUP_MAX_COUNT,
  PUSHUP_MAX_NEAR_MS,
  PUSHUP_MIN_NEAR_MS,
  PUSHUP_MIN_REP_MS,
  feedProximity,
  initialPushupState,
  normalizePushupCount,
  tapRep,
} from '../utils/pushupCounter';

/** Run a list of [near, at] readings through the counter from scratch. */
function run(readings: [boolean, number][]) {
  return readings.reduce((s, [near, at]) => feedProximity(s, near, at), initialPushupState());
}

describe('feedProximity', () => {
  it('counts a rep when the sensor clears, not when it is covered', () => {
    const down = feedProximity(initialPushupState(), true, 1000);
    expect(down.count).toBe(0);
    const up = feedProximity(down, false, 1500);
    expect(up.count).toBe(1);
  });

  it('counts a run of ordinary reps', () => {
    const s = run([
      [true, 0], [false, 500],
      [true, 1200], [false, 1700],
      [true, 2400], [false, 2900],
    ]);
    expect(s.count).toBe(3);
  });

  it('ignores a cover too brief to be a body', () => {
    expect(run([[true, 0], [false, PUSHUP_MIN_NEAR_MS - 1]]).count).toBe(0);
    expect(run([[true, 0], [false, PUSHUP_MIN_NEAR_MS]]).count).toBe(1);
  });

  it('ignores a cover too long to be a pushup', () => {
    expect(run([[true, 0], [false, PUSHUP_MAX_NEAR_MS + 1]]).count).toBe(0);
  });

  it('refuses reps faster than the floor', () => {
    const s = run([
      [true, 0], [false, 300],
      [true, 400], [false, 300 + PUSHUP_MIN_REP_MS - 1],
    ]);
    expect(s.count).toBe(1);
  });

  it('a refused rep does not leave the sensor reading covered', () => {
    const s = run([[true, 0], [false, 50]]);
    expect(s.nearSince).toBeNull();
  });

  it('a repeated reading does not restart the cover', () => {
    const s = run([[true, 0], [true, 400], [false, 500]]);
    expect(s.count).toBe(1);
  });

  it('a clear with no cover before it counts nothing', () => {
    expect(run([[false, 0], [false, 1000]]).count).toBe(0);
  });
});

describe('tapRep', () => {
  it('counts a tap, held to the same rep floor', () => {
    let s = tapRep(initialPushupState(), 0);
    expect(s.count).toBe(1);
    s = tapRep(s, PUSHUP_MIN_REP_MS - 1);
    expect(s.count).toBe(1);
    s = tapRep(s, PUSHUP_MIN_REP_MS);
    expect(s.count).toBe(2);
  });
});

describe('normalizePushupCount', () => {
  it('keeps a whole positive count', () => {
    expect(normalizePushupCount(20)).toBe(20);
    expect(normalizePushupCount(12.6)).toBe(13);
  });

  it('reads anything not positive as none', () => {
    expect(normalizePushupCount(0)).toBeNull();
    expect(normalizePushupCount(-3)).toBeNull();
    expect(normalizePushupCount(NaN)).toBeNull();
    expect(normalizePushupCount(null)).toBeNull();
    expect(normalizePushupCount('20')).toBeNull();
  });

  it('caps the count', () => {
    expect(normalizePushupCount(5000)).toBe(PUSHUP_MAX_COUNT);
  });
});
