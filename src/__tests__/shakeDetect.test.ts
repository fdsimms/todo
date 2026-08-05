import {
  createShakeState,
  armShakeState,
  feedShakeSample,
  isUndoActionFresh,
  ShakeSample,
  ShakeState,
  SHAKE_UPDATE_INTERVAL_MS,
  SHAKE_ARM_DELAY_MS,
  SHAKE_COOLDOWN_MS,
  SHAKE_WINDOW_MS,
  UNDO_ACTION_MAX_AGE_MS,
} from '../utils/shakeDetect';

/** Phone lying still, screen up: 1 G straight down the z axis. */
const REST: ShakeSample = { x: 0, y: 0, z: -1 };

/** Feed a run of samples at the real update interval, returning fire count. */
function feed(state: ShakeState, samples: ShakeSample[], startAt: number): number {
  let fires = 0;
  samples.forEach((s, i) => {
    if (feedShakeSample(state, s, startAt + i * SHAKE_UPDATE_INTERVAL_MS)) fires++;
  });
  return fires;
}

/** Settle the gravity estimate on a still phone before the interesting part. */
function settled(startAt = 0): { state: ShakeState; at: number } {
  const state = createShakeState();
  const held = 40;
  feed(state, Array(held).fill(REST), startAt);
  return { state, at: startAt + held * SHAKE_UPDATE_INTERVAL_MS };
}

/** A shake: `swings` alternating jolts along x, one sample of rest between. */
function shakeSamples(swings: number, magnitude = 2): ShakeSample[] {
  const out: ShakeSample[] = [];
  for (let i = 0; i < swings; i++) {
    out.push({ x: i % 2 === 0 ? magnitude : -magnitude, y: 0, z: -1 });
    out.push(REST);
  }
  return out;
}

describe('feedShakeSample', () => {
  it('fires on a deliberate back-and-forth shake', () => {
    const { state, at } = settled();
    expect(feed(state, shakeSamples(6), at)).toBe(1);
  });

  it('ignores a phone sitting still', () => {
    const { state, at } = settled();
    expect(feed(state, Array(60).fill(REST), at)).toBe(0);
  });

  it('ignores a single hard jolt, however sharp — the pickup/knock case', () => {
    const { state, at } = settled();
    const knock = [REST, { x: 0, y: 0, z: -9 }, { x: 0, y: 0, z: -6 }, REST, REST, REST];
    expect(feed(state, knock, at)).toBe(0);
  });

  it('ignores a single flick — one swing out and back is not a shake', () => {
    const { state, at } = settled();
    expect(feed(state, shakeSamples(1), at)).toBe(0);
  });

  it('ignores two swings, the most an incidental bump plausibly produces', () => {
    const { state, at } = settled();
    expect(feed(state, shakeSamples(2), at)).toBe(0);
  });

  it('absorbs a sustained one-way push as gravity rather than counting it', () => {
    const { state, at } = settled();
    const push: ShakeSample[] = Array(30).fill({ x: 3, y: 0, z: -1 });
    expect(feed(state, push, at)).toBe(0);
  });

  it('ignores one hard swing spread across several samples', () => {
    const { state, at } = settled();
    // A ~250ms half-sine: one physical motion, many samples over threshold.
    const swing: ShakeSample[] = [];
    for (let i = 0; i <= 5; i++) {
      swing.push({ x: 3 * Math.sin((i / 5) * Math.PI), y: 0, z: -1 });
    }
    expect(feed(state, [...swing, ...Array(10).fill(REST)], at)).toBe(0);
  });

  it('ignores gentle motion below the threshold, even when it oscillates', () => {
    const { state, at } = settled();
    expect(feed(state, shakeSamples(10, 0.5), at)).toBe(0);
  });

  it('ignores reversals spread out beyond the detection window', () => {
    const state = createShakeState();
    let now = 0;
    // Settle first, then one jolt per window — a slow rock, not a shake.
    feed(state, Array(40).fill(REST), now);
    now += 40 * SHAKE_UPDATE_INTERVAL_MS;
    let fires = 0;
    for (let i = 0; i < 8; i++) {
      if (feedShakeSample(state, { x: i % 2 === 0 ? 3 : -3, y: 0, z: -1 }, now)) fires++;
      now += SHAKE_WINDOW_MS + SHAKE_UPDATE_INTERVAL_MS;
      feedShakeSample(state, REST, now);
      now += SHAKE_UPDATE_INTERVAL_MS;
    }
    expect(fires).toBe(0);
  });

  it('fires once per shake, not once per sample over the threshold', () => {
    const { state, at } = settled();
    expect(feed(state, shakeSamples(12), at)).toBe(1);
  });

  it('re-fires only after the cooldown elapses', () => {
    const { state, at } = settled();
    expect(feed(state, shakeSamples(6), at)).toBe(1);

    const after = at + 6 * 2 * SHAKE_UPDATE_INTERVAL_MS;
    expect(feed(state, shakeSamples(6), after + SHAKE_COOLDOWN_MS + 1)).toBe(1);
  });

  it('stays quiet while disarmed, then works normally once armed', () => {
    const { state, at } = settled();
    armShakeState(state, at);

    // Everything during the arming delay is dropped, however violent.
    expect(feed(state, shakeSamples(20), at)).toBe(0);

    const armed = at + SHAKE_ARM_DELAY_MS;
    const { state: fresh, at: freshAt } = settled(armed);
    expect(feed(fresh, shakeSamples(6), freshAt)).toBe(1);
  });

  it('drops jolts accumulated before arming rather than carrying them over', () => {
    const { state, at } = settled();
    // Two reversals in, the app backgrounds and comes back.
    feed(state, shakeSamples(2), at);
    const returned = at + 2 * 2 * SHAKE_UPDATE_INTERVAL_MS;
    armShakeState(state, returned);

    // The remaining swings of that same motion must not complete a shake.
    const armed = returned + SHAKE_ARM_DELAY_MS;
    expect(feed(state, shakeSamples(2), armed)).toBe(0);
  });

  it('is not fooled by holding the phone at a different angle', () => {
    const state = createShakeState();
    // Portrait in the hand: gravity split across y and z, still 1 G total.
    const tilted: ShakeSample = { x: 0, y: -0.71, z: -0.71 };
    expect(feed(state, Array(60).fill(tilted), 0)).toBe(0);
  });

  it('treats a slow reorientation as gravity, not as motion', () => {
    const state = createShakeState();
    feed(state, Array(40).fill(REST), 0);
    let now = 40 * SHAKE_UPDATE_INTERVAL_MS;

    // Rotate from screen-up to portrait over ~2s, ending at rest.
    const steps = 40;
    let fires = 0;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * (Math.PI / 2);
      const sample = { x: 0, y: -Math.sin(angle), z: -Math.cos(angle) };
      if (feedShakeSample(state, sample, now)) fires++;
      now += SHAKE_UPDATE_INTERVAL_MS;
    }
    expect(fires).toBe(0);
  });
});

describe('isUndoActionFresh', () => {
  it('accepts an action from moments ago', () => {
    expect(isUndoActionFresh(1_000_000, 1_000_000 + 5_000)).toBe(true);
  });

  it('rejects an action older than the max age', () => {
    expect(isUndoActionFresh(1_000_000, 1_000_000 + UNDO_ACTION_MAX_AGE_MS + 1)).toBe(false);
  });

  it('rejects an unstamped action rather than assuming it is recent', () => {
    expect(isUndoActionFresh(undefined, 1_000_000)).toBe(false);
  });
});
