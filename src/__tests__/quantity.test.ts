import {
  formatQuantityAmount,
  inflectUnit,
  isSizedContainer,
  isWholeAmount,
  parseQuantity,
  rationalToNumber,
  unitKey,
} from '../utils/quantity';

/** The leading amount as a plain number, for the readings that only care about it. */
const amount = (q: string) => {
  const parsed = parseQuantity(q);
  return parsed.amount === null ? null : rationalToNumber(parsed.amount);
};

describe('parseQuantity — the amount', () => {
  it('reads every notation, including the fractions the merge used to refuse', () => {
    expect(amount('2 cups')).toBe(2);
    expect(amount('1/2 cup')).toBe(0.5);
    expect(amount('1 1/2 cups')).toBe(1.5);
    expect(amount('1.5 kg')).toBe(1.5);
    expect(amount('2lb')).toBe(2);
  });

  it('remembers which notation it was written in', () => {
    expect(parseQuantity('1.5 kg').decimal).toBe(true);
    expect(parseQuantity('1 1/2 cups').decimal).toBe(false);
    expect(parseQuantity('2 cups').decimal).toBe(false);
  });

  it('is null for everything a reader has to refuse', () => {
    expect(amount('')).toBeNull();
    expect(amount('   ')).toBeNull();
    expect(amount('a pinch')).toBeNull();
    expect(amount('to taste')).toBeNull();
    // A percentage is part of a product name ("2% milk"), never an amount.
    expect(amount('2%')).toBeNull();
    // A zero denominator is not a fraction.
    expect(amount('1/0 cup')).toBeNull();
  });

  it('keeps the raw text so a refusal renders exactly what was written', () => {
    expect(parseQuantity('  a pinch  ').raw).toBe('a pinch');
    expect(parseQuantity('  2 cups ').raw).toBe('2 cups');
  });
});

describe('parseQuantity — the unit', () => {
  it('splits the unit word off the prose that follows it', () => {
    const q = parseQuantity('1 cup, packed');
    expect(q.unit).toBe('cup');
    expect(q.unitWritten).toBe('cup');
    expect(q.trailing).toBe(', packed');
    expect(q.rest).toBe('cup, packed');
  });

  it('keys the unit by identity but hands back the word as written', () => {
    expect(parseQuantity('2 CUPS').unit).toBe('cup');
    expect(parseQuantity('2 CUPS').unitWritten).toBe('CUPS');
  });

  it('has no unit when the amount was the whole string', () => {
    const q = parseQuantity('3');
    expect(q.unit).toBeNull();
    expect(q.rest).toBe('');
    expect(q.trailing).toBe('');
  });

  it('has no unit when what follows is a size clause rather than a word', () => {
    // parseGroceryInput's own output for "1 medium onion".
    const q = parseQuantity('1, medium');
    expect(q.unit).toBeNull();
    expect(q.trailing).toBe(', medium');
  });
});

describe('parseQuantity — containers', () => {
  it('reads a bare sized container as a size, not a count', () => {
    const q = parseQuantity('14 oz can');
    expect(q.container).toEqual({
      count: null,
      size: { num: 14, den: 1 },
      sizeText: '14',
      sizeUnit: 'oz',
      word: 'can',
    });
  });

  it('reads a counted sized container as both', () => {
    const q = parseQuantity('2 14 oz cans');
    expect(q.container).toEqual({
      count: { num: 2, den: 1 },
      size: { num: 14, den: 1 },
      sizeText: '14',
      sizeUnit: 'oz',
      word: 'cans',
    });
    // The leading amount of a counted line is the count.
    expect(amount('2 14 oz cans')).toBe(2);
  });

  // "The size is never touched" is taken literally: it's carried as the
  // characters it was written with, so nothing can normalise it on the way
  // through. The counted shape always did this; the bare one used to re-render
  // its size off the parsed amount, which reduced "2/4" and dropped a leading
  // zero — neither reachable from any input the app produces, and both a
  // restatement of a number that names a product on a shelf.
  it('carries the size verbatim, since nothing may restate it', () => {
    expect(parseQuantity('2 14.5 oz jars').container?.sizeText).toBe('14.5');
    expect(parseQuantity('14.5 oz jar').container?.sizeText).toBe('14.5');
    expect(parseQuantity('2/4 oz can').container?.sizeText).toBe('2/4');
  });

  it('tolerates the punctuation an imported line carries', () => {
    expect(parseQuantity('14 oz. can').container?.word).toBe('can');
    expect(parseQuantity('2 14-oz cans').container?.word).toBe('cans');
  });

  it('is not a container when either word is the wrong kind', () => {
    // Same two-word shape, neither word a container.
    expect(parseQuantity('2 cups flour').container).toBeNull();
    expect(parseQuantity('2 cup can').container).toBeNull();
    expect(parseQuantity('2 oz flour').container).toBeNull();
    // Three words after the amount is prose, not a container.
    expect(parseQuantity('2 oz cans black').container).toBeNull();
  });
});

