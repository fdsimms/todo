import {
  RECIPE_SCALE_FACTORS,
  describeUnscaled,
  factorForServings,
  formatQuantityAmount,
  formatScale,
  isUnscaled,
  normalizeScale,
  quantityAmount,
  scaleQuantity,
  scaleServings,
  targetServingsFor,
} from '../utils/recipeScale';

const text = (quantity: string, factor: number) => scaleQuantity(quantity, factor).text;

describe('scaleQuantity', () => {
  it('scales a bare count', () => {
    expect(text('3', 2)).toBe('6');
    expect(text('12', 0.5)).toBe('6');
    expect(text('2', 1.5)).toBe('3');
  });

  it('scales an amount and agrees the unit with it', () => {
    expect(text('2 cups', 2)).toBe('4 cups');
    expect(text('2 cups', 0.5)).toBe('1 cup');
    expect(text('1 clove', 2)).toBe('2 cloves');
    expect(text('1 loaf', 2)).toBe('2 loaves');
    expect(text('1 bunch', 3)).toBe('3 bunches');
    expect(text('2 boxes', 0.5)).toBe('1 box');
  });

  it('leaves units that never inflect alone', () => {
    expect(text('2 tbsp', 2)).toBe('4 tbsp');
    expect(text('1 tsp', 3)).toBe('3 tsp');
    expect(text('50 g', 2)).toBe('100 g');
    expect(text('300 ml', 1.5)).toBe('450 ml');
    expect(text('1 dozen', 2)).toBe('2 dozen');
  });

  it('normalizes a plural back to singular when the result is one', () => {
    expect(text('2 cans', 0.5)).toBe('1 can');
    expect(text('4 links', 0.5)).toBe('2 links');
    expect(text('2 lb', 2)).toBe('4 lbs');
  });

  it('takes the singular for a fraction under one, not the plural', () => {
    // "1/2 cups" is the bug this guards: the threshold is > 1, not !== 1.
    expect(text('1 cup', 0.5)).toBe('1/2 cup');
    expect(text('1 teaspoon', 0.5)).toBe('1/2 teaspoon');
    expect(text('1 1/2 cups', 0.5)).toBe('3/4 cup');
    expect(text('1 loaf', 0.5)).toBe('1/2 loaf');
  });

  it('reads and writes fractions and mixed numbers', () => {
    expect(text('1/4 cup', 2)).toBe('1/2 cup');
    expect(text('1/4 tsp', 0.5)).toBe('1/8 tsp');
    expect(text('1 1/2 cups', 2)).toBe('3 cups');
    expect(text('2 1/4 lb', 2)).toBe('4 1/2 lbs');
    expect(text('1/2', 2)).toBe('1');
  });

  it('is exact, so a third scales without float noise', () => {
    expect(text('1/3 cup', 3)).toBe('1 cup');
    expect(text('1/3 cup', 0.5)).toBe('1/6 cup');
    expect(text('2/3 cup', 1.5)).toBe('1 cup');
    expect(text('1/8 tsp', 0.5)).toBe('1/16 tsp');
  });

  it('keeps a decimal quantity in decimals', () => {
    expect(text('1.5 kg', 2)).toBe('3 kg');
    expect(text('1.5 kg', 0.5)).toBe('0.75 kg');
    expect(text('1.5 kg', 1.5)).toBe('2.25 kg');
  });

  it('never converts units', () => {
    // "1 kg" would be idiomatic; knowing that requires knowing g and kg
    // measure the same thing, which is exactly what this module doesn't claim.
    expect(text('500 g', 2)).toBe('1000 g');
  });

  it('scales the count of a sized container, never its size', () => {
    expect(text('2 14 oz cans', 2)).toBe('4 14 oz cans');
    expect(text('2 14 oz cans', 0.5)).toBe('1 14 oz can');
    expect(text('2 14.5 oz cans', 1.5)).toBe('3 14.5 oz cans');
    expect(text('2 14 ounce cans', 0.5)).toBe('1 14 ounce can');
  });

  it('adds a count to an uncounted sized container rather than resizing it', () => {
    // "14 oz can" is one can of broth. Doubling must not make it a 28 oz can.
    expect(text('14 oz can', 2)).toBe('2 14 oz cans');
    expect(text('14 oz can', 3)).toBe('3 14 oz cans');
  });

  it('refuses to halve an uncounted sized container', () => {
    // Half of "one 14 oz can" has no expression in this notation.
    expect(scaleQuantity('14 oz can', 0.5)).toEqual({ text: '14 oz can', scaled: false });
  });

  it('scales the trailing-count notation', () => {
    expect(text('x2', 2)).toBe('x4');
    expect(text('x12', 0.5)).toBe('x6');
  });

  it('carries a size clause through without spacing it away from the comma', () => {
    expect(text('1, medium', 2)).toBe('2, medium');
    expect(text('2, large', 0.5)).toBe('1, large');
  });

  it('passes an unparseable amount through verbatim and flags it', () => {
    for (const quantity of ['a pinch', 'to taste', 'dozen', 'a knob', 'some']) {
      expect(scaleQuantity(quantity, 2)).toEqual({ text: quantity, scaled: false });
    }
  });

  it('leaves a unit it cannot inflect in the user\'s own words', () => {
    // "2 bulb" is the deliberate trade — a naive +s would produce "2 pinchs".
    expect(text('1 bulb', 2)).toBe('2 bulb');
    expect(text('1 pinch', 2)).toBe('2 pinch');
  });

  it('never treats a percentage as an amount', () => {
    expect(scaleQuantity('2%', 2)).toEqual({ text: '2%', scaled: false });
  });

  it('is a flagged no-op at a factor of one, and for junk factors', () => {
    expect(scaleQuantity('2 cups', 1)).toEqual({ text: '2 cups', scaled: false });
    expect(scaleQuantity('2 cups', 0)).toEqual({ text: '2 cups', scaled: false });
    expect(scaleQuantity('2 cups', -2)).toEqual({ text: '2 cups', scaled: false });
    expect(scaleQuantity('2 cups', NaN)).toEqual({ text: '2 cups', scaled: false });
  });

  it('handles an empty quantity', () => {
    expect(scaleQuantity('', 2)).toEqual({ text: '', scaled: false });
    expect(scaleQuantity('   ', 2)).toEqual({ text: '', scaled: false });
  });

  it('trims, so a stored quantity with slack renders clean', () => {
    expect(text('  2 cups  ', 2)).toBe('4 cups');
  });

  it('survives a zero denominator rather than dividing by it', () => {
    expect(scaleQuantity('1/0 cup', 2).scaled).toBe(false);
  });

  it('round-trips every factor the UI offers, on every notation it may meet', () => {
    const corpus = ['1', '2 cups', '1/4 cup', '1 1/2 cups', '1.5 kg', '2 14 oz cans', 'x2', '2, large'];
    for (const factor of RECIPE_SCALE_FACTORS) {
      for (const quantity of corpus) {
        const result = scaleQuantity(quantity, factor);
        expect(typeof result.text).toBe('string');
        expect(result.text.length).toBeGreaterThan(0);
        // Nothing ever renders a float artefact like "0.7999999999999999".
        expect(result.text).not.toMatch(/\d\.\d{3,}/);
      }
    }
  });
});

