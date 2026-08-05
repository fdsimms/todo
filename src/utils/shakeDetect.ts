/**
 * Pure shake detection for "shake to undo".
 *
 * Kept out of the hook (like reorder.ts is for drag-and-drop) so the tuning
 * can be reasoned about and tested without a device in hand.
 *
 * The thing that makes a shake a shake is that it *oscillates*: the phone
 * reverses direction several times in under a second. Single-sample
 * threshold checks can't express that, so they fire on any hard jolt —
 * setting the phone down, pulling it out of a pocket, a bump against a desk.
 * That's the whole reason a confirm dialog could appear unprompted. So this
 * detector counts direction reversals in a rolling window instead, and only
 * calls it a shake once the motion has genuinely gone back-and-forth-and-back.
 *
 * It also works on *linear* acceleration — the raw reading minus a low-pass
 * estimate of gravity — rather than on the raw magnitude. A phone at rest
 * reads 1 G, so thresholding raw magnitude means the numbers change meaning
 * depending on how the phone is being held; subtracting the gravity estimate
 * leaves only the acceleration the user actually applied.
 */

/** Accelerometer sample, in G, gravity included (expo-sensors' shape). */
export interface ShakeSample {
  x: number;
  y: number;
  z: number;
}

/** 20 Hz. A ~4-5 Hz shake needs headroom to be seen as an oscillation. */
export const SHAKE_UPDATE_INTERVAL_MS = 50;

/**
 * How hard a single jolt must be, in G, *after* gravity is removed, to count
 * toward a shake. Deliberate shaking reads well over 1 G of linear
 * acceleration; picking the phone up or tossing it on a bed usually peaks
 * below this, and — crucially — does so exactly once.
 */
export const SHAKE_THRESHOLD_G = 1.3;

/**
 * Jolts in alternating directions needed to call it a shake.
 *
 * Note that one physical swing yields *two* jolts, not one: the push out,
 * then the deceleration bringing the phone back. So this is three full
 * back-and-forth swings. A real shake runs at 4-5 Hz and clears it inside
 * the window with room to spare, while a knock (one jolt) or a single flick
 * (two) can't reach it however hard it is.
 */
export const SHAKE_JOLTS_REQUIRED = 6;

/** All of those jolts have to land inside this window to count. */
export const SHAKE_WINDOW_MS = 1200;

/** Ignore further shakes for this long after one fires. */
export const SHAKE_COOLDOWN_MS = 1500;

/**
 * How long after the app comes to the foreground before the detector arms.
 *
 * The motion that *brings you to the app* — lifting the phone off a desk,
 * pulling it from a pocket, unlocking it — is still being sampled at the
 * moment AppState flips to 'active', and any samples the native sensor
 * queued while backgrounded arrive on the JS thread after that flip too.
 * Checking AppState at sample time therefore isn't enough on its own; the
 * detector has to sit out the handover.
 */
export const SHAKE_ARM_DELAY_MS = 1500;

/**
 * Low-pass coefficient for the running gravity estimate. At 20 Hz this is a
 * ~0.3 s time constant: slow enough that a shake reads as linear
 * acceleration rather than being absorbed into the estimate, fast enough
 * that simply reorienting the phone doesn't look like sustained motion.
 */
const GRAVITY_ALPHA = 0.85;

interface Jolt {
  at: number;
  vec: ShakeSample;
}

export interface ShakeState {
  /** Running low-pass estimate of the gravity vector; null until seeded. */
  gravity: ShakeSample | null;
  /** Recent jolts, each in the opposite direction from the one before it. */
  jolts: Jolt[];
  /** Samples before this timestamp are dropped (see SHAKE_ARM_DELAY_MS). */
  armedAt: number;
  lastFiredAt: number;
}

export function createShakeState(): ShakeState {
  return { gravity: null, jolts: [], armedAt: 0, lastFiredAt: 0 };
}

/**
 * Disarm the detector until `now + delayMs`, discarding everything it had
 * accumulated. Called when the app foregrounds so that neither the pickup
 * motion nor any stale queued samples can carry over into a fresh session.
 */
export function armShakeState(state: ShakeState, now: number, delayMs = SHAKE_ARM_DELAY_MS): void {
  state.gravity = null;
  state.jolts = [];
  state.armedAt = now + delayMs;
}

function dot(a: ShakeSample, b: ShakeSample): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Feed one accelerometer sample. Returns true on the sample that completes a
 * shake — at which point the state is reset and the cooldown starts, so a
 * single continuous shake fires exactly once.
 */
export function feedShakeSample(state: ShakeState, sample: ShakeSample, now: number): boolean {
  if (now < state.armedAt) return false;

  // Seed the gravity estimate from the first sample after arming; there's no
  // baseline to measure against yet, so this sample can't be a jolt.
  if (!state.gravity) {
    state.gravity = { ...sample };
    return false;
  }

  const g = state.gravity;
  g.x = g.x * GRAVITY_ALPHA + sample.x * (1 - GRAVITY_ALPHA);
  g.y = g.y * GRAVITY_ALPHA + sample.y * (1 - GRAVITY_ALPHA);
  g.z = g.z * GRAVITY_ALPHA + sample.z * (1 - GRAVITY_ALPHA);

  const linear: ShakeSample = { x: sample.x - g.x, y: sample.y - g.y, z: sample.z - g.z };
  const magnitude = Math.sqrt(dot(linear, linear));
  if (magnitude < SHAKE_THRESHOLD_G) return false;

  state.jolts = state.jolts.filter(j => now - j.at < SHAKE_WINDOW_MS);

  const prev = state.jolts[state.jolts.length - 1];
  if (prev) {
    // Same direction as the previous jolt: this is still the same swing, not
    // a new one. Extend it rather than counting it twice — otherwise one hard
    // shove spread over several samples would look like a whole shake.
    if (dot(linear, prev.vec) >= 0) {
      prev.at = now;
      prev.vec = linear;
      return false;
    }
  }

  state.jolts.push({ at: now, vec: linear });

  if (state.jolts.length < SHAKE_JOLTS_REQUIRED) return false;
  if (now - state.lastFiredAt < SHAKE_COOLDOWN_MS) return false;

  state.jolts = [];
  state.lastFiredAt = now;
  return true;
}

/**
 * How stale an undoable action may be and still be offered on shake.
 *
 * `lastAction` lives in memory for the life of the process, and iOS keeps a
 * suspended app around for a long time — so without a bound, a shake could
 * offer to undo something the user did in a previous session hours ago.
 * Shake-to-undo means "oops, I just did that"; past this, the offer is noise
 * even when the shake was real.
 */
export const UNDO_ACTION_MAX_AGE_MS = 5 * 60 * 1000;

export function isUndoActionFresh(actionAt: number | undefined, now: number): boolean {
  if (actionAt === undefined) return false;
  return now - actionAt < UNDO_ACTION_MAX_AGE_MS;
}
