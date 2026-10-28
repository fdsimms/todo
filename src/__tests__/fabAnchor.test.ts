import { fabMenuAnchorFor } from '../utils/fabAnchor';

describe('fabMenuAnchorFor', () => {
  const window = { width: 1600, height: 900 };

  it('hangs the menu from the button, not from the window edge', () => {
    // A FAB at the right edge of Today's list pane (x 464..520), not of the window.
    const rect = { x: 464, y: 780, width: 56, height: 56 };
    expect(fabMenuAnchorFor(rect, window, 'right')).toEqual({
      bottom: 64,
      right: 1600 - 520,
      alignItems: 'flex-end',
    });
  });

  it('puts a left-handed menu flush with the button’s left edge', () => {
    const rect = { x: 260, y: 780, width: 56, height: 56 };
    expect(fabMenuAnchorFor(rect, window, 'left')).toEqual({ bottom: 64, left: 260, alignItems: 'flex-start' });
  });

  it('is the old 24pt inset when the button sits in a phone-width window', () => {
    const phone = { width: 393, height: 852 };
    const rect = { x: 393 - 24 - 56, y: 852 - 64 - 56, width: 56, height: 56 };
    expect(fabMenuAnchorFor(rect, phone, 'right')).toMatchObject({ bottom: 64, right: 24 });
  });

  it('never goes negative when a measurement lands a hair outside the window', () => {
    const rect = { x: 1590, y: 890, width: 20, height: 20 };
    expect(fabMenuAnchorFor(rect, window, 'right')).toMatchObject({ bottom: 0, right: 0 });
    expect(fabMenuAnchorFor({ ...rect, x: -3 }, window, 'left')).toMatchObject({ left: 0 });
  });
});
