import { aisleForProductCategory, CATEGORY_AISLES } from '../utils/productCategory';
import { DEFAULT_AISLES } from '../utils/groceryAisles';

describe('aisleForProductCategory', () => {
  it('reads an Open Food Facts tag, which arrives dehyphenated and plural', () => {
    expect(aisleForProductCategory('vegan sausages')).toBe('Meat & Seafood');
    expect(aisleForProductCategory('oat milks')).toBe('Dairy & Eggs');
  });

  it('reads a FoodData Central shelf label', () => {
    expect(aisleForProductCategory('Ice Cream & Frozen Yogurt')).toBe('Frozen');
    expect(aisleForProductCategory('Breads & Buns')).toBe('Bakery');
  });

  it('reads a Go-UPC breadcrumb path', () => {
    expect(aisleForProductCategory('Food, Beverages & Tobacco > Food Items > Snack Foods'))
      .toBe('Snacks');
    expect(aisleForProductCategory('Health & Beauty > Personal Care > Shampoo'))
      .toBe('Personal Care');
  });

  it('lets a compound beat the word it contains', () => {
    expect(aisleForProductCategory('ice cream')).toBe('Frozen');
    expect(aisleForProductCategory('heavy cream')).toBe('Dairy & Eggs');
    expect(aisleForProductCategory('paper towels')).toBe('Household');
  });

  it('lets the shelf beat the food, because frozen peas are in Frozen', () => {
    expect(aisleForProductCategory('Frozen Vegetables')).toBe('Frozen');
    expect(aisleForProductCategory('Vegetables')).toBe('Produce');
  });

  it('matches whole words only', () => {
    // "barista" must not read as a bar, "boiled" must not read as oil.
    expect(aisleForProductCategory('barista editions')).toBeNull();
    expect(aisleForProductCategory('boiled')).toBeNull();
  });

  it('answers null rather than Other, leaving the caller to decide', () => {
    expect(aisleForProductCategory('en')).toBeNull();
    expect(aisleForProductCategory('')).toBeNull();
    expect(aisleForProductCategory(null)).toBeNull();
    expect(aisleForProductCategory(undefined)).toBeNull();
    expect(aisleForProductCategory('   ,,,   ')).toBeNull();
  });

  it('only ever names an aisle the app actually ships', () => {
    for (const [phrase, aisle] of CATEGORY_AISLES) {
      expect({ phrase, known: (DEFAULT_AISLES as readonly string[]).includes(aisle) })
        .toEqual({ phrase, known: true });
    }
  });
});
