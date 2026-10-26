import { pillRevealOffset } from '@/utils/pillReveal';

describe('pillRevealOffset', () => {
  const viewport = 390;
  const content = 800;
  const margin = 16;

  it('leaves a pill already in view where it is', () => {
    expect(pillRevealOffset({ x: 16, width: 100 }, viewport, content, 0, margin)).toBeNull();
    expect(pillRevealOffset({ x: 250, width: 100 }, viewport, content, 0, margin)).toBeNull();
  });

  it('centres a pill past the right edge', () => {
    // Centre at 600, so the row scrolls to 600 - 195.
    expect(pillRevealOffset({ x: 550, width: 100 }, viewport, content, 0, margin)).toBe(405);
  });

  it('counts a pill cut off by the edge as out of view', () => {
    expect(pillRevealOffset({ x: 300, width: 100 }, viewport, content, 0, margin)).not.toBeNull();
  });

  it('centres a pill scrolled off the left edge', () => {
    expect(pillRevealOffset({ x: 250, width: 100 }, viewport, content, 400, margin)).toBe(105);
  });

  it('clamps to the end of the row rather than scrolling past it', () => {
    expect(pillRevealOffset({ x: 690, width: 94 }, viewport, content, 0, margin)).toBe(content - viewport);
  });

  it('clamps to the start of the row', () => {
    expect(pillRevealOffset({ x: 16, width: 100 }, viewport, content, 300, margin)).toBe(0);
  });

  it('does nothing before the row has a width', () => {
    expect(pillRevealOffset({ x: 550, width: 100 }, 0, content, 0, margin)).toBeNull();
  });
});
