import { groceryNameKey, parseGroceryInput, splitGroceryLines } from '../utils/groceryParse';

// ─── groceryNameKey ──────────────────────────────────────────────────────────

describe('groceryNameKey', () => {
  it('collapses case, whitespace and punctuation to one identity', () => {
    expect(groceryNameKey('Milk')).toBe('milk');
    expect(groceryNameKey('  milk  ')).toBe('milk');
    expect(groceryNameKey('MILK')).toBe('milk');
    expect(groceryNameKey('Milk,')).toBe('milk');
    expect(groceryNameKey('greek   yogurt')).toBe('greek yogurt');
  });

  it('strips diacritics so jalapeño and jalapeno are one item', () => {
    expect(groceryNameKey('jalapeño')).toBe(groceryNameKey('jalapeno'));
  });

  it('keeps digits and percent, which are part of real product names', () => {
    expect(groceryNameKey('2% Milk')).toBe('2% milk');
    expect(groceryNameKey('7Up')).toBe('7up');
  });

  it('does NOT stem plurals — that merge is permanent and nobody asked for it', () => {
    expect(groceryNameKey('chips')).not.toBe(groceryNameKey('chip'));
    expect(groceryNameKey('glasses')).not.toBe(groceryNameKey('glass'));
    expect(groceryNameKey('bananas')).not.toBe(groceryNameKey('banana'));
  });

  it('returns empty for input with no letters or digits', () => {
    expect(groceryNameKey('   ')).toBe('');
    expect(groceryNameKey('---')).toBe('');
  });
});

// ─── parseGroceryInput ───────────────────────────────────────────────────────

