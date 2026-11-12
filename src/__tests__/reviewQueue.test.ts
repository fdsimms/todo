import {
  REVIEW_WAVE_INITIAL_STATE,
  decideReviewWave,
  hourKeyOf,
  parseReviewWaveState,
  reviewQueueAt,
} from '../utils/reviewQueue';

/**
 * The shared review-queue rules. WaniKani's tests (`wanikaniTasks.test.ts`)
 * exercise the queue, the forecast, the hold and the wave through its own
 * names; what's here is what the move added: a generator names its own waves.
 */

const NOW = new Date(2026, 9, 18, 10, 20);
const queue = {
  reviewsNow: 4,
  upcoming: [{ at: new Date(2026, 9, 18, 11, 5).toISOString(), count: 8 }],
};

describe('decideReviewWave', () => {
  it('names a new wave with the generator’s own source id, at the moment it is placed', () => {
    const decision = decideReviewWave({
      queue,
      now: NOW,
      threshold: 10,
      live: null,
      state: REVIEW_WAVE_INITIAL_STATE,
      sourceIdFor: at => `mine:${hourKeyOf(at)}`,
    });
    expect(decision.action).toEqual({
      type: 'write',
      sourceId: 'mine:2026-10-18T11',
      count: 12,
      holdUntil: new Date(2026, 9, 18, 11, 5),
    });
    expect(decision.state).toEqual({ baseline: 0, openSourceId: 'mine:2026-10-18T11' });
  });
});

describe('reviewQueueAt and parseReviewWaveState', () => {
  it('adds what has arrived by then', () => {
    expect(reviewQueueAt(queue, NOW)).toBe(4);
    expect(reviewQueueAt(queue, new Date(2026, 9, 18, 11, 5))).toBe(12);
  });

  it('reads a stored state back, or the initial one', () => {
    expect(parseReviewWaveState('{"baseline":3,"openSourceId":"x"}')).toEqual({ baseline: 3, openSourceId: 'x' });
    expect(parseReviewWaveState('nope')).toEqual(REVIEW_WAVE_INITIAL_STATE);
  });
});
