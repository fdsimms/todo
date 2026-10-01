import { cardAnchorPlacement, ANCHOR_GAP, ANCHOR_EDGE, ANCHOR_REACH } from '../utils/cardAnchor';

const window = { width: 390, height: 844 };
const insets = { top: 47, bottom: 34 };

describe('cardAnchorPlacement', () => {
  it('opens below a header button, hugging the right edge', () => {
    const p = cardAnchorPlacement({ x: 360, y: 70 }, window, insets, 300);
    expect(p.top).toBe(70 + ANCHOR_GAP);
    expect(p.bottom).toBeUndefined();
    expect(p.right).toBe(ANCHOR_EDGE);
    expect(p.left).toBeUndefined();
    expect(p.transformOrigin).toBe('top right');
    expect(p.maxHeight).toBe(844 - (70 + ANCHOR_GAP) - 34 - ANCHOR_EDGE);
  });

  it('opens above a touch in the bottom half', () => {
    const p = cardAnchorPlacement({ x: 60, y: 700 }, window, insets, 300);
    expect(p.bottom).toBe(844 - 700 + ANCHOR_GAP);
    expect(p.top).toBeUndefined();
    expect(p.left).toBe(60 - ANCHOR_REACH);
    expect(p.transformOrigin).toBe('bottom left');
  });

  it('keeps the card on screen when the touch is near the far side', () => {
    const p = cardAnchorPlacement({ x: 180, y: 300 }, window, insets, 300);
    // Left half: would start at 156 and run past the right edge, so it slides in.
    expect(p.left).toBe(390 - 300 - ANCHOR_EDGE);
  });

  it('never goes under the status bar', () => {
    const p = cardAnchorPlacement({ x: 360, y: 10 }, window, insets, 300);
    expect(p.top).toBe(insets.top);
  });

  it('narrows to the screen on a small window', () => {
    const p = cardAnchorPlacement({ x: 300, y: 70 }, { width: 280, height: 600 }, insets, 300);
    expect(p.width).toBe(280 - ANCHOR_EDGE * 2);
    expect(p.right).toBe(ANCHOR_EDGE);
  });
});
