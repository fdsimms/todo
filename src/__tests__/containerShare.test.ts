import { CONTAINER_SHARES, shareFromGrams } from '../utils/containerShare';

describe('CONTAINER_SHARES', () => {
  it('runs smallest to largest and ends on the whole', () => {
    const factors = CONTAINER_SHARES.map(s => s.factor);
    expect([...factors].sort((a, b) => a - b)).toEqual(factors);
    expect(factors[factors.length - 1]).toBe(1);
  });
});

describe('shareFromGrams', () => {
  it('turns a weight into a share of the container', () => {
    const s = shareFromGrams('120 g', 480);
    expect(s?.factor).toBeCloseTo(0.25);
    expect(s?.share).toBe('120 g');
  });

  it('accepts a bare number, a comma decimal and "grams"', () => {
    expect(shareFromGrams('100', 400)?.factor).toBeCloseTo(0.25);
    expect(shareFromGrams('12,5', 100)?.factor).toBeCloseTo(0.125);
    expect(shareFromGrams('200 grams', 400)?.factor).toBeCloseTo(0.5);
  });

  it('refuses what cannot be logged', () => {
    expect(shareFromGrams('', 400)).toBeNull();
    expect(shareFromGrams('0', 400)).toBeNull();
    expect(shareFromGrams('abc', 400)).toBeNull();
    expect(shareFromGrams('500', 400)).toBeNull();
    expect(shareFromGrams('2 oz', 400)).toBeNull();
  });

  it('refuses when the container has no known weight', () => {
    expect(shareFromGrams('100', null)).toBeNull();
    expect(shareFromGrams('100', 0)).toBeNull();
  });

  it('allows the whole container', () => {
    expect(shareFromGrams('400', 400)?.factor).toBe(1);
  });
});
