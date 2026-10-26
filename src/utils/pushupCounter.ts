/**
 * Counting pushups: the rules behind the `pushups` mission (see missions.ts),
 * for a task or an alarm that has to be earned. Three ways to count, best
 * first: the Face ID camera's depth (`feedDepth`, below), the proximity sensor
 * (`feedProximity`), and a tap per rep on a device with neither (`tapRep`).
 *
 * ## The Face ID camera's depth
 *
 * The phone lies face up on the floor under the person's face, so they can
 * watch the count, and the front (TrueDepth) camera measures how far away the
 * face is (`todo-proximity-bridge`'s depth reader: the nearest part of the
 * middle of the frame, a few times a second). That is a distance, where the
 * proximity sensor is only a yes or no, so a rep is judged against the
 * person's own range rather than against the floor:
 *
 * - Down is the face `DEPTH_DOWN_M` below the top this rep started from (the
 *   highest it has been since the last rep).
 * - The rep counts on the way back up, once the face is `DEPTH_UP_M` above the
 *   lowest it went. Measuring the climb from the bottom rather than back to
 *   the top is what lets a set count while the top sags with tiredness.
 *
 * Both are travel, never a fixed height, so arm length doesn't matter, and the
 * two together are a hysteresis no sensor noise comes near.
 *
 * The camera can't measure closer than some distance Apple doesn't publish, so
 * the bottom of a deep rep can read as nothing at all. A lost reading right
 * after a near one (`DEPTH_NEAR_LOST_M`) is a face too close to measure, and
 * counts as down at the last distance that measured; a lost reading after a far
 * one, or a reading past `DEPTH_MAX_FACE_M`, is nobody over the phone, and
 * changes nothing. Holding the last distance rather than reading the loss as 0
 * is what stops a face hovering at the edge of the range, flickering between
 * measured and lost, from counting a rep on every flicker.
 *
 * A dip of `DEPTH_SHALLOW_M` that turns back before reaching down is a rep too
 * shallow to count, and says so, since a rep that doesn't count with no reason
 * given is the whole complaint this replaced.
 *
 * ## The phone has to stay put
 *
 * Depth only knows the face got closer and farther, and that is just as true of
 * a phone swung back and forth in front of a still face. So the phone's own
 * motion (`feedMotion`: the gyroscope's rotation and the accelerometer's
 * gravity-free acceleration, from the device motion sensor) is read alongside,
 * and a rep during which the phone moved doesn't count. The rep's window runs
 * from the last time the face was at its highest (`repStartAt`, the moment the
 * descent began) to the reading that would have counted it. Motion has to be
 * sustained for `MOTION_MIN_MS`, so a single thump of the floor isn't enough,
 * and the half second after a counted rep is ignored (`MOTION_QUIET_MS`),
 * because the haptic for that rep shakes the phone itself.
 *
 * With no motion sensor there are no samples, so nothing is ever flagged and
 * the count works as it did: the check removes a cheat, and shouldn't be able
 * to take the whole mission away on a device that can't run it.
 *
 * ## The proximity sensor
 *
 * It is the fallback, not the default, because its range is a few centimetres:
 * a rep it can see is one where the chest comes nearly to the floor, right over
 * the top edge of the phone, and a rep that stops a hand's width up is never
 * seen at all. Nothing in the timing below can fix that; it is why depth exists.
 *
 * The phone lies face up on the floor under the person's chest, and each time
 * they go down the sensor reads *near*. A rep is counted when the sensor
 * clears again, on the way back up, not when it is first covered, for two
 * reasons: iOS switches the screen off while the sensor is covered, so a
 * count made on the way down can't be seen until the way up anyway; and a
 * phone left face down (in a pocket, on a table) never clears, so it can't
 * count more than the one rep its eventual lift gives it.
 *
 * Two floors keep noise out. A cover shorter than `PUSHUP_MIN_NEAR_MS` is the
 * sensor flickering at the edge of its range rather than a body over it, and
 * reps closer together than `PUSHUP_MIN_REP_MS` are faster than anyone does a
 * pushup. A cover longer than `PUSHUP_MAX_NEAR_MS` isn't a pushup either: it is
 * the phone put down on its face and picked up again.
 *
 * None of this makes the count impossible to cheat (a hand waved over the
 * sensor is a rep). It's a commitment device, the same as the alarm chain it
 * usually rides on: what it removes is the one-tap way out, not every way out.
 */

/** A shorter cover is the sensor flickering, not a body over the phone. */
export const PUSHUP_MIN_NEAR_MS = 150;

