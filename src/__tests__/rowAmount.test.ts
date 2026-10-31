import {
  adjustedQuantity,
  canAdjustAmount,
  describeRowFactor,
  parseRowFactor,
} from '../utils/rowAmount';

describe('adjustedQuantity', () => {
  it('halves the amount and keeps the prep note', () => {
    expect(adjustedQuantity('32 ounces, cut into ½-inch cubes', 0.5)).toBe('16 ounces, cut into ½-inch cubes');
  });

  it('leaves a full amount alone', () => {
    expect(adjustedQuantity('3 Tbsp', 1)).toBe('3 Tbsp');
  });

  it('refuses an amount it cannot work out rather than adding all of it', () => {
    expect(adjustedQuantity('a pinch', 0.5)).toBeNull();
    expect(adjustedQuantity('2 cups plus 2 tbsp', 0.5)).toBeNull();
  });

  it('refuses half of a single sized can', () => {
    expect(adjustedQuantity('14 oz can', 0.5)).toBeNull();
  });
});

describe('canAdjustAmount', () => {
  it('is false for no amount and for one that cannot be scaled', () => {
    expect(canAdjustAmount(null)).toBe(false);
    expect(canAdjustAmount('')).toBe(false);
    expect(canAdjustAmount('to taste')).toBe(false);
  });

  it('is true for an ordinary amount', () => {
    expect(canAdjustAmount('2 heads')).toBe(true);
  });
});

describe('parseRowFactor', () => {
  it('reads fractions, decimals and mixed numbers', () => {
    expect(parseRowFactor('3/4')).toBe(0.75);
    expect(parseRowFactor('0.75')).toBe(0.75);
    expect(parseRowFactor('1 1/2')).toBe(1.5);
    expect(parseRowFactor(' 2× ')).toBe(2);
  });

  it('refuses zero, negatives, words, a zero denominator and anything over the cap', () => {
    for (const bad of ['', '0', '-1', 'half', '1/0', '11']) {
      expect(parseRowFactor(bad)).toBeNull();
    }
  });
});

describe('describeRowFactor', () => {
  it('names the common factors in words', () => {
    expect(describeRowFactor(0.5)).toBe('Adding half the amount');
    expect(describeRowFactor(0.25)).toBe('Adding a quarter of the amount');
  });

  it('falls back to the multiplier', () => {
    expect(describeRowFactor(2)).toBe('Adding 2× the amount');
  });
});
