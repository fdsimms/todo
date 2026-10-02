import { parseGuestNames } from '../utils/rsvp';

describe('parseGuestNames', () => {
  it('reads one name per line or per comma, in order', () => {
    expect(parseGuestNames('Dana\nSam, Priya\n')).toEqual(['Dana', 'Sam', 'Priya']);
  });

  it('strips the bullets a pasted list carries', () => {
    expect(parseGuestNames('- Dana\n• Sam\n1. Priya\n[ ] Lee')).toEqual(['Dana', 'Sam', 'Priya', 'Lee']);
  });

  it('drops blanks and repeats, ignoring case', () => {
    expect(parseGuestNames('Dana\n\n  \ndana\nDANA ')).toEqual(['Dana']);
  });
});