/** Reps closer together than this are faster than anyone does a pushup. */
export const PUSHUP_MIN_REP_MS = 600;

/** A longer cover is the phone lying face down, not someone holding a pushup. */
export const PUSHUP_MAX_NEAR_MS = 10_000;

/** The count a new challenge starts at in the editor. */
export const PUSHUP_DEFAULT_COUNT = 20;

/** The highest count the editor offers. */
export const PUSHUP_MAX_COUNT = 200;

/** Why the last cover didn't count: too brief, too long, or too soon after the rep before. */
export type PushupMiss = 'brief' | 'long' | 'soon';

export interface PushupCounterState {
  /** Reps counted so far. */
  count: number;
  /** Covers the sensor has reported, counted or not: what the status line says it saw. */
  seen: number;
  /** Why the last finished cover didn't count, or null when it did (or none has finished). */
  lastMiss: PushupMiss | null;
  /** When the sensor was last covered, while it still is; null while it's clear. */
  nearSince: number | null;
  /** When the last rep was counted, or null before the first. */
  lastRepAt: number | null;
}

export function initialPushupState(): PushupCounterState {
  return { count: 0, seen: 0, lastMiss: null, nearSince: null, lastRepAt: null };
}

/**
 * Feed one proximity change. `near` is the sensor's new state and `at` the
 * time it changed, in milliseconds. Returns the next state, which carries a
 * higher `count` exactly when this change completed a rep.
 *
 * A repeated reading of the same state is ignored rather than restarting the
 * cover's clock, since the native side may report a state it already sent.
 */
export function feedProximity(state: PushupCounterState, near: boolean, at: number): PushupCounterState {
  if (near) {
    if (state.nearSince !== null) return state;
    return { ...state, seen: state.seen + 1, nearSince: at };
  }
  if (state.nearSince === null) return state;
  const held = at - state.nearSince;
  const missed = (lastMiss: PushupMiss): PushupCounterState => ({ ...state, lastMiss, nearSince: null });
  if (held < PUSHUP_MIN_NEAR_MS) return missed('brief');
  if (held > PUSHUP_MAX_NEAR_MS) return missed('long');
  if (state.lastRepAt !== null && at - state.lastRepAt < PUSHUP_MIN_REP_MS) return missed('soon');
  return { ...state, count: state.count + 1, lastMiss: null, nearSince: null, lastRepAt: at };
}

/**
 * Count one rep by hand, for a device with no proximity sensor (an iPad, a
 * Mac). Held to the same rep floor, so a burst of taps doesn't fill the count.
 */
export function tapRep(state: PushupCounterState, at: number): PushupCounterState {
  if (state.lastRepAt !== null && at - state.lastRepAt < PUSHUP_MIN_REP_MS) return state;
  return { ...state, count: state.count + 1, nearSince: null, lastRepAt: at };
}

/** The status line under the counter while the sensor counts. */
export interface PushupSensorStatus {
  /** `idle`: nothing seen yet. `miss`: the last cover didn't count. `counting`: it did. */
  tone: 'idle' | 'miss' | 'counting';
  line: string;
  detail: string;
}

const MISS_DETAIL: Record<PushupMiss, string> = {
  brief: 'The last one was too quick to count. Stay down a moment longer.',
  long: `The sensor was covered for over ${Math.round(PUSHUP_MAX_NEAR_MS / 1000)} seconds, so the last one didn’t count.`,
  soon: 'The last one came too soon after the one before it to count.',
};

/**
 * What the sensor has seen so far, so somebody whose reps aren't counting can
 * tell a sensor that never saw them from covers the rules above threw out.
 * The screen is dark while the sensor is covered, so this is read on the way
 * back up, which is when it changes.
 */
export function pushupSensorStatus(state: PushupCounterState): PushupSensorStatus {
  if (state.seen === 0) {
    return {
      tone: 'idle',
      line: 'The sensor hasn’t seen you yet',
      detail: 'Bring your chest down close to the top edge of the phone, where the sensor is.',
    };
  }
  const line = `Seen ${state.seen} time${state.seen === 1 ? '' : 's'}, ${state.count} counted`;
  if (state.lastMiss) return { tone: 'miss', line, detail: MISS_DETAIL[state.lastMiss] };
  return {
    tone: 'counting',
    line,
    detail: 'The screen goes dark while you’re down, and the count shows when you come back up.',
  };
}

/** How far below the top of a rep the face has to go before it is down. */
export const DEPTH_DOWN_M = 0.15;

/** How far back up from the bottom the face has to come for the rep to count. */
export const DEPTH_UP_M = 0.1;

