import {
  catalogSpellingOf,
  cleanModelItemType,
  itemTypeFromCategory,
  itemTypeMoveFor,
} from '../utils/scanItemType';

describe('itemTypeFromCategory', () => {
  it('names the item from a plural category and singularizes a mass noun', () => {
    expect(itemTypeFromCategory('ice creams')).toBe('Ice cream');
    expect(itemTypeFromCategory('cheeses')).toBe('Cheese');
  });

  it('drops the packaging a category names after the food', () => {
    expect(itemTypeFromCategory('ice cream tubs')).toBe('Ice cream');
    expect(itemTypeFromCategory('bottled water')).toBe('Bottled water');
  });

  it('leaves a plural that is the everyday name alone', () => {
    expect(itemTypeFromCategory('potato chips')).toBe('Potato chips');
    expect(itemTypeFromCategory('noodles')).toBe('Noodles');
  });

  it('takes the most specific level of a hierarchy', () => {
    expect(itemTypeFromCategory('Food Items > Frozen Foods > Ice Cream')).toBe('Ice cream');
  });

  it('refuses a department, because it names a hundred different things', () => {
    expect(itemTypeFromCategory('snacks')).toBeNull();
    expect(itemTypeFromCategory('plant based foods')).toBeNull();
    expect(itemTypeFromCategory('frozen desserts')).toBeNull();
    expect(itemTypeFromCategory('beverages')).toBeNull();
  });

  it('refuses a list of several things', () => {
    expect(itemTypeFromCategory('Chips, Pretzels & Snacks')).toBeNull();
    expect(itemTypeFromCategory('ice creams and sorbets')).toBeNull();
    expect(itemTypeFromCategory('Ice Cream/Ice Cream Novelties')).toBeNull();
  });

  it('refuses what is not a short noun phrase', () => {
    expect(itemTypeFromCategory(null)).toBeNull();
    expect(itemTypeFromCategory('')).toBeNull();
    expect(itemTypeFromCategory('   ')).toBeNull();
    expect(itemTypeFromCategory('one two three four')).toBeNull();
    expect(itemTypeFromCategory('tubs')).toBeNull();
    expect(itemTypeFromCategory('12 pack sodas')).toBeNull();
  });
});

describe('cleanModelItemType', () => {
  it('reduces a reply to a sentence-case name', () => {
    expect(cleanModelItemType('ice cream', "Jeni's")).toBe('Ice cream');
    expect(cleanModelItemType('  "Oat Milk".  ', null)).toBe('Oat milk');
  });

  it('refuses a reply that is not a short noun phrase', () => {
    expect(cleanModelItemType(undefined, null)).toBeNull();
    expect(cleanModelItemType('', null)).toBeNull();
    expect(cleanModelItemType('this looks like ice cream to me', null)).toBeNull();
    expect(cleanModelItemType('ice cream, probably', null)).toBeNull();
    expect(cleanModelItemType('2% milk', null)).toBeNull();
  });

  it('refuses the brand, which is the mistake a small model makes most', () => {
    expect(cleanModelItemType("Jeni's", "Jeni's")).toBeNull();
    expect(cleanModelItemType('jeni’s', null)).toBe('Jeni’s');
  });
});

describe('catalogSpellingOf', () => {
  it('uses the spelling the catalog already has, so the type lands on that row', () => {
    expect(catalogSpellingOf('Ice cream', ['Milk', 'Ice Cream'])).toBe('Ice Cream');
  });

  it('ignores case', () => {
    expect(catalogSpellingOf('oat milk', ['Oat Milk'])).toBe('Oat Milk');
  });

  it('keeps the suggestion when the catalog has no such item', () => {
    expect(catalogSpellingOf('Ice cream', ['Milk'])).toBe('Ice cream');
  });
});

describe('itemTypeMoveFor', () => {
  const tiramisu = {
    gtin: '00850060644375',
    label: 'Black Tie Tiramisu',
    brand: "Jeni's Ice Cream",
    name: 'Black Tie Tiramisu',
  };

  it('moves the product words into the flavor and names the row after the type', () => {
    expect(itemTypeMoveFor(tiramisu, 'Ice cream')).toEqual({
      name: 'Ice cream',
      variant: 'Black Tie Tiramisu',
    });
  });

  it('is not offered when the product words already contain the type', () => {
    const row = { ...tiramisu, label: 'Organic Oat Milk Barista', brand: null, name: 'Organic Oat Milk Barista' };
    expect(itemTypeMoveFor(row, 'Oat milk')).toBeNull();
  });

  it('is not offered when the name already says what it is', () => {
    const row = { ...tiramisu, label: 'Whole Milk', brand: null, name: 'Whole Milk' };
    expect(itemTypeMoveFor(row, 'Milk')).toBeNull();
    expect(itemTypeMoveFor({ ...row, name: 'Eggs', label: 'Large Eggs' }, 'Egg')).toBeNull();
  });

  it('is not offered once the name or flavor has been touched', () => {
    expect(itemTypeMoveFor({ ...tiramisu, name: 'Tiramisu pint' }, 'Ice cream')).toBeNull();
    expect(itemTypeMoveFor({ ...tiramisu, variantEdit: '' }, 'Ice cream')).toBeNull();
  });

  it('is not offered for a typed row, a code that found nothing, or no suggestion', () => {
    expect(itemTypeMoveFor({ ...tiramisu, gtin: null }, 'Ice cream')).toBeNull();
    expect(itemTypeMoveFor({ ...tiramisu, label: '', name: '' }, 'Ice cream')).toBeNull();
    expect(itemTypeMoveFor(tiramisu, null)).toBeNull();
    expect(itemTypeMoveFor(tiramisu, '  ')).toBeNull();
  });
});
