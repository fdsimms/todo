import { nicknamesOf, primaryNickname } from '../utils/nicknames';

describe('nicknamesOf', () => {
  it('splits on commas and trims', () => {
    expect(nicknamesOf('Dr. Kushman,  cardiologist ')).toEqual(['Dr. Kushman', 'cardiologist']);
  });

  it('drops blanks and case-insensitive repeats', () => {
    expect(nicknamesOf(', Tess,,tess , Tessie')).toEqual(['Tess', 'Tessie']);
  });

  it('is empty for no nickname', () => {
    expect(nicknamesOf('')).toEqual([]);
    expect(nicknamesOf('  ')).toEqual([]);
  });
});

describe('primaryNickname', () => {
  it('is the first one listed', () => {
    expect(primaryNickname('Dr. Kushman, cardiologist')).toBe('Dr. Kushman');
  });

  it('is empty when there is none', () => {
    expect(primaryNickname('')).toBe('');
  });
});