/** A dip this deep that turns back before reaching down is a rep too shallow to count. */
export const DEPTH_SHALLOW_M = 0.06;

/** A face farther than this isn't over the phone: it's the ceiling, or someone standing. */
export const DEPTH_MAX_FACE_M = 1.2;

/** A reading lost right after one this close is a face too close for the camera, not nobody. */
export const DEPTH_NEAR_LOST_M = 0.45;

/** Less of the middle of the frame than this measuring is a lost reading. */
export const DEPTH_MIN_VALID = 0.1;

/** Nobody over the phone for this long, after somebody was, and the status says so. */
export const DEPTH_AWAY_MS = 1500;

/**
 * No depth reading at all for this long is a camera that didn't start or has
 * stopped (an empty frame still arrives as a reading), so the count moves to
 * the proximity sensor rather than waiting on a camera that won't come back.
 */
export const DEPTH_SILENCE_MS = 3000;

/** The phone turning faster than this (degrees per second) is being moved, not lying on the floor. */
export const MOTION_ROTATION_DPS = 25;

/** The phone accelerating harder than this (m/s², gravity removed) is being moved. */
export const MOTION_ACCEL_MS2 = 0.6;

/** Motion has to last this long to count as the phone moving, so one thump of the floor doesn't. */
export const MOTION_MIN_MS = 120;

/** Motion is ignored this long after a counted rep, since the rep's own haptic shakes the phone. */
export const MOTION_QUIET_MS = 500;

/** One reading of the depth reader. */
export interface DepthReading {
  /** Metres to the nearest part of the middle of the frame, or null when none of it measured. */
  distance: number | null;
  /** The share of the middle of the frame that measured, 0 to 1. */
  valid: number;
  /** When, in milliseconds. */
  at: number;
}

export interface DepthCounterState {
  /** Reps counted so far. */
  count: number;
  /** `up` while waiting for the face to come down, `down` while waiting for it to come back up. */
  phase: 'up' | 'down';
  /** The highest the face has been since the last rep (the top this rep is measured from), or null before it's seen. */
  top: number | null;
  /** Going down, the lowest it has been; going up, the lowest since the top (for the shallow check). */
  low: number | null;
  /** The last distance that measured, near or far, or null before any did. */
  last: number | null;
  /** Whether a face has been over the phone at all. */
  seen: boolean;
  /** Why the last dip didn't count, or null when it did (or none has finished). */
  lastMiss: 'shallow' | 'moved' | null;
  /** When the face was last at its highest: the moment the current rep's descent began. */
  repStartAt: number | null;
  /** The last time the phone was found moving, or null if it never has been. */
  movedAt: number | null;
  /** When the phone started moving, while it still is and hasn't yet lasted `MOTION_MIN_MS`. */
  motionSince: number | null;
  /** Motion samples before this are ignored (the haptic after a counted rep). */
  quietUntil: number;
  /** When the readings stopped finding a face, while they still don't. */
  absentSince: number | null;
  /** Nobody over the phone for `DEPTH_AWAY_MS`, after somebody was. */
  away: boolean;
}

export function initialDepthState(): DepthCounterState {
  return {
    count: 0, phase: 'up', top: null, low: null, last: null,
    seen: false, lastMiss: null, repStartAt: null, movedAt: null, motionSince: null, quietUntil: 0,
    absentSince: null, away: false,
  };
}

/**
 * Feed one depth reading. Returns the next state, which carries a higher
 * `count` exactly when this reading completed a rep.
 */
export function feedDepth(state: DepthCounterState, reading: DepthReading): DepthCounterState {
  const measured = reading.distance !== null && Number.isFinite(reading.distance) && reading.distance > 0
    && reading.valid >= DEPTH_MIN_VALID;

  if (!measured) {
    // Too close to measure: down, at the last distance that measured.
    if (state.last !== null && state.last <= DEPTH_NEAR_LOST_M) return tooClose(present(state), state.last);
    return absent(state, reading.at);
  }
  const d = reading.distance as number;
  if (d > DEPTH_MAX_FACE_M) return absent({ ...state, last: d }, reading.at);
  return atDistance({ ...present(state), last: d, seen: true }, d, reading.at);
}

function present(state: DepthCounterState): DepthCounterState {
  if (state.absentSince === null && !state.away) return state;
  return { ...state, absentSince: null, away: false };
}

function absent(state: DepthCounterState, at: number): DepthCounterState {
  const absentSince = state.absentSince ?? at;
  const away = state.seen && at - absentSince >= DEPTH_AWAY_MS;
  if (absentSince === state.absentSince && away === state.away) return state;
  return { ...state, absentSince, away };
}