describe('parseQuantity — the x2 notation', () => {
  it('reads the count, and deliberately leaves the amount null', () => {
    const q = parseQuantity('x2');
    expect(q.countNotation).toEqual({ num: 2, den: 1 });
    // Every reader but the scaler refused this before the type existed, and
    // gets that refusal for free from a null amount.
    expect(q.amount).toBeNull();
  });

  it('is only the whole string, never a leading x', () => {
    expect(parseQuantity('x 12').countNotation).toEqual({ num: 12, den: 1 });
    expect(parseQuantity('x2 cans').countNotation).toBeNull();
  });
});

describe('isWholeAmount', () => {
  it('is true for an amount and at most a unit word', () => {
    expect(isWholeAmount(parseQuantity('2 lb'))).toBe(true);
    expect(isWholeAmount(parseQuantity('3'))).toBe(true);
    expect(isWholeAmount(parseQuantity('1 1/2 cups'))).toBe(true);
  });

  it('is false for anything carrying prose, a container or no amount', () => {
    expect(isWholeAmount(parseQuantity('1 cup, packed'))).toBe(false);
    expect(isWholeAmount(parseQuantity('2 14 oz cans'))).toBe(false);
    expect(isWholeAmount(parseQuantity('14 oz can'))).toBe(false);
    expect(isWholeAmount(parseQuantity('a bunch'))).toBe(false);
    expect(isWholeAmount(parseQuantity('x2'))).toBe(false);
  });
});

// ─── The unit vocabulary ────────────────────────────────────────────────────

describe('unitKey', () => {
  it('collapses an inflection and nothing else', () => {
    expect(unitKey('cups')).toBe('cup');
    expect(unitKey(' CUP ')).toBe('cup');
    expect(unitKey('lbs')).toBe('lb');
    // A conversion, not an inflection — unitConvert's job, on an explicit
    // setting and marked, never something a unit lookup does quietly.
    expect(unitKey('grams')).toBe('gram');
    expect(unitKey('g')).toBe('g');
  });

  it('leaves a word it doesn\'t know alone', () => {
    expect(unitKey('bulb')).toBe('bulb');
  });
});

describe('inflectUnit', () => {
  it('pluralises above one, and only above one', () => {
    expect(inflectUnit('cup', 2)).toBe('cups');
    expect(inflectUnit('cups', 1)).toBe('cup');
    expect(inflectUnit('cups', 0.5)).toBe('cup');
    expect(inflectUnit('loaf', 3)).toBe('loaves');
  });

  it('leaves a unit it can\'t inflect exactly as written', () => {
    expect(inflectUnit('bulb', 2)).toBe('bulb');
    expect(inflectUnit('kg', 2)).toBe('kg');
  });
});

describe('isSizedContainer', () => {
  it('is true for a real size word and a real container word', () => {
    expect(isSizedContainer('oz', 'can')).toBe(true);
    expect(isSizedContainer('OZ', 'CANS')).toBe(true);
  });

  it('is false when either word is not the right kind', () => {
    expect(isSizedContainer('cup', 'can')).toBe(false); // cup isn't a size unit
    expect(isSizedContainer('oz', 'flour')).toBe(false); // flour isn't a container
    expect(isSizedContainer('oz', 'oz')).toBe(false);
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
