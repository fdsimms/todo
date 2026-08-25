import {
  groceryNameKey,
  parseGroceryInput,
  splitPrep,
  splitPurpose,
  splitAlternativeNames,
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

  it('recognizes newly added cooking units', () => {
    expect(parseGroceryInput('2 sprigs rosemary')).toEqual({
      name: 'rosemary',
      quantity: '2 sprigs',
    });
    expect(parseGroceryInput('3 stalks celery')).toEqual({
      name: 'celery',
      quantity: '3 stalks',
    });
    expect(parseGroceryInput('2 ribs celery')).toEqual({ name: 'celery', quantity: '2 ribs' });
    expect(parseGroceryInput('4 stems thyme')).toEqual({ name: 'thyme', quantity: '4 stems' });
    expect(parseGroceryInput('1 stick butter')).toEqual({ name: 'butter', quantity: '1 stick' });
    expect(parseGroceryInput('2 sheets phyllo dough')).toEqual({
      name: 'phyllo dough',
      quantity: '2 sheets',
    });
    expect(parseGroceryInput('2 fillets salmon')).toEqual({
      name: 'salmon',
      quantity: '2 fillets',
    });
    expect(parseGroceryInput('3 pieces ginger')).toEqual({
      name: 'ginger',
      quantity: '3 pieces',
    });
    expect(parseGroceryInput('2 ears corn')).toEqual({ name: 'corn', quantity: '2 ears' });
    expect(parseGroceryInput('4 wedges lime')).toEqual({ name: 'lime', quantity: '4 wedges' });
    expect(parseGroceryInput('2 strips bacon')).toEqual({ name: 'bacon', quantity: '2 strips' });
    expect(parseGroceryInput('1 pinch salt')).toEqual({ name: 'salt', quantity: '1 pinch' });
    expect(parseGroceryInput('1 dash hot sauce')).toEqual({
      name: 'hot sauce',
      quantity: '1 dash',
    });
    expect(parseGroceryInput('2 handfuls spinach')).toEqual({
      name: 'spinach',
      quantity: '2 handfuls',
    });
    expect(parseGroceryInput('1 package tortillas')).toEqual({
      name: 'tortillas',
      quantity: '1 package',
    });
    expect(parseGroceryInput('2 pouches soup mix')).toEqual({
      name: 'soup mix',
      quantity: '2 pouches',
    });
    expect(parseGroceryInput('2 dl heavy cream')).toEqual({
      name: 'heavy cream',
      quantity: '2 dl',
    });
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

  it('extracts a leading size word into the quantity', () => {
    expect(parseGroceryInput('1 medium onion')).toEqual({
      name: 'onion',
      quantity: '1, medium',
    });
    expect(parseGroceryInput('2 large eggs')).toEqual({
      name: 'eggs',
      quantity: '2, large',
    });
  });

  it('leaves a size word alone when it is not right after the quantity', () => {
    expect(parseGroceryInput('mixed greens with large tomatoes')).toEqual({
      name: 'mixed greens with large tomatoes',
      quantity: null,
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

  it('splits a whitelisted leading prep word', () => {
    expect(splitPrep('Minced garlic')).toEqual({ name: 'garlic', prep: 'minced' });
    expect(splitPrep('chopped onion')).toEqual({ name: 'onion', prep: 'chopped' });
    expect(splitPrep('diced tomatoes')).toEqual({ name: 'tomatoes', prep: 'diced' });
    expect(splitPrep('crushed red pepper')).toEqual({ name: 'red pepper', prep: 'crushed' });
    expect(splitPrep('grated cheddar')).toEqual({ name: 'cheddar', prep: 'grated' });
  });

  it('does not split "sliced" — excluded because it has a standalone-product reading', () => {
    expect(splitPrep('Sliced almonds')).toEqual({ name: 'Sliced almonds', prep: null });
  });

  it('does not split "ground" — excluded because it has a standalone-product reading', () => {
    expect(splitPrep('ground beef')).toEqual({ name: 'ground beef', prep: null });
  });

  it('leaves a leading word not on the whitelist untouched', () => {
    expect(splitPrep('fresh basil')).toEqual({ name: 'fresh basil', prep: null });
  });

  it('does not split a whitelisted word with nothing following it', () => {
    expect(splitPrep('Minced')).toEqual({ name: 'Minced', prep: null });
  });

  it('stands down for a comma list of alternatives, so the split stays reachable', () => {
    expect(splitPrep('chicken, beef, or lamb')).toEqual({
      name: 'chicken, beef, or lamb',
      prep: null,
    });
  });

  it('still takes the comma when the clause is prep, "or" and all', () => {
    expect(splitPrep('black beans, drained and rinsed, or canned')).toEqual({
      name: 'black beans',
      prep: 'drained and rinsed, or canned',
    });
    expect(splitPrep('onion, red or white')).toEqual({
      name: 'onion',
      prep: 'red or white',
    });
  });

  // A leading quantity/unit is already gone by the time splitPrep runs (see
  // makeIngredient), so a trailing parenthetical left in what's handed to it
  // can only be describing what to do to the item — "8 oz tempeh (steamed 10
  // min)" reaches here as just "tempeh (steamed 10 min)".
  it('splits a trailing parenthetical left after the quantity into prep', () => {
    expect(splitPrep('tempeh (steamed 10 min)')).toEqual({
      name: 'tempeh',
      prep: 'steamed 10 min',
    });
  });

  it('prefers the comma clause over a parenthetical when both are present', () => {
    expect(splitPrep('tempeh, pressed (steamed 10 min)')).toEqual({
      name: 'tempeh',
      prep: 'pressed (steamed 10 min)',
    });
  });
});

// ─── splitPurpose ────────────────────────────────────────────────────────────

describe('splitPurpose', () => {
  it('splits a trailing "for" clause into purpose', () => {
    expect(splitPurpose('Limes for margaritas')).toEqual({
      name: 'Limes',
      purpose: 'margaritas',
    });
  });

  it('splits "flour for dusting" — a real purpose clause even though it names a use, not a prep', () => {
    expect(splitPurpose('flour for dusting')).toEqual({
      name: 'flour',
      purpose: 'dusting',
    });
  });

  it('splits a multi-word purpose', () => {
    expect(splitPurpose('cheddar for the kids lunches')).toEqual({
      name: 'cheddar',
      purpose: 'the kids lunches',
    });
  });

  it('leaves a name with no "for" untouched', () => {
    expect(splitPurpose('garlic')).toEqual({ name: 'garlic', purpose: null });
  });

  it('does not split "for" glued inside a word — only a standalone word counts', () => {
    expect(splitPurpose('before dinner mints')).toEqual({ name: 'before dinner mints', purpose: null });
    expect(splitPurpose('comfort food')).toEqual({ name: 'comfort food', purpose: null });
    expect(splitPurpose('fortune cookies')).toEqual({ name: 'fortune cookies', purpose: null });
  });

  it('splits at the last "for" when there are two, reading as the more specific purpose', () => {
    expect(splitPurpose('chicken stock for soup for tonight')).toEqual({
      name: 'chicken stock for soup',
      purpose: 'tonight',
    });
  });

  it('refuses to empty the name out — "for" right at the start is not a split point', () => {
    expect(splitPurpose('for margaritas')).toEqual({ name: 'for margaritas', purpose: null });
  });

  it('does not split when nothing follows "for"', () => {
    expect(splitPurpose('limes for')).toEqual({ name: 'limes for', purpose: null });
    expect(splitPurpose('limes for  ')).toEqual({ name: 'limes for', purpose: null });
  });

  it('is case-insensitive on the connective word', () => {
    expect(splitPurpose('Limes For Margaritas')).toEqual({ name: 'Limes', purpose: 'Margaritas' });
  });

  it('trims surrounding whitespace before matching', () => {
    expect(splitPurpose('  Limes for margaritas  ')).toEqual({ name: 'Limes', purpose: 'margaritas' });
  });

  it('clamps a very long purpose clause to PREP_MAX_LENGTH', () => {
    const longPurpose = 'a'.repeat(120);
    const result = splitPurpose(`salt for ${longPurpose}`);
    expect(result.name).toBe('salt');
    expect(result.purpose!.length).toBe(60);
  });

  it('leaves an empty string untouched', () => {
    expect(splitPurpose('')).toEqual({ name: '', purpose: null });
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
  const noneRejected = { quantity: null, prep: null, purpose: null };

  it('accepts both the quantity and the prep clause by default', () => {
    expect(resolveGroceryTokens('1 tsp ginger, minced', noneRejected)).toEqual({
      quantity: '1 tsp',
      quantityAccepted: true,
      prep: 'minced',
      prepAccepted: true,
      purpose: null,
      purposeAccepted: false,
      note: 'minced',
      name: 'ginger',
    });
  });

  it('keeps the quantity in the name once its exact value is rejected', () => {
    const result = resolveGroceryTokens('1 tsp ginger, minced', { quantity: '1 tsp', prep: null, purpose: null });
    expect(result.quantityAccepted).toBe(false);
    expect(result.prepAccepted).toBe(true);
    expect(result.quantity).toBe('1 tsp');
    expect(result.name).toBe('1 tsp ginger');
  });

  it('keeps the prep clause in the name once its exact value is rejected', () => {
    const result = resolveGroceryTokens('1 tsp ginger, minced', { quantity: null, prep: 'minced', purpose: null });
    expect(result.quantityAccepted).toBe(true);
    expect(result.prepAccepted).toBe(false);
    expect(result.name).toBe('ginger, minced');
  });

  it('re-offers a token once continued typing changes its value', () => {
    // Rejected "1 tsp" specifically; typing on to "1 tbsp" is a new candidate.
    const result = resolveGroceryTokens('1 tbsp ginger', { quantity: '1 tsp', prep: null, purpose: null });
    expect(result.quantityAccepted).toBe(true);
    expect(result.quantity).toBe('1 tbsp');
  });

  it('leaves everything in the name when nothing was recognized', () => {
    expect(resolveGroceryTokens('ginger', noneRejected)).toEqual({
      quantity: null,
      quantityAccepted: false,
      prep: null,
      prepAccepted: false,
      purpose: null,
      purposeAccepted: false,
      note: null,
      name: 'ginger',
    });
  });

  it('takes a trailing "for" clause as the row\'s note, out of the shelf label', () => {
    const result = resolveGroceryTokens('limes for margs', noneRejected);
    expect(result.name).toBe('limes');
    expect(result.purpose).toBe('margs');
    expect(result.purposeAccepted).toBe(true);
    // Kept with its "for" — the word is what makes it a purpose.
    expect(result.note).toBe('for margs');
  });

  it('reads the purpose off what is left after the quantity', () => {
    const result = resolveGroceryTokens('2 limes for margs', noneRejected);
    expect(result.quantity).toBe('2');
    expect(result.name).toBe('limes');
    expect(result.note).toBe('for margs');
  });

  it('keeps the clause in the name once its exact value is rejected', () => {
    const result = resolveGroceryTokens('limes for margs', {
      quantity: null, prep: null, purpose: 'margs',
    });
    expect(result.purposeAccepted).toBe(false);
    expect(result.name).toBe('limes for margs');
    expect(result.note).toBeNull();
  });

  it('never reads a purpose out of a comma clause it already took', () => {
    // "plus more for topping" is one prep note, not a name plus a purpose —
    // same ordering makeIngredient uses.
    const result = resolveGroceryTokens('cheese, plus more for topping', noneRejected);
    expect(result.name).toBe('cheese');
    expect(result.prep).toBe('plus more for topping');
    expect(result.purposeAccepted).toBe(false);
    expect(result.note).toBe('plus more for topping');
  });

  it('reads the purpose again once the comma clause is rejected', () => {
    const result = resolveGroceryTokens('limes, halved for margs', {
      quantity: null, prep: 'halved for margs', purpose: null,
    });
    expect(result.prepAccepted).toBe(false);
    expect(result.name).toBe('limes, halved');
    expect(result.note).toBe('for margs');
  });

  it('leaves a name that merely contains the letters "for" alone', () => {
    expect(resolveGroceryTokens('comfort food', noneRejected).name).toBe('comfort food');
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

describe('splitAlternativeNames', () => {
  it('splits a genuine either/or', () => {
    expect(splitAlternativeNames('cheddar or manchego')).toEqual(['cheddar', 'manchego']);
    expect(splitAlternativeNames('Serrano or Jalapeño')).toEqual(['Serrano', 'Jalapeño']);
    expect(splitAlternativeNames('a or b or c')).toEqual(['a', 'b', 'c']);
  });

  it('is case-insensitive and tolerates extra spacing', () => {
    expect(splitAlternativeNames('cheddar OR manchego')).toEqual(['cheddar', 'manchego']);
    expect(splitAlternativeNames('cheddar   or   manchego')).toEqual(['cheddar', 'manchego']);
  });

  it('only matches "or" as a whole word', () => {
    expect(splitAlternativeNames('oregano')).toBeNull();
    expect(splitAlternativeNames('orange juice')).toBeNull();
    expect(splitAlternativeNames('cornstarch')).toBeNull();
  });

  it('declines a hedge about quantity', () => {
    expect(splitAlternativeNames('salt or more to taste')).toBeNull();
    expect(splitAlternativeNames('1 cup or so')).toBeNull();
    expect(splitAlternativeNames('butter or as needed')).toBeNull();
    expect(splitAlternativeNames('bake or until golden')).toBeNull();
  });

  it('declines anything that isn’t two real names', () => {
    expect(splitAlternativeNames('')).toBeNull();
    expect(splitAlternativeNames('garlic')).toBeNull();
    expect(splitAlternativeNames('or garlic')).toBeNull();
    expect(splitAlternativeNames('garlic or')).toBeNull();
    expect(splitAlternativeNames('garlic or 2')).toBeNull();
    // Two spellings of one thing are not a choice.
    expect(splitAlternativeNames('Garlic or garlic')).toBeNull();
    // Past a few parts it's prose, not an either/or.
    expect(splitAlternativeNames('a or b or c or d or e')).toBeNull();
  });

  it('splits verbatim rather than guessing at a shared noun', () => {
    // The user fixes this one in the sheet — see the note on the function for
    // why "butter or olive oil" makes distributing the trailing word unsafe.
    expect(splitAlternativeNames('chicken or vegetable stock')).toEqual(['chicken', 'vegetable stock']);
    expect(splitAlternativeNames('butter or olive oil')).toEqual(['butter', 'olive oil']);
  });

  it('reads a comma list as options when the Oxford comma is there', () => {
    expect(splitAlternativeNames('serrano, jalapeño, or habanero'))
      .toEqual(['serrano', 'jalapeño', 'habanero']);
    expect(splitAlternativeNames('limes, lemons, or grapefruit'))
      .toEqual(['limes', 'lemons', 'grapefruit']);
  });

  it('leaves commas alone without the Oxford comma, since they read as prep', () => {
    // One onion with a note about which kind, not three things to choose from.
    expect(splitAlternativeNames('onion, red or white')).toEqual(['onion, red', 'white']);
    // Without the ", or" there is nothing to tell a list from a prep clause.
    expect(splitAlternativeNames('limes, lemons or grapefruit'))
      .toEqual(['limes, lemons', 'grapefruit']);
  });

  it('declines a comma list whose parts are prep, not options', () => {
    expect(splitAlternativeNames('black beans, drained and rinsed, or canned')).toBeNull();
    expect(splitAlternativeNames('butter, melted, or margarine')).toBeNull();
  });

  it('still applies its other refusals to a comma list', () => {
    expect(splitAlternativeNames('a, b, c, d, or e')).toBeNull();
    expect(splitAlternativeNames('garlic, Garlic, or garlic')).toBeNull();
  });
});
