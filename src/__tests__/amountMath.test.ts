import { appendOperator, resolveAmountMath } from '../utils/amountMath';
import { composeFoodAmount } from '../utils/foodLog';
import { parseWeightText } from '../utils/cookware';

describe('resolveAmountMath', () => {
  it('subtracts a weighed core from a weighed apple', () => {
    expect(resolveAmountMath('120 - 50')).toBe('70');
    expect(resolveAmountMath('120-50')).toBe('70');
  });

  it('adds, multiplies and keeps precedence', () => {
    expect(resolveAmountMath('100 + 35')).toBe('135');
    expect(resolveAmountMath('2 x 30')).toBe('60');
    expect(resolveAmountMath('10 + 2 * 5')).toBe('20');
    expect(resolveAmountMath('100 - 2 × 10')).toBe('80');
  });

  it('reads decimal commas and rounds to hundredths', () => {
    expect(resolveAmountMath('12,5 + 0.255')).toBe('12.76');
  });

  it('leaves anything that is not a sum alone', () => {
    for (const text of ['', '70', '1.5', '1/2', '1 1/2', '2-3', '3-5', '120 - 150', '5 -', '- 5', '120 g - 50', 'abc']) {
      expect(resolveAmountMath(text)).toBe(text);
    }
  });
});

describe('typed sums reach the amount', () => {
  it('composes the result with the unit', () => {
    expect(composeFoodAmount('120 - 50', { key: 'g', label: 'g', suffix: 'g' } as never)).toBe('70g');
  });
  it('weighs a plate reading as a sum', () => {
    expect(parseWeightText('850 - 120')).toBe(730);
  });
});

describe('appendOperator', () => {
  it('appends an operator after a number', () => {
    expect(appendOperator('120', '-')).toBe('120 − ');
    expect(appendOperator('120 − 50', '+')).toBe('120 − 50 + ');
    expect(appendOperator('3', '*')).toBe('3 × ');
  });
  it('replaces a trailing operator and ignores an empty field', () => {
    expect(appendOperator('120 − ', '+')).toBe('120 + ');
    expect(appendOperator('', '+')).toBe('');
    expect(appendOperator('  ', '-')).toBe('  ');
    expect(appendOperator('−', '+')).toBe('−');
  });
  it('produces text resolveAmountMath reads', () => {
    expect(resolveAmountMath(`${appendOperator('120', '-')}50`)).toBe('70');
  });
});
