import {
  flaggableText,
  getFlagModeVersion,
  isFlagMode,
  isTextFlagged,
  requestCapture,
  setCaptureListener,
  setFlagMode,
  setFlaggedTexts,
  subscribeFlagMode,
} from '../utils/copyFlagMode';

describe('flaggableText', () => {
  it('reads a string or a number', () => {
    expect(flaggableText('Hello')).toBe('Hello');
    expect(flaggableText(3)).toBe('3');
  });

  it('joins an array of strings in order and drops elements', () => {
    expect(flaggableText(['3', ' tasks ', { type: 'Text' }, 'left'])).toBe('3 tasks left');
  });

  it('is empty when there is nothing to flag', () => {
    expect(flaggableText(undefined)).toBe('');
    expect(flaggableText({ type: 'Text' })).toBe('');
    expect(flaggableText('   ')).toBe('');
  });

  it('caps very long text', () => {
    expect(flaggableText('x'.repeat(900))).toHaveLength(500);
  });
});

describe('flag mode', () => {
  afterEach(() => {
    setFlagMode(false);
    setFlaggedTexts([]);
    setCaptureListener(null);
  });

  it('notifies on a change and not on a repeat', () => {
    const listener = jest.fn();
    const off = subscribeFlagMode(listener);
    setFlagMode(true);
    setFlagMode(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(isFlagMode()).toBe(true);
    off();
  });

  it('bumps the version only when flagged text changes while the mode is on', () => {
    const before = getFlagModeVersion();
    setFlaggedTexts(['a']);
    expect(getFlagModeVersion()).toBe(before);
    setFlagMode(true);
    const on = getFlagModeVersion();
    setFlaggedTexts(['a', 'b']);
    expect(getFlagModeVersion()).toBeGreaterThan(on);
    expect(isTextFlagged('b')).toBe(true);
    expect(isTextFlagged('c')).toBe(false);
  });

  it('hands a captured string to the listener', () => {
    const listener = jest.fn();
    setCaptureListener(listener);
    requestCapture('Hello');
    expect(listener).toHaveBeenCalledWith('Hello');
  });
});
