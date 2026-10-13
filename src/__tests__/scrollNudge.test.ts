import {
  INITIAL_SCROLL_NUDGE_STATE as INITIAL,
  SCROLL_IDLE_GAP_MS,
  DEFAULT_SCROLL_NUDGE_LIMITS,
  SCROLL_NUDGE_DEFAULT_COOLDOWN_MINUTES,
  SCROLL_NUDGE_DEFAULT_DAILY_CAP,
  SCROLL_NUDGE_MAX_COOLDOWN_MINUTES,
  SCROLL_NUDGE_MAX_DAILY_CAP,
  SCROLL_NUDGE_MIN_COOLDOWN_MINUTES,
  SCROLL_NUDGE_MIN_DAILY_CAP,
  parseScrollNudgeCooldownMinutes,
  parseScrollNudgeDailyCap,
  type ScrollNudgeLimits,
  SCROLL_NUDGE_DEFAULT_SECONDS,
  SCROLL_NUDGE_MAX_SECONDS,
  SCROLL_NUDGE_MIN_SECONDS,
  describeScrollNudgeSpan,
  isSwipe,
  isTap,
  noteAction,
  noteOffered,
  noteScroll,
  parseScrollNudgeSeconds,
  shouldOfferScrollNudge,
  type ScrollNudgeState,
} from '../utils/scrollNudge';

const DAY = '2026-10-13';
const COOLDOWN_MS = SCROLL_NUDGE_DEFAULT_COOLDOWN_MINUTES * 60_000;
const LIMITS = DEFAULT_SCROLL_NUDGE_LIMITS;
const withLimits = (over: Partial<ScrollNudgeLimits>): ScrollNudgeLimits => ({ ...LIMITS, ...over });

/** Scrolls every `stepMs` from t=0 up to and including `untilMs`. */
function scrollThrough(state: ScrollNudgeState, untilMs: number, stepMs = 5000, from = 0): ScrollNudgeState {
  let s = state;
  for (let t = from; t <= untilMs; t += stepMs) s = noteScroll(s, t);
  return s;
}

describe('shouldOfferScrollNudge', () => {
  it('offers once a run has lasted the threshold', () => {
    const s = scrollThrough(INITIAL, 60_000);
    expect(shouldOfferScrollNudge(s, 60_000, DAY, LIMITS)).toBe(true);
  });

  it('does not offer before the threshold', () => {
    const s = scrollThrough(INITIAL, 55_000);
    expect(shouldOfferScrollNudge(s, 55_000, DAY, LIMITS)).toBe(false);
  });

  it('honours a longer threshold', () => {
    const s = scrollThrough(INITIAL, 60_000);
    expect(shouldOfferScrollNudge(s, 60_000, DAY, withLimits({ seconds: 120 }))).toBe(false);
  });

  it('does nothing with no scrolling at all', () => {
    expect(shouldOfferScrollNudge(INITIAL, 1_000_000, DAY, LIMITS)).toBe(false);
  });

  it('does not offer on a run that stopped long ago', () => {
    const s = scrollThrough(INITIAL, 60_000);
    expect(shouldOfferScrollNudge(s, 60_000 + SCROLL_IDLE_GAP_MS + 1, DAY, LIMITS)).toBe(false);
  });
});

describe('a run', () => {
  it('is broken by a pause longer than the idle gap', () => {
    let s = scrollThrough(INITIAL, 40_000);
    s = noteScroll(s, 40_000 + SCROLL_IDLE_GAP_MS + 1);
    expect(s.runStartedAt).toBe(40_000 + SCROLL_IDLE_GAP_MS + 1);
    expect(shouldOfferScrollNudge(s, 40_000 + SCROLL_IDLE_GAP_MS + 1, DAY, LIMITS)).toBe(false);
  });

  it('survives a pause exactly at the idle gap', () => {
    let s = noteScroll(INITIAL, 0);
    s = noteScroll(s, SCROLL_IDLE_GAP_MS);
    expect(s.runStartedAt).toBe(0);
  });

  it('is ended by an action, so the clock starts over', () => {
    let s = scrollThrough(INITIAL, 50_000);
    s = noteAction(s);
    expect(s.runStartedAt).toBeNull();
    s = scrollThrough(s, 70_000, 5000, 55_000);
    expect(shouldOfferScrollNudge(s, 70_000, DAY, LIMITS)).toBe(false);
    s = scrollThrough(s, 120_000, 5000, 75_000);
    expect(shouldOfferScrollNudge(s, 120_000, DAY, LIMITS)).toBe(true);
  });

  it('returns the same object when an action has nothing to end', () => {
    expect(noteAction(INITIAL)).toBe(INITIAL);
  });
});

