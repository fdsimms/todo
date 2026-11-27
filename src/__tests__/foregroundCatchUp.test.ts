import { CATCH_UP_QUIET_MS, shouldCatchUp } from '../utils/foregroundCatchUp';

describe('shouldCatchUp', () => {
  const at = new Date(2026, 10, 27, 9).getTime();
  const last = { at, dayKey: '2026-11-27' };

  it('runs the first time', () => {
    expect(shouldCatchUp(null, at, '2026-11-27')).toBe(true);
  });

  it('waits out a glance away, and runs once the quiet span has passed', () => {
    expect(shouldCatchUp(last, at + 2_000, '2026-11-27')).toBe(false);
    expect(shouldCatchUp(last, at + CATCH_UP_QUIET_MS - 1, '2026-11-27')).toBe(false);
    expect(shouldCatchUp(last, at + CATCH_UP_QUIET_MS, '2026-11-27')).toBe(true);
  });

  it('runs on a new logical day however short the gap', () => {
    expect(shouldCatchUp(last, at + 2_000, '2026-11-28')).toBe(true);
  });

  it('runs when the clock has gone backwards', () => {
    expect(shouldCatchUp(last, at - 60_000, '2026-11-27')).toBe(true);
  });
});
