/**
 * Counting pushups off the proximity sensor: the rules behind the `pushups`
 * mission (see missions.ts), for a task or an alarm that has to be earned.
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
