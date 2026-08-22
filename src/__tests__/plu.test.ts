import { normalizePlu, pluNameFor, splitOrganicPlu } from '../utils/plu';

describe('normalizePlu', () => {
  it('takes a four-digit sticker', () => {
    expect(normalizePlu('4011')).toBe('4011');
  });

  it('takes a five-digit sticker', () => {
    expect(normalizePlu('94011')).toBe('94011');
  });

  it('tolerates surrounding space', () => {
    expect(normalizePlu('  4011 ')).toBe('4011');
  });

  it('refuses a name', () => {
    expect(normalizePlu('bananas')).toBeNull();
  });

  it('refuses something too short or too long to be a sticker', () => {
    expect(normalizePlu('401')).toBeNull();
    expect(normalizePlu('401123')).toBeNull();
  });

  it('refuses a real barcode, so the two can never collide', () => {
    // Nothing valid is this short today, but the ordering is what makes that a
    // guarantee rather than an observation.
    expect(normalizePlu('96385074')).toBeNull();
  });
});

describe('splitOrganicPlu', () => {
  it('reads a leading 9 as the organic form of the code that follows', () => {
    expect(splitOrganicPlu('94011')).toEqual({ base: '4011', organic: true });
  });

  it('leaves a four-digit code alone', () => {
    expect(splitOrganicPlu('4011')).toEqual({ base: '4011', organic: false });
  });

  it('does not read a five-digit code starting with anything else as organic', () => {
    expect(splitOrganicPlu('83011')).toEqual({ base: '83011', organic: false });
  });
});

describe('pluNameFor', () => {
  it('names a seeded code', () => {
    expect(pluNameFor('4011')).toBe('Bananas');
  });

  it('applies the organic rule over a seeded code', () => {
    expect(pluNameFor('94011')).toBe('Organic bananas');
  });

  it('says nothing about a code it has never been told, which is the usual case', () => {
    expect(pluNameFor('4159')).toBeNull();
    expect(pluNameFor('94159')).toBeNull();
  });
});
