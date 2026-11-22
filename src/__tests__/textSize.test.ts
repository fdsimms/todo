import { DEFAULT_TEXT_SIZE, TEXT_SIZE_STEPS, parseTextSize, scaleTextStyle, sizeForCap, stepTextSize } from '../utils/textSize';

describe('parseTextSize', () => {
  it('reads a stored step', () => {
    expect(parseTextSize('1.3')).toBe(1.3);
    expect(parseTextSize(1.5)).toBe(1.5);
  });

  it('falls back to the default for anything that is not a step', () => {
    expect(parseTextSize(null)).toBe(DEFAULT_TEXT_SIZE);
    expect(parseTextSize('')).toBe(DEFAULT_TEXT_SIZE);
    expect(parseTextSize('huge')).toBe(DEFAULT_TEXT_SIZE);
    expect(parseTextSize('1.2')).toBe(DEFAULT_TEXT_SIZE);
  });
});

describe('stepTextSize', () => {
  const values = TEXT_SIZE_STEPS.map(s => s.value);

  it('moves one step each way', () => {
    expect(stepTextSize(1, 1)).toBe(values[1]);
    expect(stepTextSize(values[2], -1)).toBe(values[1]);
  });

  it('stops at both ends', () => {
    expect(stepTextSize(values[values.length - 1], 1)).toBe(values[values.length - 1]);
    expect(stepTextSize(1, -1)).toBe(1);
  });

  it('moves a value between steps to the next one in that direction', () => {
    expect(stepTextSize(1.2, 1)).toBe(1.3);
    expect(stepTextSize(1.2, -1)).toBe(1.15);
  });
});

describe('sizeForCap', () => {
  // iOS draws fontSize * min(systemScale, maxFontSizeMultiplier).
  const drawn = (base: number, system: number, app: number, cap: number) => {
    const { fontSizeScale, maxFontSizeMultiplier } = sizeForCap(app, cap);
    return base * fontSizeScale * Math.min(system, maxFontSizeMultiplier);
  };

  it('is the app size alone at the default system size', () => {
    expect(drawn(16, 1, 1.3, 1.65)).toBeCloseTo(16 * 1.3);
  });

  it('multiplies with the system size under the cap', () => {
    expect(drawn(16, 1.1, 1.3, 1.65)).toBeCloseTo(16 * 1.1 * 1.3);
  });

  it('stops where the cap does, however the two combine', () => {
    expect(drawn(16, 2, 1.5, 1.65)).toBeCloseTo(16 * 1.65);
    expect(drawn(16, 1, 1.5, 1.35)).toBeCloseTo(16 * 1.35);
  });

  it('leaves a fixed text (cap 1) alone', () => {
    expect(sizeForCap(1.5, 1)).toEqual({ fontSizeScale: 1, maxFontSizeMultiplier: 1 });
  });
});

describe('scaleTextStyle', () => {
  it('scales the size and line height and nothing else', () => {
    expect(scaleTextStyle({ fontSize: 16, lineHeight: 22 }, 1.5)).toEqual({ fontSize: 24, lineHeight: 33 });
  });

  it('leaves out a line height the style never had', () => {
    expect(scaleTextStyle({ fontSize: 13 }, 1.15)).toEqual({ fontSize: 15 });
  });

  it('rounds to a quarter point', () => {
    expect(scaleTextStyle({ fontSize: 11 }, 1.15)).toEqual({ fontSize: 12.75 });
  });
});
