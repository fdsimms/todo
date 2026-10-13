/**
 * "You've been scrolling for a minute. Start a focus session?"
 *
 * The app cannot tell reading from drifting, so this does not try. It
 * recognises the one pattern that is cheap to see and cheap to be wrong about:
 * a task list scrolled continuously for a while with no tap in that time. A
 * tap (opening a row, completing, rescheduling, switching view, anything)
 * ends the run, because it means the person is doing something with the list.
 *
 * Deliberately store-free and clock-free: every function takes `now`, and the
 * day key a daily cap is measured against is a parameter, so the caller can
 * pass `getLogicalDayKey` (a day here is the logical day, not the calendar one)
 * without this file importing dateUtils, which reaches the db.
 *
 * The state lives in a ref in `useScrollNudge`, never in a store or the db.
 * A cooldown that survived a restart would be a promise to stay quiet the app
 * has no good reason to keep, and nothing here is worth syncing.
 */

export const SCROLL_NUDGE_DEFAULT_SECONDS = 60;
export const SCROLL_NUDGE_MIN_SECONDS = 30;
export const SCROLL_NUDGE_MAX_SECONDS = 300;
/** Step of the settings stepper, in seconds. */
export const SCROLL_NUDGE_STEP_SECONDS = 15;

/**
 * A pause in scrolling longer than this ends the run. Reading a long list
 * stops the scrolling for a while; a flick and a glance does not.
 */
export const SCROLL_IDLE_GAP_MS = 15_000;
/** After the suggestion appears, how long before it may appear again. */
export const SCROLL_NUDGE_COOLDOWN_MS = 30 * 60_000;
/** Times it may appear in one logical day, however long the cooldown has run. */
export const SCROLL_NUDGE_DAILY_CAP = 3;
/** Finger travel, in points, under which a touch is a tap and not a scroll. */
export const TAP_SLOP = 10;

export interface ScrollNudgeState {
  /** When the current unbroken run of scrolling began, or null when there is none. */
  runStartedAt: number | null;
  lastScrollAt: number | null;
  lastOfferedAt: number | null;
  /** The logical day `offersToday` counts, so a new day starts the count over. */
  offerDay: string | null;
  offersToday: number;
}

export const INITIAL_SCROLL_NUDGE_STATE: ScrollNudgeState = {
  runStartedAt: null,
  lastScrollAt: null,
  lastOfferedAt: null,
  offerDay: null,
  offersToday: 0,
};

/** The stored threshold, clamped. Anything unreadable is the default. */
export function parseScrollNudgeSeconds(raw: string | null | undefined): number {
  if (raw == null) return SCROLL_NUDGE_DEFAULT_SECONDS;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return SCROLL_NUDGE_DEFAULT_SECONDS;
  return Math.min(SCROLL_NUDGE_MAX_SECONDS, Math.max(SCROLL_NUDGE_MIN_SECONDS, n));
}

/** A scroll event. Continues the run unless the list sat still too long first. */
export function noteScroll(state: ScrollNudgeState, now: number): ScrollNudgeState {
  const continuing =
    state.runStartedAt !== null &&
    state.lastScrollAt !== null &&
    now - state.lastScrollAt <= SCROLL_IDLE_GAP_MS;
  return {
    ...state,
    runStartedAt: continuing ? state.runStartedAt : now,
    lastScrollAt: now,
  };
}

/** A tap, or anything else that shows the person is using the list. Ends the run. */
export function noteAction(state: ScrollNudgeState): ScrollNudgeState {
  if (state.runStartedAt === null && state.lastScrollAt === null) return state;
  return { ...state, runStartedAt: null, lastScrollAt: null };
}

/**
 * Whether to show the suggestion now. The run has to have lasted `seconds`,
 * and has to still be running: a run whose last scroll was long ago ended
 * without anyone noticing, and offering on it would be offering to someone
 * who has stopped.
 */
export function shouldOfferScrollNudge(
  state: ScrollNudgeState,
  now: number,
  dayKey: string,
  seconds: number,
): boolean {
  if (state.runStartedAt === null || state.lastScrollAt === null) return false;
  if (now - state.lastScrollAt > SCROLL_IDLE_GAP_MS) return false;
  if (now - state.runStartedAt < seconds * 1000) return false;
  if (state.lastOfferedAt !== null && now - state.lastOfferedAt < SCROLL_NUDGE_COOLDOWN_MS) return false;
  if (state.offerDay === dayKey && state.offersToday >= SCROLL_NUDGE_DAILY_CAP) return false;
  return true;
}

/** The suggestion was shown. Starts the cooldown, counts toward the day, and ends the run. */
export function noteOffered(state: ScrollNudgeState, now: number, dayKey: string): ScrollNudgeState {
  return {
    runStartedAt: null,
    lastScrollAt: null,
    lastOfferedAt: now,
    offerDay: dayKey,
    offersToday: state.offerDay === dayKey ? state.offersToday + 1 : 1,
  };
}

/**
 * A finished touch, from where it began to where it ended. A touch that
 * moved is the list scrolling (its own scroll events already said so) or a
 * swipe on a row, which is an action; one that barely moved is a tap.
 */
export function isTap(dx: number, dy: number): boolean {
  return Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP;
}

/** A sideways swipe, which is a row action (complete, reschedule), not scrolling. */
export function isSwipe(dx: number, dy: number): boolean {
  return Math.abs(dx) >= TAP_SLOP && Math.abs(dx) > Math.abs(dy);
}

/** The threshold as the banner says it: "a minute", "2 minutes", "90 seconds". */
export function describeScrollNudgeSpan(seconds: number): string {
  if (seconds % 60 !== 0) return `${seconds} seconds`;
  const minutes = seconds / 60;
  return minutes === 1 ? 'a minute' : `${minutes} minutes`;
}