describe('after an offer', () => {
  it('ends the run and holds off for the cooldown', () => {
    let s = scrollThrough(INITIAL, 60_000);
    s = noteOffered(s, 60_000, DAY);
    expect(s.runStartedAt).toBeNull();

    const later = 60_000 + 10 * 60_000;
    s = scrollThrough(s, later + 70_000, 5000, later);
    expect(shouldOfferScrollNudge(s, later + 70_000, DAY, LIMITS)).toBe(false);
  });

  it('offers again once the cooldown has passed', () => {
    let s = noteOffered(scrollThrough(INITIAL, 60_000), 60_000, DAY);
    const start = 60_000 + COOLDOWN_MS;
    s = scrollThrough(s, start + 60_000, 5000, start);
    expect(shouldOfferScrollNudge(s, start + 60_000, DAY, LIMITS)).toBe(true);
  });

  it('stops at the daily cap even when the cooldown has passed', () => {
    let s: ScrollNudgeState = INITIAL;
    let t = 0;
    for (let i = 0; i < SCROLL_NUDGE_DEFAULT_DAILY_CAP; i++) {
      s = scrollThrough(s, t + 60_000, 5000, t);
      expect(shouldOfferScrollNudge(s, t + 60_000, DAY, LIMITS)).toBe(true);
      s = noteOffered(s, t + 60_000, DAY);
      t += COOLDOWN_MS + 60_000;
    }
    s = scrollThrough(s, t + 60_000, 5000, t);
    expect(shouldOfferScrollNudge(s, t + 60_000, DAY, LIMITS)).toBe(false);
  });

  it('starts the count over on a new day', () => {
    let s: ScrollNudgeState = INITIAL;
    for (let i = 0; i < SCROLL_NUDGE_DEFAULT_DAILY_CAP; i++) s = noteOffered(s, i, DAY);
    expect(s.offersToday).toBe(SCROLL_NUDGE_DEFAULT_DAILY_CAP);
    const start = 10 * COOLDOWN_MS;
    s = scrollThrough(s, start + 60_000, 5000, start);
    expect(shouldOfferScrollNudge(s, start + 60_000, '2026-10-14', LIMITS)).toBe(true);
    expect(noteOffered(s, start, '2026-10-14').offersToday).toBe(1);
  });
});

describe('touch classification', () => {
  it('treats a small movement as a tap', () => {
    expect(isTap(0, 0)).toBe(true);
    expect(isTap(-9, 9)).toBe(true);
    expect(isTap(0, 10)).toBe(false);
  });

  it('treats a mostly sideways drag as a swipe, and a vertical one as neither', () => {
    expect(isSwipe(40, 5)).toBe(true);
    expect(isSwipe(-40, 10)).toBe(true);
    expect(isSwipe(5, 80)).toBe(false);
    expect(isSwipe(3, 2)).toBe(false);
  });
});

describe('parseScrollNudgeSeconds', () => {
  it('falls back to the default', () => {
    expect(parseScrollNudgeSeconds(null)).toBe(SCROLL_NUDGE_DEFAULT_SECONDS);
    expect(parseScrollNudgeSeconds('abc')).toBe(SCROLL_NUDGE_DEFAULT_SECONDS);
  });

  it('clamps to the range', () => {
    expect(parseScrollNudgeSeconds('5')).toBe(SCROLL_NUDGE_MIN_SECONDS);
    expect(parseScrollNudgeSeconds('9999')).toBe(SCROLL_NUDGE_MAX_SECONDS);
    expect(parseScrollNudgeSeconds('90')).toBe(90);
  });
});

describe('describeScrollNudgeSpan', () => {
  it('says whole minutes as minutes and anything else in seconds', () => {
    expect(describeScrollNudgeSpan(60)).toBe('a minute');
    expect(describeScrollNudgeSpan(120)).toBe('2 minutes');
    expect(describeScrollNudgeSpan(90)).toBe('90 seconds');
    expect(describeScrollNudgeSpan(30)).toBe('30 seconds');
  });
});

describe('adjustable limits', () => {
  it('honours a shorter cooldown', () => {
    let s = noteOffered(scrollThrough(INITIAL, 60_000), 60_000, DAY);
    const start = 60_000 + 10 * 60_000;
    s = scrollThrough(s, start + 60_000, 5000, start);
    expect(shouldOfferScrollNudge(s, start + 60_000, DAY, LIMITS)).toBe(false);
    expect(shouldOfferScrollNudge(s, start + 60_000, DAY, withLimits({ cooldownMinutes: 5 }))).toBe(true);
  });

  it('honours a lower and a higher daily cap', () => {
    let s: ScrollNudgeState = INITIAL;
    s = noteOffered(s, 0, DAY);
    const start = 10 * COOLDOWN_MS;
    s = scrollThrough(s, start + 60_000, 5000, start);
    expect(shouldOfferScrollNudge(s, start + 60_000, DAY, withLimits({ dailyCap: 1 }))).toBe(false);
    expect(shouldOfferScrollNudge(s, start + 60_000, DAY, withLimits({ dailyCap: 2 }))).toBe(true);
  });
});

describe('parse cooldown and cap', () => {
  it('falls back and clamps', () => {
    expect(parseScrollNudgeCooldownMinutes(null)).toBe(SCROLL_NUDGE_DEFAULT_COOLDOWN_MINUTES);
    expect(parseScrollNudgeCooldownMinutes('1')).toBe(SCROLL_NUDGE_MIN_COOLDOWN_MINUTES);
    expect(parseScrollNudgeCooldownMinutes('9999')).toBe(SCROLL_NUDGE_MAX_COOLDOWN_MINUTES);
    expect(parseScrollNudgeDailyCap('x')).toBe(SCROLL_NUDGE_DEFAULT_DAILY_CAP);
    expect(parseScrollNudgeDailyCap('0')).toBe(SCROLL_NUDGE_MIN_DAILY_CAP);
    expect(parseScrollNudgeDailyCap('99')).toBe(SCROLL_NUDGE_MAX_DAILY_CAP);
  });
});
