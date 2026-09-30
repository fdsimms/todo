import { aimTooltip } from '../utils/tooltipAim';

describe('aimTooltip', () => {
  it('rests at the left edge until the mirrors have measured', () => {
    expect(aimTooltip({ prefixW: null, matchW: 80, inputW: 300, bubbleW: 120, rowW: 300 }))
      .toEqual({ bubbleLeft: 0, caretLeft: 14 });
  });

  it('centres the bubble under the phrase and aims the caret at it', () => {
    // Phrase spans roughly 100..200, centre 150.
    const { bubbleLeft, caretLeft } = aimTooltip({ prefixW: 100, matchW: 200, inputW: 300, bubbleW: 100, rowW: 300 });
    expect(bubbleLeft).toBe(100);
    expect(caretLeft).toBe(44); // 50 into the bubble, minus half the caret
  });

  it('keeps the bubble inside the row at the right edge', () => {
    const { bubbleLeft } = aimTooltip({ prefixW: 250, matchW: 290, inputW: 300, bubbleW: 120, rowW: 300 });
    expect(bubbleLeft).toBe(180);
  });

  it('snaps the caret to the nearest candidate pill', () => {
    const { caretLeft } = aimTooltip({
      prefixW: 0, matchW: 60, inputW: 300, bubbleW: 200, rowW: 300,
      candidateLayouts: [{ x: 0, width: 50 }, { x: 56, width: 60 }],
    });
    // Raw aim is 30, nearest pill centre is 25.
    expect(caretLeft).toBe(19);
  });
});
