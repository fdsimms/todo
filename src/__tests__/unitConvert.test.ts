import { convertQuantity, describeUnitFamily, unitFactor } from '../utils/unitConvert';

const metric = (q: string) => convertQuantity(q, 'metric').text;
const us = (q: string) => convertQuantity(q, 'us').text;

describe('convertQuantity — as written', () => {
  it('is a no-op that reports itself as one', () => {
    expect(convertQuantity('2 cups', 'asWritten')).toEqual({ text: '2 cups', converted: false });
    expect(convertQuantity('  500 g  ', 'asWritten')).toEqual({ text: '500 g', converted: false });
    expect(convertQuantity('', 'metric')).toEqual({ text: '', converted: false });
  });
});

describe('convertQuantity — to metric', () => {
  it('renders the conversions a chart would print', () => {
    expect(metric('1 tsp')).toBe('≈5 ml');
    expect(metric('1/2 tsp')).toBe('≈2.5 ml');
    expect(metric('1/4 tsp')).toBe('≈1.25 ml');
    expect(metric('1 tbsp')).toBe('≈15 ml');
    expect(metric('1/4 cup')).toBe('≈60 ml');
    expect(metric('1/3 cup')).toBe('≈80 ml');
    expect(metric('1/2 cup')).toBe('≈120 ml');
    expect(metric('1 cup')).toBe('≈240 ml');
    expect(metric('1 oz')).toBe('≈30 g');
    expect(metric('1 lb')).toBe('≈450 g');
  });

  it('steps up to kg and L past a thousand', () => {
    expect(metric('3 lbs')).toBe('≈1.36 kg');
    expect(metric('1 qt')).toBe('≈950 ml');
    expect(metric('2 quarts')).toBe('≈1.89 L');
    expect(metric('1 gallon')).toBe('≈3.79 L');
  });

  it('reads every spelling of a unit', () => {
    expect(metric('2 pounds')).toBe(metric('2 lbs'));
    expect(metric('3 teaspoons')).toBe(metric('3 tsp'));
    expect(metric('2 tablespoons')).toBe(metric('2 tbsp'));
    expect(metric('4 ounces')).toBe(metric('4 oz'));
  });

  it('reads fractions, mixed numbers and decimals', () => {
    expect(metric('1 1/2 cups')).toBe('≈350 ml');
    expect(metric('2.5 lb')).toBe('≈1.13 kg');
  });

  it('leaves what is already metric alone', () => {
    expect(convertQuantity('500 g', 'metric')).toEqual({ text: '500 g', converted: false });
    expect(convertQuantity('1 kg', 'metric')).toEqual({ text: '1 kg', converted: false });
    expect(convertQuantity('250 ml', 'metric')).toEqual({ text: '250 ml', converted: false });
  });
});

describe('convertQuantity — to US', () => {
  it('renders cooking fractions rather than decimals', () => {
    expect(us('5 ml')).toBe('≈1 tsp');
    expect(us('2.5 ml')).toBe('≈1/2 tsp');
    expect(us('15 ml')).toBe('≈1 tbsp');
    expect(us('60 ml')).toBe('≈1/4 cup');
    expect(us('80 ml')).toBe('≈1/3 cup');
    expect(us('120 ml')).toBe('≈1/2 cup');
    expect(us('250 ml')).toBe('≈1 cup');
    expect(us('500 ml')).toBe('≈2 cups');
    expect(us('100 g')).toBe('≈3 1/2 oz');
    expect(us('250 g')).toBe('≈9 oz');
    expect(us('1 kg')).toBe('≈2 1/4 lbs');
    expect(us('2 kg')).toBe('≈4 1/2 lbs');
  });

  it('steps up through cups, quarts and gallons', () => {
    expect(us('750 ml')).toBe('≈3 cups');
    expect(us('1 L')).toBe('≈1 qt');
    expect(us('2 liters')).toBe('≈2 qt');
    expect(us('4 L')).toBe('≈1 gal');
  });

  it('says a decimal rather than claim a fraction that does not fit', () => {
    // 500 g is 1.1023 lbs, and no quarter-pound is within the mass tolerance.
    expect(us('500 g')).toBe('≈1.1 lbs');
    // Thirds are a volume measure only: 1.5 kg is nearer 3 1/3 lbs, but that
    // is not a number anyone weighs to.
    expect(us('1.5 kg')).toBe('≈3 1/4 lbs');
  });

  it('falls back to tablespoons under half a cup', () => {
    // 0.42 of a cup is no fraction anyone owns a measure for.
    expect(us('100 ml')).toBe('≈7 tbsp');
    expect(us('90 ml')).toBe('≈6 tbsp');
    // At or above half a cup the tablespoon count stops being useful.
    expect(us('200 ml')).toBe('≈0.85 cup');
  });

  it('leaves what is already US alone', () => {
    expect(convertQuantity('2 cups', 'us')).toEqual({ text: '2 cups', converted: false });
    expect(convertQuantity('1 lb', 'us')).toEqual({ text: '1 lb', converted: false });
  });
});

