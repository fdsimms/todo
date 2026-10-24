import {
  PENDING_COMPLETION_DATE_WINDOW_MS,
  claimPendingCompletionDate,
  setPendingCompletionDate,
} from '../utils/pendingCompletionDate';

const NOW = new Date(2026, 9, 24, 12).getTime();
const DAY = 24 * 60 * 60 * 1000;

describe('pending completion date', () => {
  it('hands the day over once', () => {
    const at = new Date(NOW - 5 * DAY).toISOString();
    setPendingCompletionDate('a', at, NOW);
    expect(claimPendingCompletionDate('a', NOW)).toBe(at);
    expect(claimPendingCompletionDate('a', NOW)).toBeUndefined();
  });

  it('can be withdrawn', () => {
    setPendingCompletionDate('a', new Date(NOW - DAY).toISOString(), NOW);
    setPendingCompletionDate('a', null, NOW);
    expect(claimPendingCompletionDate('a', NOW)).toBeUndefined();
  });

  it('ages out, so a later completion is not backdated to a cancelled sheet', () => {
    setPendingCompletionDate('a', new Date(NOW - DAY).toISOString(), NOW);
    expect(claimPendingCompletionDate('a', NOW + PENDING_COMPLETION_DATE_WINDOW_MS + 1)).toBeUndefined();
  });

  it('refuses a day in the future or one that does not parse', () => {
    setPendingCompletionDate('a', new Date(NOW + DAY).toISOString(), NOW);
    expect(claimPendingCompletionDate('a', NOW)).toBeUndefined();
    setPendingCompletionDate('b', 'not a date', NOW);
    expect(claimPendingCompletionDate('b', NOW)).toBeUndefined();
  });
});
