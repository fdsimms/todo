import {
  groceryNameKey,
  parseGroceryInput,
  splitPrep,
  suggestShorterCatalogName,
  resolveGroceryTokens,
  splitGroceryLines,
} from '../utils/groceryParse';

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

  it('strips a leading "of" after a container unit match', () => {
    expect(parseGroceryInput('2 boxes of cereal')).toEqual({
      name: 'cereal',
      quantity: '2 boxes',
    });
    expect(parseGroceryInput('1 jar of salsa')).toEqual({ name: 'salsa', quantity: '1 jar' });
    expect(parseGroceryInput('3 cans of black beans')).toEqual({
      name: 'black beans',
      quantity: '3 cans',
    });
    // No trailing content after "of" — nothing to strip, so it stays part of
    // the name rather than emptying it.
    expect(parseGroceryInput('2 boxes of')).toEqual({ name: 'of', quantity: '2 boxes' });
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

  it('recognizes "N SIZE-UNIT container" as a compound quantity', () => {
    expect(parseGroceryInput('2 14 oz cans black beans, drained and rinsed')).toEqual({
      name: 'black beans, drained and rinsed',
      quantity: '2 14 oz cans',
    });
    expect(parseGroceryInput('2 (14.5 oz) cans diced tomatoes')).toEqual({
      name: 'diced tomatoes',
      quantity: '2 14.5 oz cans',
    });
    expect(parseGroceryInput('2 14-ounce cans black beans')).toEqual({
      name: 'black beans',
      quantity: '2 14 ounce cans',
    });
    // No leading multiplier — a single can, sized.
    expect(parseGroceryInput('14 oz can black beans')).toEqual({
      name: 'black beans',
      quantity: '14 oz can',
    });
  });

  it('does not misfire the container pattern on an ordinary unit + name', () => {
    // "lb" is a size unit but "chicken" isn't a container word, so this must
    // fall through to the plain leading-quantity match untouched.
    expect(parseGroceryInput('2 lb chicken thighs')).toEqual({
      name: 'chicken thighs',
      quantity: '2 lb',
    });
    expect(parseGroceryInput('2 bottles wine')).toEqual({ name: 'wine', quantity: '2 bottles' });
    expect(parseGroceryInput('1 can black beans')).toEqual({
      name: 'black beans',
      quantity: '1 can',
    });
  });

  it('recognizes clove/cloves as a unit', () => {
    expect(parseGroceryInput('5 cloves garlic, peeled and sliced')).toEqual({
      name: 'garlic, peeled and sliced',
      quantity: '5 cloves',
    });
    expect(parseGroceryInput('1 clove garlic')).toEqual({ name: 'garlic', quantity: '1 clove' });
  });

  it('recognizes slice/slices and link/links as units', () => {
    expect(parseGroceryInput('2 slices bread')).toEqual({
      name: 'bread',
      quantity: '2 slices',
    });
    expect(parseGroceryInput('1 slice cheese')).toEqual({ name: 'cheese', quantity: '1 slice' });
    expect(parseGroceryInput('4 links sausage')).toEqual({
      name: 'sausage',
      quantity: '4 links',
    });
    expect(parseGroceryInput('1 link sausage')).toEqual({ name: 'sausage', quantity: '1 link' });
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

// ─── splitPrep ───────────────────────────────────────────────────────────────

describe('splitPrep', () => {
  it('splits a trailing comma clause into prep', () => {
    expect(splitPrep('garlic, peeled and sliced')).toEqual({
      name: 'garlic',
      prep: 'peeled and sliced',
    });
  });

  it('leaves a name with no comma untouched', () => {
    expect(splitPrep('garlic')).toEqual({ name: 'garlic', prep: null });
  });
});

// ─── suggestShorterCatalogName ────────────────────────────────────────────────

describe('suggestShorterCatalogName', () => {
  it('offers the catalog name when dropping the leading word matches it', () => {
    const catalog = new Set(['garlic']);
    expect(suggestShorterCatalogName('cloves garlic', catalog)).toBe('garlic');
    expect(suggestShorterCatalogName('sprigs thyme', new Set(['thyme']))).toBe('thyme');
  });

  it('is null when the full name already matches the catalog', () => {
    expect(suggestShorterCatalogName('garlic', new Set(['garlic']))).toBeNull();
  });

  it('is null when the shortened name is not in the catalog either', () => {
    expect(suggestShorterCatalogName('cloves garlic', new Set(['onions']))).toBeNull();
  });

  it('is null for a one-word name — nothing to drop', () => {
    expect(suggestShorterCatalogName('garlic', new Set())).toBeNull();
  });

  it('only tries dropping the first word, not chaining further', () => {
    // "of garlic" isn't in the catalog either, so this must not keep
    // stripping down to "garlic" — one confirmed hit or nothing.
    expect(suggestShorterCatalogName('a bunch of garlic', new Set(['garlic']))).toBeNull();
  });

  it('is null for an empty name', () => {
    expect(suggestShorterCatalogName('', new Set(['garlic']))).toBeNull();
  });
});

// ─── resolveGroceryTokens ────────────────────────────────────────────────────

describe('resolveGroceryTokens', () => {
  const noneRejected = { quantity: null, prep: null };

  it('accepts both the quantity and the prep clause by default', () => {
    expect(resolveGroceryTokens('1 tsp ginger, minced', noneRejected)).toEqual({
      quantity: '1 tsp',
      quantityAccepted: true,
      prep: 'minced',
      prepAccepted: true,
      name: 'ginger',
    });
  });

  it('keeps the quantity in the name once its exact value is rejected', () => {
    const result = resolveGroceryTokens('1 tsp ginger, minced', { quantity: '1 tsp', prep: null });
    expect(result.quantityAccepted).toBe(false);
    expect(result.prepAccepted).toBe(true);
    expect(result.quantity).toBe('1 tsp');
    expect(result.name).toBe('1 tsp ginger');
  });

  it('keeps the prep clause in the name once its exact value is rejected', () => {
    const result = resolveGroceryTokens('1 tsp ginger, minced', { quantity: null, prep: 'minced' });
    expect(result.quantityAccepted).toBe(true);
    expect(result.prepAccepted).toBe(false);
    expect(result.name).toBe('ginger, minced');
  });

  it('re-offers a token once continued typing changes its value', () => {
    // Rejected "1 tsp" specifically; typing on to "1 tbsp" is a new candidate.
    const result = resolveGroceryTokens('1 tbsp ginger', { quantity: '1 tsp', prep: null });
    expect(result.quantityAccepted).toBe(true);
    expect(result.quantity).toBe('1 tbsp');
  });

  it('leaves everything in the name when nothing was recognized', () => {
    expect(resolveGroceryTokens('ginger', noneRejected)).toEqual({
      quantity: null,
      quantityAccepted: false,
      prep: null,
      prepAccepted: false,
      name: 'ginger',
    });
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
