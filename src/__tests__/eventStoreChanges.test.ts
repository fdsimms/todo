import { createCoalescedTrigger } from '../utils/eventStoreChanges';

describe('createCoalescedTrigger', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs once after the delay, not at once', () => {
    const run = jest.fn();
    const trigger = createCoalescedTrigger(run, 1000);
    trigger.fire();
    expect(run).not.toHaveBeenCalled();
    jest.advanceTimersByTime(999);
    expect(run).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('turns a burst into one run', () => {
    const run = jest.fn();
    const trigger = createCoalescedTrigger(run, 1000);
    trigger.fire();
    trigger.fire();
    trigger.fire();
    jest.advanceTimersByTime(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not push the run back for a change that arrives while it waits', () => {
    const run = jest.fn();
    const trigger = createCoalescedTrigger(run, 1000);
    trigger.fire();
    jest.advanceTimersByTime(900);
    trigger.fire();
    jest.advanceTimersByTime(100);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs again for a change after the last run', () => {
    const run = jest.fn();
    const trigger = createCoalescedTrigger(run, 1000);
    trigger.fire();
    jest.advanceTimersByTime(1000);
    trigger.fire();
    jest.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('drops a waiting run when cancelled, and can be used again', () => {
    const run = jest.fn();
    const trigger = createCoalescedTrigger(run, 1000);
    trigger.fire();
    trigger.cancel();
    jest.advanceTimersByTime(5000);
    expect(run).not.toHaveBeenCalled();
    trigger.fire();
    jest.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('is safe to cancel when nothing is waiting', () => {
    expect(() => createCoalescedTrigger(jest.fn(), 1000).cancel()).not.toThrow();
  });
});

describe('onEventStoreChanged', () => {
  it('hands back an unsubscribe that does nothing where the bridge is not linked', () => {
    jest.isolateModules(() => {
      jest.doMock('todo-eventkit-bridge', () => {
        throw new Error('native module not linked');
      });
      const { onEventStoreChanged: subscribe } = require('../utils/eventStoreChanges');
      const stop = subscribe(jest.fn());
      expect(typeof stop).toBe('function');
      expect(() => stop()).not.toThrow();
    });
  });

  it('subscribes through the bridge and returns its unsubscribe', () => {
    const remove = jest.fn();
    const listener = jest.fn();
    jest.isolateModules(() => {
      jest.doMock('todo-eventkit-bridge', () => ({
        addEventStoreChangeListener: (cb: () => void) => {
          cb();
          return remove;
        },
      }));
      const { onEventStoreChanged: subscribe } = require('../utils/eventStoreChanges');
      const stop = subscribe(listener);
      expect(listener).toHaveBeenCalledTimes(1);
      stop();
      expect(remove).toHaveBeenCalledTimes(1);
    });
  });
});