describe('quantityAmount', () => {
  it('reads every notation, including the fractions parseQuantityAmount used to refuse', () => {
    expect(quantityAmount('2 cups')).toEqual({ value: 2, decimal: false });
    expect(quantityAmount('1/2 cup')).toEqual({ value: 0.5, decimal: false });
    expect(quantityAmount('1 1/2 cups')).toEqual({ value: 1.5, decimal: false });
    expect(quantityAmount('1.5 kg')).toEqual({ value: 1.5, decimal: true });
  });

  it('is null for anything not opening with an amount', () => {
    expect(quantityAmount('a pinch')).toBeNull();
    expect(quantityAmount('')).toBeNull();
  });
});

describe('formatQuantityAmount', () => {
  it('renders a sum the way scaling renders a product', () => {
    expect(formatQuantityAmount(0.75)).toBe('3/4');
    expect(formatQuantityAmount(3)).toBe('3');
    expect(formatQuantityAmount(1.5)).toBe('1 1/2');
    expect(formatQuantityAmount(1.5, true)).toBe('1.5');
  });
});

describe('formatScale', () => {
  it('labels a chip', () => {
    expect(formatScale(0.5)).toBe('½×');
    expect(formatScale(1)).toBe('1×');
    expect(formatScale(1.5)).toBe('1½×');
    expect(formatScale(2)).toBe('2×');
    expect(formatScale(3)).toBe('3×');
  });

  it('renders a clamped factor rather than a nonsense one', () => {
    expect(formatScale(0)).toBe('1×');
    expect(formatScale(NaN)).toBe('1×');
  });

  it('renders a servings-derived factor as a clean fraction rather than a decimal', () => {
    // 3 servings out of a recipe that makes 8 is exactly 3/8 — not "0.38×".
    expect(formatScale(3 / 8)).toBe('3/8×');
    expect(formatScale(5 / 4)).toBe('1 1/4×');
  });

  it('falls back to a decimal only when no cooking fraction lands exactly', () => {
    expect(formatScale(1 / 7)).toBe('0.14×');
  });
});

