import { replayHeldForDemo, runOrHoldForDemo } from '../utils/demoHold';
import { setDemoModeActive } from '../utils/demoState';

afterEach(() => {
  setDemoModeActive(false);
  replayHeldForDemo();
});

describe('runOrHoldForDemo', () => {
  it('runs straight away outside a demo', () => {
    const action = jest.fn();
    runOrHoldForDemo(action);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('holds during a demo and replays in arrival order once it ends', () => {
    const order: string[] = [];
    setDemoModeActive(true);
    runOrHoldForDemo(() => order.push('dictated task'));
    runOrHoldForDemo(() => order.push('Live Activity done'));
    expect(order).toEqual([]);

    setDemoModeActive(false);
    replayHeldForDemo();
    expect(order).toEqual(['dictated task', 'Live Activity done']);

    replayHeldForDemo();
    expect(order).toHaveLength(2);
  });

  it('keeps replaying past one that throws', () => {
    const later = jest.fn();
    setDemoModeActive(true);
    runOrHoldForDemo(() => { throw new Error('task deleted since'); });
    runOrHoldForDemo(later);
    setDemoModeActive(false);
    replayHeldForDemo();
    expect(later).toHaveBeenCalled();
  });
});
