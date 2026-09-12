import { createRefreshGuard } from '../utils/refreshGuard';

describe('createRefreshGuard', () => {
  it('holds a token that has had nothing happen since', () => {
    const guard = createRefreshGuard();
    const token = guard.begin();
    expect(guard.isCurrent(token)).toBe(true);
  });

  it('drops the earlier of two overlapping reads', () => {
    const guard = createRefreshGuard();
    const first = guard.begin();
    const second = guard.begin();
    // The later read wins whichever resolves first, which is the point: the
    // one that started last is the one asking the current question.
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('drops a read that was in flight when the data was cleared', () => {
    const guard = createRefreshGuard();
    const token = guard.begin();
    guard.invalidate();
    expect(guard.isCurrent(token)).toBe(false);
  });

  it('lets the next read after an invalidate write normally', () => {
    const guard = createRefreshGuard();
    guard.begin();
    guard.invalidate();
    const token = guard.begin();
    expect(guard.isCurrent(token)).toBe(true);
  });

  it('keeps two guards independent, so one read does not cancel the other', () => {
    const today = createRefreshGuard();
    const history = createRefreshGuard();
    const todayToken = today.begin();
    history.begin();
    history.invalidate();
    expect(today.isCurrent(todayToken)).toBe(true);
  });

  it('never treats a token from another guard as current', () => {
    const a = createRefreshGuard();
    const b = createRefreshGuard();
    a.begin();
    const second = a.begin();
    expect(b.isCurrent(second)).toBe(false);
  });
});