describe('factorForServings / targetServingsFor', () => {
  it('computes the factor a target servings count implies', () => {
    expect(factorForServings(3, 8)).toBe(3 / 8);
    expect(factorForServings(16, 8)).toBe(2);
    expect(factorForServings(8, 8)).toBe(1);
  });

  it('round-trips through scaleQuantity exactly, not approximately', () => {
    // The whole point: "makes 8, I need 3" must scale ingredients exactly,
    // the same way a 3/8 chip tap would.
    const factor = factorForServings(3, 8);
    expect(scaleQuantity('2 cups', factor).text).toBe('3/4 cup');
    expect(scaleQuantity('1 lb', factor).text).toBe('3/8 lb');
  });

  it('is the inverse of scaleServings, for seeding the stepper from a factor', () => {
    expect(targetServingsFor(8, factorForServings(3, 8))).toBe(3);
    expect(targetServingsFor(4, 2)).toBe(8);
    expect(targetServingsFor(4, 0.5)).toBe(2);
  });

  it('rounds to a whole person and never below one', () => {
    expect(targetServingsFor(3, factorForServings(1, 3))).toBe(1);
    expect(targetServingsFor(8, 0.05)).toBe(1);
  });

  it('treats a non-positive target or base as a no-op factor rather than dividing by it', () => {
    expect(factorForServings(0, 8)).toBe(1);
    expect(factorForServings(-2, 8)).toBe(1);
    expect(factorForServings(3, 0)).toBe(1);
    expect(factorForServings(3, -1)).toBe(1);
    expect(factorForServings(NaN, 8)).toBe(1);
  });
});

describe('normalizeScale / isUnscaled', () => {
  it('clamps a missing or nonsense factor to 1', () => {
    expect(normalizeScale(null)).toBe(1);
    expect(normalizeScale(undefined)).toBe(1);
    expect(normalizeScale(0)).toBe(1);
    expect(normalizeScale(-3)).toBe(1);
    expect(normalizeScale(NaN)).toBe(1);
    expect(normalizeScale(2)).toBe(2);
  });

  it('treats an absent factor as unscaled', () => {
    expect(isUnscaled(null)).toBe(true);
    expect(isUnscaled(1)).toBe(true);
    expect(isUnscaled(2)).toBe(false);
  });
});

describe('scaleServings', () => {
  it('scales a count and a range', () => {
    expect(scaleServings(4, null, 2)).toEqual({ servings: 8, servingsMax: null });
    expect(scaleServings(4, 6, 2)).toEqual({ servings: 8, servingsMax: 12 });
    expect(scaleServings(4, 6, 0.5)).toEqual({ servings: 2, servingsMax: 3 });
  });

  it('rounds to whole people and never below one', () => {
    expect(scaleServings(5, null, 1.5)).toEqual({ servings: 8, servingsMax: null });
    expect(scaleServings(1, null, 0.5)).toEqual({ servings: 1, servingsMax: null });
  });

  it('claims nothing for a recipe that never said', () => {
    expect(scaleServings(null, null, 2)).toEqual({ servings: null, servingsMax: null });
    expect(scaleServings(null, 6, 2)).toEqual({ servings: null, servingsMax: null });
  });
});

describe('describeUnscaled', () => {
  it('names the lines the arithmetic skipped', () => {
    expect(describeUnscaled(1, 2)).toBe("1 ingredient couldn't be scaled automatically — adjust by eye");
    expect(describeUnscaled(3, 2)).toBe("3 ingredients couldn't be scaled automatically — adjust by eye");
  });

  it('says nothing when there is nothing to say', () => {
    expect(describeUnscaled(0, 2)).toBeNull();
    expect(describeUnscaled(2, 1)).toBeNull();
  });
});
