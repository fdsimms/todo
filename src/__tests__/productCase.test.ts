import { readableItemName, readableProductCase } from '../utils/productCase';

describe('readableProductCase', () => {
  it('title-cases a name that is all capitals', () => {
    expect(readableProductCase('MILK CHOCOLATE PEANUT BUTTER CUPS')).toBe('Milk Chocolate Peanut Butter Cups');
  });

  it('keeps an apostrophe from starting a word', () => {
    expect(readableProductCase("JUSTIN'S")).toBe("Justin's");
    expect(readableProductCase("M&M'S")).toBe("M&M's");
  });

  it('leaves small words lowercase except at the start', () => {
    expect(readableProductCase('MAC AND CHEESE')).toBe('Mac and Cheese');
    expect(readableProductCase('THE BEST OF')).toBe('The Best of');
  });

  it('capitalizes after a hyphen or slash and keeps digits', () => {
    expect(readableProductCase('2% REDUCED-FAT MILK')).toBe('2% Reduced-Fat Milk');
  });

  it('leaves mixed case alone', () => {
    expect(readableProductCase("Ben & Jerry's")).toBe("Ben & Jerry's");
    expect(readableProductCase('McCormick')).toBe('McCormick');
  });

  it('leaves a string with no letters alone', () => {
    expect(readableProductCase('7-11')).toBe('7-11');
    expect(readableProductCase('')).toBe('');
  });
});

describe('readableItemName', () => {
  it('title-cases a long or multi-word all-caps name', () => {
    expect(readableItemName('MILK CHOCOLATE PEANUT BUTTER CUPS')).toBe('Milk Chocolate Peanut Butter Cups');
    expect(readableItemName('CHEETOS')).toBe('Cheetos');
    expect(readableItemName('BAKING SODA')).toBe('Baking Soda');
  });

  it('leaves a short single word that could be an acronym', () => {
    expect(readableItemName('MSG')).toBe('MSG');
    expect(readableItemName('TUMS')).toBe('TUMS');
  });

  it('leaves mixed case alone', () => {
    expect(readableItemName('oat milk')).toBe('oat milk');
    expect(readableItemName('Just Egg')).toBe('Just Egg');
  });
});
