import { keepTailTogether } from '../utils/titleWrap';

const NBSP = ' ';

describe('keepTailTogether', () => {
  it('joins the last two words so a name wraps as a unit', () => {
    expect(keepTailTogether('Catch up with Helen Song')).toBe(`Catch up with Helen${NBSP}Song`);
  });

  it('leaves a title of two words or fewer alone', () => {
    expect(keepTailTogether('Buy milk')).toBe('Buy milk');
    expect(keepTailTogether('Laundry')).toBe('Laundry');
    expect(keepTailTogether('')).toBe('');
  });

  it('leaves a pair too long for one line to wrap at the space', () => {
    const title = 'Catch up with Bartholomew Featherstonehaugh';
    expect(keepTailTogether(title)).toBe(title);
  });
});
