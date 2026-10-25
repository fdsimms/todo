import { runAfterPaint, runAfterTransition, TRANSITION_SETTLE_MS } from '../utils/afterPaint';

describe('runAfterPaint', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('does not run in the task that scheduled it, or in a microtask after it', async () => {
    const task = jest.fn();
    runAfterPaint(task);
    await Promise.resolve();
    expect(task).not.toHaveBeenCalled();
  });

  it('runs after the next frame and a macrotask', () => {
    const task = jest.fn();
    runAfterPaint(task);
    jest.advanceTimersByTime(16);
    expect(task).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('waits the extra delay after the frame', () => {
    const task = jest.fn();
    runAfterPaint(task, 100);
    jest.advanceTimersByTime(16 + 99);
    expect(task).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('is cancelled before the frame', () => {
    const task = jest.fn();
    runAfterPaint(task).cancel();
    jest.runAllTimers();
    expect(task).not.toHaveBeenCalled();
  });

  it('is cancelled between the frame and the timer', () => {
    const task = jest.fn();
    const handle = runAfterPaint(task, 100);
    jest.advanceTimersByTime(20);
    handle.cancel();
    jest.runAllTimers();
    expect(task).not.toHaveBeenCalled();
  });

  it('can be cancelled after it has run', () => {
    const task = jest.fn();
    const handle = runAfterPaint(task);
    jest.runAllTimers();
    expect(() => handle.cancel()).not.toThrow();
    expect(task).toHaveBeenCalledTimes(1);
  });
});

describe('runAfterTransition', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits out the transition after the first paint', () => {
    const task = jest.fn();
    runAfterTransition(task);
    jest.advanceTimersByTime(16 + TRANSITION_SETTLE_MS - 1);
    expect(task).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
