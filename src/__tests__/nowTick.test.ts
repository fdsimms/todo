import { subscribeToNowTick, emitNowTick, NOW_TICK_MS } from '../utils/nowTick';

// The subscriber set and its interval are module-level singletons, so every
// test here unsubscribes what it subscribed — a leaked subscriber would keep
// the interval alive and throw off the getTimerCount assertions below.
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('subscribeToNowTick', () => {
  it('notifies a subscriber once per interval', () => {
    const listener = jest.fn();
    const off = subscribeToNowTick(listener);

    expect(listener).not.toHaveBeenCalled();
    jest.advanceTimersByTime(NOW_TICK_MS);
    expect(listener).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(NOW_TICK_MS);
    expect(listener).toHaveBeenCalledTimes(2);

    off();
  });

  it('passes the current timestamp', () => {
    const listener = jest.fn();
    const off = subscribeToNowTick(listener);

    jest.advanceTimersByTime(NOW_TICK_MS);
    expect(typeof listener.mock.calls[0][0]).toBe('number');

    off();
  });

  it('runs one shared interval no matter how many subscribers there are', () => {
    const a = jest.fn();
    const b = jest.fn();
    const offA = subscribeToNowTick(a);
    const offB = subscribeToNowTick(b);

    // The whole point of the module: a row-per-interval design is what this
    // exists to avoid.
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(NOW_TICK_MS);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    offA();
    offB();
  });

  it('stops delivering to a listener once it unsubscribes', () => {
    const stays = jest.fn();
    const leaves = jest.fn();
    const offStays = subscribeToNowTick(stays);
    const offLeaves = subscribeToNowTick(leaves);

    offLeaves();
    jest.advanceTimersByTime(NOW_TICK_MS);

    expect(leaves).not.toHaveBeenCalled();
    expect(stays).toHaveBeenCalledTimes(1);

    offStays();
  });

  it('tears the interval down once the last subscriber leaves', () => {
    const offA = subscribeToNowTick(jest.fn());
    const offB = subscribeToNowTick(jest.fn());

    offA();
    expect(jest.getTimerCount()).toBe(1); // B is still listening

    offB();
    expect(jest.getTimerCount()).toBe(0); // nothing left to tick for
  });

  it('starts a fresh interval when someone subscribes after a full teardown', () => {
    subscribeToNowTick(jest.fn())();
    expect(jest.getTimerCount()).toBe(0);

    const listener = jest.fn();
    const off = subscribeToNowTick(listener);
    jest.advanceTimersByTime(NOW_TICK_MS);

    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('still notifies everyone when a listener unsubscribes mid-tick', () => {
    // A row unmounting as it's notified mutates the subscriber set while it's
    // being walked — the snapshot in emit() is what keeps the rest of the list
    // from being skipped.
    let offSelfRemoving: (() => void) | undefined;
    const selfRemoving = jest.fn(() => offSelfRemoving?.());
    const other = jest.fn();

    offSelfRemoving = subscribeToNowTick(selfRemoving);
    const offOther = subscribeToNowTick(other);

    jest.advanceTimersByTime(NOW_TICK_MS);

    expect(selfRemoving).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);

    // And the one that removed itself really is gone.
    jest.advanceTimersByTime(NOW_TICK_MS);
    expect(selfRemoving).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(2);

    offOther();
  });
});

describe('emitNowTick', () => {
  it('notifies subscribers immediately, without waiting for the interval', () => {
    const listener = jest.fn();
    const off = subscribeToNowTick(listener);

    emitNowTick();
    expect(listener).toHaveBeenCalledTimes(1);

    off();
  });

  it('does nothing when nobody is subscribed', () => {
    expect(() => emitNowTick()).not.toThrow();
  });
});
