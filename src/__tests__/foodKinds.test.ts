import {
  describeFoodKinds,
  foodKindsOf,
  guessFoodKinds,
  normalizeFoodKinds,
  parseFoodKinds,
  serializeFoodKinds,
} from '../utils/foodKinds';

describe('guessFoodKinds', () => {
  it.each([
    ['rice', ['grain']],
    ['penne pasta', ['grain']],
    ['potatoes', ['grain']],
    ['sweet potato', ['vegetable']],
    ['frozen peas', ['vegetable']],
    ['baby spinach', ['vegetable']],
    ['string beans', ['vegetable']],
    ['bell pepper', ['vegetable']],
    ['black beans', ['legume', 'protein']],
    ['roasted edamame', ['legume', 'protein']],
    ['vegan popcorn chicken', ['protein']],
    ['Just Egg', ['protein']],
    ['goat cheese', ['dairy']],
    ['greek yogurt', ['dairy']],
    ['pine nuts', ['nuts']],
    ['peanut butter', ['nuts']],
    ['vegan fish sauce', ['sauce']],
    ['Sriracha', ['sauce']],
    ['fresh basil', ['herb']],
  ])('reads %s by its head noun', (name, kinds) => {
    expect(guessFoodKinds(name)).toEqual(kinds);
  });

  it('falls back to the first word it knows when the head is unknown', () => {
    expect(guessFoodKinds('Cashews Dill Pickle Flavored')).toEqual(['nuts']);
  });

  it.each([
    'oat milk', 'chicken stock', 'protein powder', 'tortilla chips', 'olive oil',
    'apple cider vinegar', 'unsalted butter', 'Ice cream',
  ])('refuses %s, a form rather than a food', name => {
    expect(guessFoodKinds(name)).toEqual([]);
  });

  it.each(['black pepper', 'garlic', 'salt', 'CR2 lithium batteries', 'jelly beans', ''])(
    'says nothing about %s',
    name => {
      expect(guessFoodKinds(name)).toEqual([]);
    },
  );
});

describe('foodKindsOf', () => {
  it('goes by the name when the item was never filed', () => {
    expect(foodKindsOf({ name: 'rice' })).toEqual(['grain']);
  });

  it('takes the person’s filing over the guess', () => {
    expect(foodKindsOf({ name: 'tofurky', foodKinds: ['protein', 'legume'] })).toEqual(['protein', 'legume']);
  });

  it('keeps an empty filing as an answer, so a wrong guess can be turned off', () => {
    expect(foodKindsOf({ name: 'rice', foodKinds: [] })).toEqual([]);
  });
});

describe('the stored column', () => {
  it('reads NULL and junk as never filed', () => {
    expect(parseFoodKinds(null)).toBeUndefined();
    expect(parseFoodKinds('')).toBeUndefined();
    expect(parseFoodKinds('{nope')).toBeUndefined();
    expect(parseFoodKinds('"grain"')).toBeUndefined();
  });

  it('keeps a stored empty list, and drops unknown kinds into canonical order', () => {
    expect(parseFoodKinds('[]')).toEqual([]);
    expect(parseFoodKinds('["herb","snack","grain","grain"]')).toEqual(['grain', 'herb']);
  });

  it('round-trips through serializeFoodKinds', () => {
    expect(serializeFoodKinds(undefined)).toBeNull();
    expect(parseFoodKinds(serializeFoodKinds([]))).toEqual([]);
    expect(parseFoodKinds(serializeFoodKinds(['sauce', 'protein']))).toEqual(['protein', 'sauce']);
  });

  it('normalizes a list from anywhere', () => {
    expect(normalizeFoodKinds(['nuts', 7, 'grain'])).toEqual(['grain', 'nuts']);
  });
});

describe('describeFoodKinds', () => {
  it('joins the labels, or says nothing for none', () => {
    expect(describeFoodKinds(['protein', 'legume'])).toBe('Protein, Beans & lentils');
    expect(describeFoodKinds([])).toBeNull();
  });
});
