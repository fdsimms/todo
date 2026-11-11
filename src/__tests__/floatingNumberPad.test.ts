import {
  isTopNumberPadBar,
  numberPadBarFloats,
  numberPadFocused,
  publishNumberPadBar,
  resetFloatingNumberPad,
  setNumberPadFocus,
  subscribeNumberPadBar,
  topNumberPadBar,
  withdrawNumberPadBar,
  NUMBER_PAD_ACCESSORY_ID,
} from '../utils/floatingNumberPad';
import { registerAccessory, resetAccessoryStacks, unregisterAccessory } from '../utils/accessoryStack';

beforeEach(() => {
  resetAccessoryStacks();
  resetFloatingNumberPad();
});

describe('numberPadBarFloats', () => {
  it('floats only with glass, on an iPhone', () => {
    expect(numberPadBarFloats(true, 'ios', false)).toBe(true);
    expect(numberPadBarFloats(false, 'ios', false)).toBe(false);
    expect(numberPadBarFloats(true, 'ios', true)).toBe(false);
    expect(numberPadBarFloats(true, 'android', false)).toBe(false);
  });
});

describe('focus', () => {
  it('is wanted while any field holds it, and notifies on each change', () => {
    const seen = jest.fn();
    const off = subscribeNumberPadBar(seen);
    setNumberPadFocus('a', true);
    setNumberPadFocus('a', true);
    expect(seen).toHaveBeenCalledTimes(1);
    setNumberPadFocus('b', true);
    setNumberPadFocus('a', false);
    expect(numberPadFocused()).toBe(true);
    setNumberPadFocus('b', false);
    expect(numberPadFocused()).toBe(false);
    off();
  });
});

describe('the published bar', () => {
  it('is the newest accessory\'s, and the one underneath comes back when it closes', () => {
    const screenNext = jest.fn();
    const sheetNext = jest.fn();
    registerAccessory(NUMBER_PAD_ACCESSORY_ID, 'screen');
    publishNumberPadBar('screen', { onNext: screenNext });
    registerAccessory(NUMBER_PAD_ACCESSORY_ID, 'sheet');
    publishNumberPadBar('sheet', { onNext: sheetNext });
    expect(topNumberPadBar()?.onNext).toBe(sheetNext);
    expect(isTopNumberPadBar('sheet')).toBe(true);

    withdrawNumberPadBar('sheet');
    unregisterAccessory(NUMBER_PAD_ACCESSORY_ID, 'sheet');
    expect(topNumberPadBar()?.onNext).toBe(screenNext);
  });

  it('is null with nothing mounted, and a republish replaces the callbacks', () => {
    expect(topNumberPadBar()).toBeNull();
    registerAccessory(NUMBER_PAD_ACCESSORY_ID, 'a');
    const first = jest.fn();
    const second = jest.fn();
    publishNumberPadBar('a', { onOperator: first });
    publishNumberPadBar('a', { onOperator: second });
    expect(topNumberPadBar()?.onOperator).toBe(second);
  });

  it('tells subscribers when the stacking changes', () => {
    const seen = jest.fn();
    const off = subscribeNumberPadBar(seen);
    registerAccessory(NUMBER_PAD_ACCESSORY_ID, 'a');
    expect(seen).toHaveBeenCalled();
    off();
  });
});
