import { capitalize } from '../utils/capitalize';

describe('capitalize', () => {
  it('upper-cases the first character', () => {
    expect(capitalize('minutes')).toBe('Minutes');
  });

  it('leaves the rest of the string exactly as it was', () => {
    expect(capitalize('iPhone charger')).toBe('IPhone charger');
    expect(capitalize('BBQ sauce')).toBe('BBQ sauce');
  });

  it('returns an empty string unchanged rather than throwing', () => {
    expect(capitalize('')).toBe('');
  });

  it('leaves a string that does not start with a letter alone', () => {
    expect(capitalize('2 cups')).toBe('2 cups');
  });
});