describe('parseGroceryInput', () => {
  it('peels a leading number + unit', () => {
    expect(parseGroceryInput('2 lb chicken thighs')).toEqual({
      name: 'chicken thighs',
      quantity: '2 lb',
    });
    expect(parseGroceryInput('1.5kg flour')).toEqual({ name: 'flour', quantity: '1.5 kg' });
    expect(parseGroceryInput('2 bottles wine')).toEqual({ name: 'wine', quantity: '2 bottles' });
  });

  it('peels a bare leading count', () => {
    expect(parseGroceryInput('3 avocados')).toEqual({ name: 'avocados', quantity: '3' });
    expect(parseGroceryInput('12 eggs')).toEqual({ name: 'eggs', quantity: '12' });
  });

  it('recognizes tbsp and tsp as units', () => {
    expect(parseGroceryInput('1 tbsp sugar')).toEqual({ name: 'sugar', quantity: '1 tbsp' });
    expect(parseGroceryInput('2 tsp vanilla extract')).toEqual({
      name: 'vanilla extract',
      quantity: '2 tsp',
    });
  });

  it('recognizes spelled-out tablespoon/teaspoon and abbreviates them', () => {
    expect(parseGroceryInput('3 tablespoons olive oil')).toEqual({
      name: 'olive oil',
      quantity: '3 tbsp',
    });
    expect(parseGroceryInput('1 tablespoon olive oil')).toEqual({
      name: 'olive oil',
      quantity: '1 tbsp',
    });
    expect(parseGroceryInput('2 teaspoons vanilla extract')).toEqual({
      name: 'vanilla extract',
      quantity: '2 tsp',
    });
    expect(parseGroceryInput('1 teaspoon salt')).toEqual({
      name: 'salt',
      quantity: '1 tsp',
    });
  });

  it('recognizes clove/cloves as a unit', () => {
    expect(parseGroceryInput('5 cloves garlic, peeled and sliced')).toEqual({
      name: 'garlic, peeled and sliced',
      quantity: '5 cloves',
    });
    expect(parseGroceryInput('1 clove garlic')).toEqual({ name: 'garlic', quantity: '1 clove' });
  });

  it('peels a bare fraction as the leading count', () => {
    expect(parseGroceryInput('1/4 cup tomato paste')).toEqual({
      name: 'tomato paste',
      quantity: '1/4 cup',
    });
    expect(parseGroceryInput('1/4 tsp red pepper flakes')).toEqual({
      name: 'red pepper flakes',
      quantity: '1/4 tsp',
    });
    expect(parseGroceryInput('1/2 avocado')).toEqual({ name: 'avocado', quantity: '1/2' });
  });

  it('peels a mixed number (whole + fraction) as the leading count', () => {
    expect(parseGroceryInput('1 1/2 cups boiling water')).toEqual({
      name: 'boiling water',
      quantity: '1 1/2 cups',
    });
    expect(parseGroceryInput('2 1/4 lb chicken thighs')).toEqual({
      name: 'chicken thighs',
      quantity: '2 1/4 lb',
    });
  });

  it('peels a trailing xN', () => {
    expect(parseGroceryInput('milk x2')).toEqual({ name: 'milk', quantity: 'x2' });
    expect(parseGroceryInput('eggs x 12')).toEqual({ name: 'eggs', quantity: 'x12' });
  });

  it('peels a trailing parenthetical', () => {
    expect(parseGroceryInput('eggs (dozen)')).toEqual({ name: 'eggs', quantity: 'dozen' });
  });

  it('leaves "2% milk" whole — the percent means the number is part of the name', () => {
    expect(parseGroceryInput('2% milk')).toEqual({ name: '2% milk', quantity: null });
  });

  it('treats an unrecognised word after a number as the start of the name', () => {
    // "2 amazing" must not become the quantity, or the catalog key loses a word.
    expect(parseGroceryInput('2 amazing tomatoes')).toEqual({
      name: 'amazing tomatoes',
      quantity: '2',
    });
  });

  it('returns a bare name unchanged when there is no quantity', () => {
    expect(parseGroceryInput('sourdough bread')).toEqual({
      name: 'sourdough bread',
      quantity: null,
    });
  });

  it('normalises internal whitespace', () => {
    expect(parseGroceryInput('  greek    yogurt ')).toEqual({
      name: 'greek yogurt',
      quantity: null,
    });
  });

  it('handles empty input', () => {
    expect(parseGroceryInput('   ')).toEqual({ name: '', quantity: null });
  });

  it('does not treat a lone number as a quantity with no item', () => {
    expect(parseGroceryInput('12')).toEqual({ name: '12', quantity: null });
  });
});

// ─── splitGroceryLines ───────────────────────────────────────────────────────

describe('splitGroceryLines', () => {
  it('splits on newlines and drops blanks', () => {
    expect(splitGroceryLines('milk\n\neggs\n  \nbread')).toEqual(['milk', 'eggs', 'bread']);
  });

  it('handles CRLF', () => {
    expect(splitGroceryLines('milk\r\neggs')).toEqual(['milk', 'eggs']);
  });

  it('strips bullet markers', () => {
    expect(splitGroceryLines('- milk\n* eggs\n• bread\n– butter')).toEqual([
      'milk',
      'eggs',
      'bread',
      'butter',
    ]);
  });

  it('strips list numbering', () => {
    expect(splitGroceryLines('1. milk\n2) eggs')).toEqual(['milk', 'eggs']);
  });

  it('strips numbering but never a quantity — the punctuation is what tells them apart', () => {
    expect(splitGroceryLines('1 lb milk')).toEqual(['1 lb milk']);
    expect(splitGroceryLines('1. milk')).toEqual(['milk']);
  });

  it('dedupes within the paste, case-insensitively', () => {
    expect(splitGroceryLines('Salt\nsugar\nsalt')).toEqual(['Salt', 'sugar']);
  });

  it('caps a runaway paste', () => {
    const many = Array.from({ length: 250 }, (_, i) => `item ${i}`).join('\n');
    expect(splitGroceryLines(many)).toHaveLength(100);
  });

  it('returns nothing for an empty paste', () => {
    expect(splitGroceryLines('\n\n  \n')).toEqual([]);
  });
});
