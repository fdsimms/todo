import { moveCategory, alphabeticalCategories } from '../utils/categoryOrder';

describe('moveCategory', () => {
  const order = ['Work', 'Home', 'Health'];

  it('moves a category up', () => {
    expect(moveCategory(order, 'Home', -1)).toEqual(['Home', 'Work', 'Health']);
  });

  it('moves a category down', () => {
    expect(moveCategory(order, 'Work', 1)).toEqual(['Home', 'Work', 'Health']);
  });

  it('returns the original array at the top edge', () => {
    expect(moveCategory(order, 'Work', -1)).toBe(order);
  });

  it('returns the original array at the bottom edge', () => {
    expect(moveCategory(order, 'Health', 1)).toBe(order);
  });

  it('returns the original array for a name that is not in the order', () => {
    expect(moveCategory(order, 'Errands', -1)).toBe(order);
  });

  it('does not mutate the input', () => {
    moveCategory(order, 'Home', -1);
    expect(order).toEqual(['Work', 'Home', 'Health']);
  });
});

describe('alphabeticalCategories', () => {
  it('sorts case-insensitively', () => {
    expect(alphabeticalCategories(['work', 'Health', 'home'])).toEqual(['Health', 'home', 'work']);
  });

  it('does not mutate the input', () => {
    const order = ['Work', 'Health'];
    alphabeticalCategories(order);
    expect(order).toEqual(['Work', 'Health']);
  });

  it('leaves an already-sorted list alone', () => {
    expect(alphabeticalCategories(['Health', 'Home', 'Work'])).toEqual(['Health', 'Home', 'Work']);
  });
});
