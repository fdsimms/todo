import {
  DEPTH_AWAY_MS,
  DEPTH_DOWN_M,
  DEPTH_MAX_FACE_M,
  DEPTH_MIN_VALID,
  DEPTH_NEAR_LOST_M,
  DEPTH_UP_M,
  MOTION_ACCEL_MS2,
  MOTION_MIN_FLATNESS,
  MOTION_MIN_MS,
  MOTION_QUIET_MS,
  MOTION_ROTATION_DPS,
  PUSHUP_MAX_COUNT,
  PUSHUP_MAX_NEAR_MS,
  PUSHUP_MIN_NEAR_MS,
  PUSHUP_MIN_REP_MS,
  depthSensorStatus,
  feedDepth,
  feedMotion,
  feedProximity,
  initialDepthState,
  initialPushupState,
  normalizePushupCount,
  pushupSensorStatus,
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

describe('what the sensor saw', () => {
  it('counts every cover, counted or not', () => {
    const s = run([[true, 0], [false, 50], [true, 1000], [false, 1500], [true, 3000]]);
    expect(s.seen).toBe(3);
    expect(s.count).toBe(1);
  });

  it('keeps why the last cover did not count, until one does', () => {
    expect(run([[true, 0], [false, PUSHUP_MIN_NEAR_MS - 1]]).lastMiss).toBe('brief');
    expect(run([[true, 0], [false, PUSHUP_MAX_NEAR_MS + 1]]).lastMiss).toBe('long');
    expect(run([[true, 0], [false, 300], [true, 400], [false, 800]]).lastMiss).toBe('soon');
    expect(run([[true, 0], [false, 50], [true, 1000], [false, 1500]]).lastMiss).toBeNull();
  });
});

describe('pushupSensorStatus', () => {
  it('says when the sensor has seen nothing', () => {
    expect(pushupSensorStatus(initialPushupState()).tone).toBe('idle');
  });

  it('names what was seen and why the last one missed', () => {
    const status = pushupSensorStatus(run([[true, 0], [false, 500], [true, 1200], [false, 1210]]));
    expect(status).toMatchObject({ tone: 'miss', line: 'Seen 2 times, 1 counted' });
    expect(status.detail).toMatch(/too quick/);
  });

  it('reads as counting once a cover counts', () => {
    expect(pushupSensorStatus(run([[true, 0], [false, 500]]))).toMatchObject({ tone: 'counting', line: 'Seen 1 time, 1 counted' });
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

/**
 * Run a list of distances (metres, or null for a lost reading) through the
 * depth counter from scratch, 100ms apart.
 */
function runDepth(distances: (number | null)[], from = initialDepthState()) {
  return distances.reduce(
    (s, distance, i) => feedDepth(s, { distance, valid: distance === null ? 0 : 1, at: i * 100 }),
    from,
  );
}

/** One full rep from a top of `top`, down to `bottom` and back. */
const rep = (top: number, bottom: number) => [top, (top + bottom) / 2, bottom, (top + bottom) / 2, top];

describe('feedDepth', () => {
  it('counts a rep on the way back up, not at the bottom', () => {
    expect(runDepth([0.55, 0.45, 0.3]).count).toBe(0);
    expect(runDepth([0.55, 0.45, 0.3, 0.45]).count).toBe(1);
  });

  it('counts a run of ordinary reps', () => {
    expect(runDepth([...rep(0.55, 0.25), ...rep(0.55, 0.25), ...rep(0.55, 0.25)]).count).toBe(3);
  });

  it('judges a rep against the person’s own top, whatever their arm length', () => {
    expect(runDepth([...rep(0.5, 0.22), ...rep(0.5, 0.22)]).count).toBe(2);
    expect(runDepth([...rep(0.75, 0.45), ...rep(0.75, 0.45)]).count).toBe(2);
  });

  it('needs the face to come down by the full travel to be down', () => {
    expect(runDepth([0.55, 0.55 - DEPTH_DOWN_M + 0.01, 0.55]).count).toBe(0);
    expect(runDepth([0.55, 0.55 - DEPTH_DOWN_M - 0.01, 0.55]).count).toBe(1);
  });

  it('measures the climb from the bottom, so a sagging top still counts', () => {
    // Each rep tops out lower than the one before it.
    const s = runDepth([0.6, 0.3, 0.6, 0.55, 0.3, 0.42, 0.5, 0.25, 0.36]);
    expect(s.count).toBe(3);
  });

  it('needs the full climb back up to count', () => {
    expect(runDepth([0.55, 0.3, 0.3 + DEPTH_UP_M - 0.01]).count).toBe(0);
    expect(runDepth([0.55, 0.3, 0.3 + DEPTH_UP_M]).count).toBe(1);
  });

  it('ignores noise while holding the top', () => {
    expect(runDepth([0.55, 0.53, 0.56, 0.52, 0.55, 0.54, 0.56, 0.53]).count).toBe(0);
  });

  it('reads a face too close to measure as down', () => {
    // The bottom of the rep is out of the camera's range.
    expect(runDepth([0.6, 0.45, 0.33, null, null, 0.33, 0.45]).count).toBe(1);
    // A lost reading only 20 cm below the top is not a full rep.
    expect(runDepth([0.55, 0.45, 0.35, null, null, 0.35, 0.47]).count).toBe(0);
  });

  it('a face flickering at the edge of the range is one rep, not one per flicker', () => {
    const s = runDepth([0.55, 0.4, 0.3, null, 0.3, null, 0.31, null, 0.3, 0.45]);
    expect(s.count).toBe(1);
  });

  it('a lost reading at the top is a dropout, not a rep', () => {
    // A short-armed top close enough that a loss there reads as near.
    expect(runDepth([0.42, null, null, 0.42, null, 0.42]).count).toBe(0);
  });

  it('a lost reading after a far one is nobody there, and changes nothing', () => {
    const s = runDepth([0.55, 0.3, 0.9, null, null]);
    expect(s.phase).toBe('up');
    expect(runDepth([0.55, 0.3, null, null]).count).toBe(0);
    expect(DEPTH_NEAR_LOST_M).toBeLessThan(0.55);
  });

  it('takes nothing past the farthest a face can be as a face', () => {
    // The ceiling, before anyone is over the phone, sets no top to come down from.
    const s = runDepth([2.4, 2.4, 0.55, 0.3, 0.45]);
    expect(s.count).toBe(1);
    expect(runDepth([DEPTH_MAX_FACE_M + 0.1]).seen).toBe(false);
  });

  it('treats a reading too little of the frame measured as lost', () => {
    const s = [0.55, 0.3].reduce(
      (st, distance, i) => feedDepth(st, { distance, valid: DEPTH_MIN_VALID - 0.01, at: i * 100 }),
      initialDepthState(),
    );
    expect(s.seen).toBe(false);
  });
});

describe('a rep too shallow to count', () => {
  it('says so once it turns back', () => {
    const s = runDepth([0.55, 0.47, 0.44, 0.5, 0.55]);
    expect(s.count).toBe(0);
    expect(s.lastMiss).toBe('shallow');
  });

  it('clears when the next rep goes deep enough', () => {
    const s = runDepth([0.55, 0.45, 0.55, 0.3]);
    expect(s.lastMiss).toBeNull();
    expect(runDepth([0.55, 0.45, 0.55, 0.3, 0.45]).count).toBe(1);
  });

  it('isn’t raised by small movements at the top', () => {
    expect(runDepth([0.55, 0.52, 0.55, 0.51, 0.54]).lastMiss).toBeNull();
  });
});

describe('depthSensorStatus', () => {
  it('looks for a face until one is over the phone', () => {
    expect(depthSensorStatus(initialDepthState()).tone).toBe('idle');
    expect(depthSensorStatus(runDepth([2.4, null])).line).toBe('Looking for your face');
  });

  it('says what to do next through a rep', () => {
    expect(depthSensorStatus(runDepth([0.55])).line).toBe('Go down');
    expect(depthSensorStatus(runDepth([0.55, 0.3])).line).toBe('Push back up');
    expect(depthSensorStatus(runDepth([0.55, 0.3, 0.45])).line).toBe('Go down');
  });

  it('says a rep was too shallow', () => {
    const status = depthSensorStatus(runDepth([0.55, 0.45, 0.55]));
    expect(status.tone).toBe('miss');
    expect(status.line).toBe('Go a little lower');
  });

  it('goes back to looking once the face has been gone a while', () => {
    const seen = runDepth([0.55]);
    const gone = (ms: number) => feedDepth(
      feedDepth(seen, { distance: 2.4, valid: 1, at: 1000 }),
      { distance: 2.4, valid: 1, at: 1000 + ms },
    );
    expect(depthSensorStatus(gone(DEPTH_AWAY_MS - 1)).tone).toBe('counting');
    expect(depthSensorStatus(gone(DEPTH_AWAY_MS)).tone).toBe('idle');
    expect(depthSensorStatus(feedDepth(gone(DEPTH_AWAY_MS), { distance: 0.55, valid: 1, at: 5000 })).tone)
      .toBe('counting');
  });
});

describe('the phone moving', () => {
  const still = { rotation: 0, acceleration: 0 };
  const shaking = { rotation: MOTION_ROTATION_DPS + 10, acceleration: 0 };
  const sliding = { rotation: 0, acceleration: MOTION_ACCEL_MS2 + 0.5 };

  /** Depth readings 100ms apart from `startAt`, with motion samples fed in at given times. */
  function runWithMotion(
    distances: number[],
    motion: { at: number; sample: { rotation: number; acceleration: number; flatness?: number } }[],
  ) {
    const events = [
      ...distances.map((distance, i) => ({ at: i * 100, distance })),
      ...motion.map(m => ({ at: m.at, sample: m.sample })),
    ].sort((a, b) => a.at - b.at);
    return events.reduce((s, e) => 'sample' in e
      ? feedMotion(s, { ...e.sample, at: e.at })
      : feedDepth(s, { distance: e.distance, valid: 1, at: e.at }), initialDepthState());
  }

  /** Samples every 50ms across [from, to] with the same motion. */
  const across = (from: number, to: number, sample: { rotation: number; acceleration: number; flatness?: number }) => {
    const out: { at: number; sample: typeof sample }[] = [];
    for (let at = from; at <= to; at += 50) out.push({ at, sample });
    return out;
  };

  it('counts a rep with the phone lying still', () => {
    expect(runWithMotion(rep(0.55, 0.25), across(0, 400, still)).count).toBe(1);
  });

  it('does not count a rep made by swinging the phone', () => {
    const s = runWithMotion(rep(0.55, 0.25), across(100, 400, shaking));
    expect(s.count).toBe(0);
    expect(s.lastMiss).toBe('moved');
  });

  it('catches a phone slid back and forth with no turning at all', () => {
    expect(runWithMotion(rep(0.55, 0.25), across(100, 400, sliding)).count).toBe(0);
  });

  it('does not count a rep with the phone held up, however smoothly it moves', () => {
    const held = { rotation: 0, acceleration: 0, flatness: MOTION_MIN_FLATNESS - 0.2 };
    expect(runWithMotion(rep(0.55, 0.25), across(100, 400, held)).count).toBe(0);
    const flat = { rotation: 0, acceleration: 0, flatness: 0.99 };
    expect(runWithMotion(rep(0.55, 0.25), across(100, 400, flat)).count).toBe(1);
  });

  it('ignores a single thump, which is shorter than the phone being moved', () => {
    const thump = [{ at: 200, sample: shaking }];
    expect(runWithMotion(rep(0.55, 0.25), thump).count).toBe(1);
    const brief = across(200, 200 + MOTION_MIN_MS - 50, shaking);
    expect(runWithMotion(rep(0.55, 0.25), brief).count).toBe(1);
  });

  it('counts the next rep once the phone is still again', () => {
    const first = runWithMotion(rep(0.55, 0.25), across(100, 400, shaking));
    // Five readings per rep, 100ms apart, continuing from the first rep.
    const next = rep(0.55, 0.25).reduce(
      (s, distance, i) => feedDepth(s, { distance, valid: 1, at: 1000 + i * 100 }),
      first,
    );
    expect(next.count).toBe(1);
  });

  it('does not count movement from before the rep started', () => {
    // The phone is put down, then the rep begins from a settled top.
    const settling = across(0, 300, shaking);
    const s = runWithMotion(
      [0.55, 0.55, 0.55, 0.55, 0.55, 0.4, 0.25, 0.4, 0.55].map(d => d),
      settling,
    );
    expect(s.count).toBe(1);
  });

  it('ignores motion just after a counted rep, which is the rep’s own haptic', () => {
    const counted = runWithMotion(rep(0.55, 0.25), []);
    const at = 400;
    const buzzed = across(at, at + MOTION_QUIET_MS - 50, shaking).reduce(
      (s, m) => feedMotion(s, { ...m.sample, at: m.at }),
      counted,
    );
    expect(buzzed.movedAt).toBeNull();
    const next = [0.55, 0.4, 0.25, 0.4, 0.55].reduce(
      (s, distance, i) => feedDepth(s, { distance, valid: 1, at: at + 100 + i * 100 }),
      buzzed,
    );
    expect(next.count).toBe(2);
  });

  it('says to keep the phone still', () => {
    const s = runWithMotion(rep(0.55, 0.25), across(100, 400, shaking));
    const status = depthSensorStatus(s);
    expect(status.tone).toBe('miss');
    expect(status.line).toBe('Keep the phone still');
  });

  it('returns the same state for a still phone, so sampling does not re-render', () => {
    const s = initialDepthState();
    expect(feedMotion(s, { ...still, at: 100 })).toBe(s);
  });
});
