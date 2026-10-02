import { useWidgetCompletionStore, TAP_CLAIM_WINDOW_MS } from '../store/useWidgetCompletionStore';

const store = () => useWidgetCompletionStore.getState();

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-03-10T08:00:00.000Z'));
  useWidgetCompletionStore.setState({ pendingIds: [], tappedAt: {} });
});
afterEach(() => jest.useRealTimers());

describe('useWidgetCompletionStore', () => {
  it('hands back the tap time the widget recorded', () => {
    store().enqueue(['a'], { a: '2026-03-09T22:00:00.000Z' });
    expect(store().pendingIds).toEqual(['a']);
    expect(store().claimTappedAt('a')).toBe('2026-03-09T22:00:00.000Z');
  });

  it('stamps an id with no recorded time as tapped now', () => {
    store().enqueue(['a']);
    expect(store().claimTappedAt('a')).toBe('2026-03-10T08:00:00.000Z');
  });

  it('keeps the tap time through dequeue, since the completion lands after it', () => {
    store().enqueue(['a'], { a: '2026-03-09T22:00:00.000Z' });
    store().dequeue('a');
    expect(store().pendingIds).toEqual([]);
    expect(store().claimTappedAt('a')).toBe('2026-03-09T22:00:00.000Z');
  });

  it('gives a tap time out once', () => {
    store().enqueue(['a'], { a: '2026-03-09T22:00:00.000Z' });
    store().claimTappedAt('a');
    expect(store().claimTappedAt('a')).toBeUndefined();
  });

  it('keeps the first tap when an id is queued twice', () => {
    store().enqueue(['a'], { a: '2026-03-09T22:00:00.000Z' });
    store().enqueue(['a'], { a: '2026-03-10T07:00:00.000Z' });
    expect(store().pendingIds).toEqual(['a']);
    expect(store().claimTappedAt('a')).toBe('2026-03-09T22:00:00.000Z');
  });

  it('will not backdate a completion that came long after the tap was queued', () => {
    // The tap's own completion never happened (a question sheet cancelled, say),
    // so a later completion of the same task is a different one.
    store().enqueue(['a'], { a: '2026-03-09T22:00:00.000Z' });
    jest.setSystemTime(Date.now() + TAP_CLAIM_WINDOW_MS + 1);
    expect(store().claimTappedAt('a')).toBeUndefined();
    expect(store().tappedAt).toEqual({});
  });

  it('treats a time that is unreadable or in the future as now', () => {
    store().enqueue(['a', 'b'], { a: 'nonsense', b: '2026-03-11T08:00:00.000Z' });
    expect(store().claimTappedAt('a')).toBe('2026-03-10T08:00:00.000Z');
    expect(store().claimTappedAt('b')).toBe('2026-03-10T08:00:00.000Z');
  });
});