describe('convertQuantity — what it refuses', () => {
  it('never converts a container size', () => {
    expect(convertQuantity('14 oz can', 'metric')).toEqual({ text: '14 oz can', converted: false });
    expect(convertQuantity('1 L bottle', 'us')).toEqual({ text: '1 L bottle', converted: false });
    expect(convertQuantity('2 14 oz cans', 'metric')).toEqual({ text: '2 14 oz cans', converted: false });
  });

  it('never converts a count', () => {
    for (const quantity of ['3', 'x2', '4 cloves', '2 cans', '1 dozen', '2 bunches', '1, medium']) {
      expect(convertQuantity(quantity, 'metric')).toEqual({ text: quantity, converted: false });
    }
  });

  it('never converts what it cannot parse', () => {
    for (const quantity of ['a pinch', 'to taste', '2% milk', 'some']) {
      expect(convertQuantity(quantity, 'metric')).toEqual({ text: quantity, converted: false });
    }
  });

  it('leaves a unit it does not know', () => {
    expect(convertQuantity('2 bulbs', 'metric')).toEqual({ text: '2 bulbs', converted: false });
  });
});

describe('convertQuantity — the rest of the string', () => {
  it('carries a trailing clause through verbatim', () => {
    expect(metric('1 cup, packed')).toBe('≈240 ml, packed');
    expect(metric('2 lb, trimmed and diced')).toBe('≈910 g, trimmed and diced');
  });

  it('converts each half of a merged quantity and marks the whole once', () => {
    expect(metric('1 lb · 2 cups')).toBe('≈450 g · 470 ml');
    // A part already in the target system stays as written inside the join.
    expect(metric('1 lb · 2 kg')).toBe('≈450 g · 2 kg');
    // Nothing convertible anywhere means nothing is marked.
    expect(convertQuantity('2 · 1 bunch', 'metric')).toEqual({ text: '2 · 1 bunch', converted: false });
  });
});

describe('convertQuantity — unit agreement', () => {
  it('inflects the unit it emits to match the number', () => {
    expect(us('120 ml')).toBe('≈1/2 cup');
    expect(us('480 ml')).toBe('≈2 cups');
    expect(us('460 g')).toBe('≈1 lb');
    expect(us('900 g')).toBe('≈2 lbs');
  });
});

describe('unitFactor', () => {
  it('answers how many of the second unit make one of the first', () => {
    expect(unitFactor('tbsp', 'tsp')).toBe(3);
    expect(unitFactor('cup', 'tbsp')).toBe(16);
    expect(unitFactor('lb', 'oz')).toBe(16);
    expect(unitFactor('kg', 'g')).toBe(1000);
    expect(unitFactor('l', 'ml')).toBe(1000);
  });

  it('answers the reciprocal direction too', () => {
    // Not `toBe`: a division leaves float noise (1/3 comes back as
    // 0.33333333333333337), which is the noise scaleQuantity's denominator
    // search absorbs downstream — see itemSubs' own exactness tests.
    expect(unitFactor('tsp', 'tbsp')).toBeCloseTo(1 / 3, 12);
    expect(unitFactor('tsp', 'cup')).toBeCloseTo(1 / 48, 12);
  });

  it('reads two spellings of one unit as one unit, at a factor of 1', () => {
    // What `unitKey` deliberately won't do: it collapses inflections, not
    // abbreviations, so "g" and "grams" only meet here.
    expect(unitFactor('grams', 'g')).toBe(1);
    expect(unitFactor('teaspoon', 'tsp')).toBe(1);
    expect(unitFactor('cups', 'cup')).toBe(1);
  });

  it('refuses across systems, where the answer would have to round', () => {
    expect(unitFactor('tsp', 'ml')).toBeNull();
    expect(unitFactor('oz', 'g')).toBeNull();
  });

  it('refuses across dimensions', () => {
    expect(unitFactor('cup', 'oz')).toBeNull();
  });

  it('refuses a unit off the table — a count converts to nothing', () => {
    expect(unitFactor('clove', 'tsp')).toBeNull();
    expect(unitFactor('tsp', 'clove')).toBeNull();
    expect(unitFactor('can', 'bunch')).toBeNull();
  });
});

describe('describeUnitFamily', () => {
  it('names the family a unit converts inside of', () => {
    expect(describeUnitFamily('tsp')).toBe('volume, like tsp, tbsp or cups');
    expect(describeUnitFamily('cups')).toBe('volume, like tsp, tbsp or cups');
    expect(describeUnitFamily('ml')).toBe('volume, like ml or L');
    expect(describeUnitFamily('lb')).toBe('weight, like oz or lbs');
    expect(describeUnitFamily('kg')).toBe('weight, like g or kg');
  });

  it('is silent for a unit that converts to nothing', () => {
    expect(describeUnitFamily('clove')).toBeNull();
    expect(describeUnitFamily('bunch')).toBeNull();
    expect(describeUnitFamily('')).toBeNull();
  });
});