function tooClose(state: DepthCounterState, last: number): DepthCounterState {
  if (state.phase === 'down') {
    return state.low !== null && state.low <= last ? state : { ...state, low: last };
  }
  // Only a face that came down to get here: one that went out of range
  // without leaving the top is a dropout, not a rep.
  if (state.top === null || state.top - last < DEPTH_SHALLOW_M) return state;
  return { ...state, phase: 'down', low: last, lastMiss: null };
}

function atDistance(state: DepthCounterState, d: number, at: number): DepthCounterState {
  if (state.phase === 'down') {
    const low = state.low === null ? d : Math.min(state.low, d);
    if (d - low >= DEPTH_UP_M) {
      // The phone moved since the descent began: the face went down and up
      // because the phone did. It starts the next rep from here, uncounted.
      if (state.movedAt !== null && state.repStartAt !== null && state.movedAt >= state.repStartAt) {
        return { ...state, phase: 'up', top: d, low: d, repStartAt: at, movedAt: null, lastMiss: 'moved' };
      }
      return {
        ...state, count: state.count + 1, phase: 'up', top: d, low: d, repStartAt: at,
        lastMiss: null, quietUntil: at + MOTION_QUIET_MS,
      };
    }
    return { ...state, low };
  }
  if (state.top === null || d > state.top) return { ...state, top: d, low: d, repStartAt: at };
  // Resting near the top is still before the descent, so the rep's window
  // starts when the face leaves it, not when it first got there.
  const atTop = state.top - d < DEPTH_SHALLOW_M ? { ...state, repStartAt: at } : state;
  const low = atTop.low === null ? d : Math.min(atTop.low, d);
  if (atTop.top! - d >= DEPTH_DOWN_M) return { ...atTop, phase: 'down', low: d, lastMiss: null };
  // A dip that turned back before reaching down.
  if (atTop.top! - low >= DEPTH_SHALLOW_M && d - low >= DEPTH_SHALLOW_M) {
    return { ...atTop, low: d, lastMiss: 'shallow' };
  }
  return { ...atTop, low };
}

/** One reading of the phone's own motion. Both are magnitudes, never negative. */
export interface MotionSample {
  /** Rotation rate, degrees per second. */
  rotation: number;
  /** Acceleration with gravity removed, m/s². */
  acceleration: number;
  /** When, in milliseconds since the epoch. */
  at: number;
}

/**
 * Feed one motion sample. Returns the same state when nothing changed (the
 * usual case, a phone lying still), so a sensor sampling many times a second
 * doesn't re-render the sheet.
 */
export function feedMotion(state: DepthCounterState, sample: MotionSample): DepthCounterState {
  if (sample.at < state.quietUntil) return state;
  const moving = sample.rotation >= MOTION_ROTATION_DPS || sample.acceleration >= MOTION_ACCEL_MS2;
  if (!moving) return state.motionSince === null ? state : { ...state, motionSince: null };
  const motionSince = state.motionSince ?? sample.at;
  if (sample.at - motionSince >= MOTION_MIN_MS) return { ...state, motionSince, movedAt: sample.at };
  return motionSince === state.motionSince ? state : { ...state, motionSince };
}

/**
 * The status line under the counter while the depth camera counts. Unlike the
 * proximity sensor's, the screen stays on the whole time, so this is read mid
 * rep and says what to do next rather than what happened.
 */
export function depthSensorStatus(state: DepthCounterState): PushupSensorStatus {
  if (!state.seen || state.away) {
    return {
      tone: 'idle',
      line: 'Looking for your face',
      detail: 'Get into position with your face over the phone.',
    };
  }
  if (state.phase === 'down') {
    return { tone: 'counting', line: 'Push back up', detail: 'It counts when you’re back up.' };
  }
  if (state.lastMiss === 'moved') {
    return { tone: 'miss', line: 'Keep the phone still', detail: 'That one didn’t count because the phone moved.' };
  }
  if (state.lastMiss === 'shallow') {
    return { tone: 'miss', line: 'Go a little lower', detail: 'That one wasn’t deep enough to count.' };
  }
  return { tone: 'counting', line: 'Go down', detail: 'It counts when you push back up.' };
}

/**
 * The stored form of a pushup count: a whole number from 1 to
 * `PUSHUP_MAX_COUNT`, or null for none. Anything that isn't a positive number
 * (0, a negative, NaN, a string from the MCP) means none.
 */
export function normalizePushupCount(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.round(value);
  if (n < 1) return null;
  return Math.min(n, PUSHUP_MAX_COUNT);
}
