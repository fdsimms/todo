import { runStartupStep, runStartupSequence, runStartupSequenceSpaced } from '../utils/startup';

describe('runStartupStep', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('runs the step and reports success', () => {
    const step = jest.fn();
    expect(runStartupStep('init', step)).toBe(true);
    expect(step).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('swallows a throw and reports failure', () => {
    expect(runStartupStep('init', () => { throw new Error('boom'); })).toBe(false);
  });

  it('logs the step name with the error, so a device log names the culprit', () => {
    const error = new Error('boom');
    runStartupStep('purge', () => { throw error; });
    expect(errorSpy).toHaveBeenCalledWith('Startup step "purge" failed', error);
  });

  // The whole point: a native module that isn't there throws a TypeError rather
  // than an Error, and that must not escape either.
  it('catches a non-Error throw', () => {
    expect(runStartupStep('native', () => { (undefined as any).call(); })).toBe(false);
  });
});

describe('runStartupSequence', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('runs every step in order', () => {
    const order: string[] = [];
    runStartupSequence([
      ['a', () => { order.push('a'); }],
      ['b', () => { order.push('b'); }],
      ['c', () => { order.push('c'); }],
    ]);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('returns [] when everything succeeds', () => {
    expect(runStartupSequence([['a', () => {}], ['b', () => {}]])).toEqual([]);
  });

  // A failing pass must not strand the ones after it — they don't depend on it,
  // and the app blanking because step 3 of 10 threw is the bug this exists for.
  it('keeps going after a failure and names what failed', () => {
    const after = jest.fn();
    const failed = runStartupSequence([
      ['first', () => {}],
      ['second', () => { throw new Error('boom'); }],
      ['third', after],
    ]);
    expect(failed).toEqual(['second']);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('names every failure when several throw', () => {
    const failed = runStartupSequence([
      ['a', () => { throw new Error('a'); }],
      ['b', () => {}],
      ['c', () => { throw new Error('c'); }],
    ]);
    expect(failed).toEqual(['a', 'c']);
  });

  it('does nothing and reports nothing for an empty sequence', () => {
    expect(runStartupSequence([])).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('runStartupSequenceSpaced', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 10, 27, 9));
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    jest.useRealTimers();
  });

  // A step that takes `ms` of the clock, the way a slow pass does.
  const slow = (log: string[], name: string, ms: number): [string, () => void] => [name, () => {
    log.push(name);
    jest.setSystemTime(Date.now() + ms);
  }];

  it('runs quick steps in one go, in order, and reports the ones that threw', () => {
    const log: string[] = [];
    const done = jest.fn();
    runStartupSequenceSpaced([
      slow(log, 'a', 1),
      ['b', () => { throw new Error('boom'); }],
      slow(log, 'c', 1),
    ], done);
    expect(log).toEqual(['a', 'c']);
    expect(done).toHaveBeenCalledWith(['b']);
  });

  it('hands the thread back once a slice has used its time, then carries on in order', () => {
    const log: string[] = [];
    const done = jest.fn();
    runStartupSequenceSpaced([slow(log, 'a', 20), slow(log, 'b', 20), slow(log, 'c', 1)], done);
    expect(log).toEqual(['a']);
    expect(done).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(log).toEqual(['a', 'b']);
    jest.runOnlyPendingTimers();
    expect(log).toEqual(['a', 'b', 'c']);
    expect(done).toHaveBeenCalledWith([]);
  });

  it('stops before the next slice when cancelled, and never calls done', () => {
    const log: string[] = [];
    const done = jest.fn();
    const run = runStartupSequenceSpaced([slow(log, 'a', 20), slow(log, 'b', 1)], done);
    run.cancel();
    jest.advanceTimersByTime(10);
    expect(log).toEqual(['a']);
    expect(done).not.toHaveBeenCalled();
  });
});

