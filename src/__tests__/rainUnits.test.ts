import { rainUnitFor, formatRain } from '../utils/rainUnits';

describe('units', () => {
  it('shows millimetres only on metric', () => {
    expect(rainUnitFor('metric')).toBe('mm');
    expect(rainUnitFor('us')).toBe('in');
    expect(rainUnitFor('asWritten')).toBe('in');
    expect(rainUnitFor(undefined)).toBe('in');
  });

  it('says an amount in either unit', () => {
    expect(formatRain(6.35, 'in')).toBe('0.25 in');
    expect(formatRain(25.4, 'in')).toBe('1 in');
    expect(formatRain(6.35, 'mm')).toBe('6.4 mm');
    expect(formatRain(12.7, 'mm')).toBe('13 mm');
  });
});
