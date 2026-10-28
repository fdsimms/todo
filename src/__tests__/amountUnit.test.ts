import {
  COUNT_UNITS, ingredientAmountGroups, NO_UNIT, OTHER_UNIT, readAmount, VOLUME_UNITS, WEIGHT_UNITS, writeAmount,
} from '../utils/amountUnit';
import { parseQuantity } from '../utils/quantity';

const UNITS = ingredientAmountGroups().flatMap(g => g.units);

describe('readAmount', () => {
  it('reads a number and a menu unit, plural or not', () => {
    expect(readAmount('2 lb', UNITS)).toEqual({ number: '2', unit: 'lb' });
    expect(readAmount('3/4 cup', UNITS)).toEqual({ number: '3/4', unit: 'cup' });
    expect(readAmount('1 1/2 cups', UNITS)).toEqual({ number: '1 1/2', unit: 'cup' });
    expect(readAmount('2 cloves', UNITS)).toEqual({ number: '2', unit: 'clove' });
    expect(readAmount('2 fl oz', UNITS)).toEqual({ number: '2', unit: 'fl oz' });
    expect(readAmount('2-3 tbsp', UNITS)).toEqual({ number: '2-3', unit: 'tbsp' });
  });

  it('reads a bare count as no unit, and empty as nothing yet', () => {
    expect(readAmount('3', UNITS)).toEqual({ number: '3', unit: NO_UNIT });
    expect(readAmount('', UNITS)).toEqual({ number: '', unit: NO_UNIT });
  });

  it('keeps anything the menu can’t hold as written, under Something else', () => {
    for (const text of ['1 14 oz can', 'to taste', 'a pinch', '2 large', '1 cup, packed', '3 handfuls']) {
      expect(readAmount(text, UNITS)).toEqual({ number: text, unit: OTHER_UNIT });
    }
  });
});

describe('writeAmount', () => {
  it('writes the unit inflected for its amount', () => {
    expect(writeAmount('2', 'clove')).toBe('2 cloves');
    expect(writeAmount('1', 'clove')).toBe('1 clove');
    expect(writeAmount('2', 'cup')).toBe('2 cups');
    expect(writeAmount('3/4', 'cup')).toBe('3/4 cup');
    expect(writeAmount('2', 'tbsp')).toBe('2 tbsp');
    expect(writeAmount('2-3', 'clove')).toBe('2-3 cloves');
  });

  it('writes a bare number for no unit, the text for Something else, and nothing for no number', () => {
    expect(writeAmount('3', NO_UNIT)).toBe('3');
    expect(writeAmount('1 14 oz can', OTHER_UNIT)).toBe('1 14 oz can');
    expect(writeAmount('  ', 'cup')).toBe('');
  });

  it('writes what it reads, for every unit on the menu', () => {
    for (const unit of [...VOLUME_UNITS, ...WEIGHT_UNITS, ...COUNT_UNITS]) {
      for (const number of ['1', '2', '1/2']) {
        const text = writeAmount(number, unit);
        expect(readAmount(text, UNITS)).toEqual({ number, unit });
        expect(parseQuantity(text).unit).not.toBeNull();
      }
    }
  });
});

describe('readAmount: a range of a count', () => {
  it('reads "2-3" as no unit', () => {
    expect(readAmount('2-3', UNITS)).toEqual({ number: '2-3', unit: NO_UNIT });
  });
});

describe('readAmount: long spellings', () => {
  it('opens on the menu unit they mean', () => {
    expect(readAmount('2 tablespoons', UNITS)).toEqual({ number: '2', unit: 'tbsp' });
    expect(readAmount('1 teaspoon', UNITS)).toEqual({ number: '1', unit: 'tsp' });
    expect(readAmount('8 ounces', UNITS)).toEqual({ number: '8', unit: 'oz' });
    expect(readAmount('1 pound', UNITS)).toEqual({ number: '1', unit: 'lb' });
    expect(readAmount('500 grams', UNITS)).toEqual({ number: '500', unit: 'g' });
    expect(readAmount('1 litre', UNITS)).toEqual({ number: '1', unit: 'liter' });
    expect(readAmount('2 fl oz', UNITS)).toEqual({ number: '2', unit: 'fl oz' });
  });
});
