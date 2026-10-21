import { countStripScale } from '../utils/stripScale';

describe('countStripScale', () => {
  it('draws a line for every count up to three', () => {
    expect(countStripScale(1)).toEqual({ top: 1, levels: [0, 1] });
    expect(countStripScale(3)).toEqual({ top: 3, levels: [0, 1, 2, 3] });
  });

  it('treats an empty window as one so there is still a scale', () => {
    expect(countStripScale(0)).toEqual({ top: 1, levels: [0, 1] });
  });

  it('steps by a third of the busiest bar, rounded up, past three', () => {
    expect(countStripScale(4)).toEqual({ top: 4, levels: [0, 2, 4] });
    expect(countStripScale(5)).toEqual({ top: 6, levels: [0, 2, 4, 6] });
    expect(countStripScale(9)).toEqual({ top: 9, levels: [0, 3, 6, 9] });
  });

  it('never draws more than four lines and always reaches the busiest bar', () => {
    for (let busiest = 1; busiest <= 60; busiest++) {
      const { top, levels } = countStripScale(busiest);
      expect(levels.length).toBeLessThanOrEqual(4);
      expect(top).toBeGreaterThanOrEqual(busiest);
      expect(levels[levels.length - 1]).toBe(top);
    }
  });
});
