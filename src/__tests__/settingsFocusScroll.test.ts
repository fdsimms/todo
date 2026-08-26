import {
  settingsFocusScrollTarget,
  SETTINGS_FOCUS_PADDING,
} from '../utils/settingsFocusScroll';

describe('settingsFocusScrollTarget', () => {
  it('leaves room above the row rather than putting it flush at the top', () => {
    expect(settingsFocusScrollTarget(500)).toBe(500 - SETTINGS_FOCUS_PADDING);
  });

  it('does not scroll a row that is already near the top', () => {
    // Every row above the padding would otherwise ask for a negative offset,
    // which reads as the list yanking downward on open.
    expect(settingsFocusScrollTarget(0)).toBe(0);
    expect(settingsFocusScrollTarget(SETTINGS_FOCUS_PADDING - 10)).toBe(0);
  });

  it('refuses to scroll past the end of the content', () => {
    // The last row of a long group: asking for rowY - padding would leave the
    // scroll view rubber-banded past its content and settling back somewhere
    // the caller didn't choose.
    expect(settingsFocusScrollTarget(2000, 2200, 800)).toBe(1400);
  });

  it('does not scroll at all when the content fits the viewport', () => {
    expect(settingsFocusScrollTarget(300, 500, 800)).toBe(0);
  });

  it('still clamps at the top when the sizes are not known yet', () => {
    // The row can report in before the scroll view has measured itself, and a
    // missing size must not become a missing clamp.
    expect(settingsFocusScrollTarget(1000)).toBe(1000 - SETTINGS_FOCUS_PADDING);
    expect(settingsFocusScrollTarget(10)).toBe(0);
  });

  it('treats an unmeasurable row as no scroll', () => {
    expect(settingsFocusScrollTarget(NaN)).toBe(0);
  });
});
