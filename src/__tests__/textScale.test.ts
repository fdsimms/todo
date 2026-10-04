import { clampTextScale, scaledTextBox } from '../utils/textScale';

describe('clampTextScale', () => {
  it('passes a scale between 1 and the cap through', () => {
    expect(clampTextScale(1.35, 1.65)).toBe(1.35);
  });

  it('stops at the cap, the size text itself stops at', () => {
    expect(clampTextScale(3.12, 1.65)).toBe(1.65);
  });

  it('never shrinks a box below the size it was drawn at', () => {
    expect(clampTextScale(0.82, 1.65)).toBe(1);
    expect(clampTextScale(1, 1.65)).toBe(1);
  });

  it('reads a scale it cannot use as 1', () => {
    expect(clampTextScale(NaN, 1.65)).toBe(1);
    expect(clampTextScale(0, 1.65)).toBe(1);
    expect(clampTextScale(Infinity, 1.65)).toBe(1);
  });

  it('treats a cap below 1 as no growth rather than shrinking', () => {
    expect(clampTextScale(1.5, 0.5)).toBe(1);
  });
});

describe('scaledTextBox', () => {
  it('scales a drawn size and rounds it to a whole point', () => {
    expect(scaledTextBox(56, 1.35, 1.65)).toBe(76);
    expect(scaledTextBox(56, 2.35, 1.65)).toBe(92);
  });

  it('leaves the drawn size alone at the default setting', () => {
    expect(scaledTextBox(64, 1, 1.65)).toBe(64);
  });
});
