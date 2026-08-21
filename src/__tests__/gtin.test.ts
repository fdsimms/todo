import {
  GTIN_MISS_TTL_DAYS,
  formatGtin,
  gtinCheckDigit,
  isCacheEntryFresh,
  isGtin,
  normalizeGtin,
} from '../utils/gtin';

describe('gtinCheckDigit', () => {
  it('computes the GS1 mod-10 digit for a UPC-A body', () => {
    expect(gtinCheckDigit('03600029145')).toBe(2);
  });

  it('weights from the right, so the same body at a different length differs', () => {
    // The EAN-13 body is the UPC-A body with a leading zero. The zero
    // contributes nothing, so this pair happens to agree — which is exactly
    // what makes the two spellings one product.
    expect(gtinCheckDigit('003600029145')).toBe(2);
  });

  it('computes an EAN-8 digit', () => {
    expect(gtinCheckDigit('9638507')).toBe(4);
  });
});

describe('normalizeGtin', () => {
  it('pads a valid UPC-A to GTIN-14', () => {
    expect(normalizeGtin('036000291452')).toBe('00036000291452');
  });

  it('lands the UPC-A and EAN-13 spellings of one product on the same key', () => {
    expect(normalizeGtin('0036000291452')).toBe(normalizeGtin('036000291452'));
  });

  it('pads a valid EAN-8', () => {
    expect(normalizeGtin('96385074')).toBe('00000096385074');
  });

  it('ignores separators a scanner or a person might include', () => {
    expect(normalizeGtin(' 0 36000-291452 ')).toBe('00036000291452');
  });

  it('refuses a bad check digit, which is what a misread looks like', () => {
    expect(normalizeGtin('036000291453')).toBeNull();
  });

  it('refuses a length that is not a real barcode', () => {
    expect(normalizeGtin('0360002914')).toBeNull();
    expect(normalizeGtin('')).toBeNull();
  });

  it('refuses text', () => {
    expect(normalizeGtin('bananas')).toBeNull();
  });

  it('isGtin agrees with it', () => {
    expect(isGtin('036000291452')).toBe(true);
    expect(isGtin('bananas')).toBe(false);
  });
});

describe('formatGtin', () => {
  it('shows a UPC-A as twelve digits, not fourteen', () => {
    expect(formatGtin('00036000291452')).toBe('036000291452');
  });

  it('shows an EAN-8 as eight', () => {
    expect(formatGtin('00000096385074')).toBe('96385074');
  });

  it('keeps a genuine fourteen-digit code whole', () => {
    const gtin = normalizeGtin('10036000291459') ?? '';
    expect(gtin).toHaveLength(14);
    expect(formatGtin(gtin)).toHaveLength(14);
  });
});

describe('isCacheEntryFresh', () => {
  const now = new Date('2026-08-21T12:00:00Z');

  it('never expires a hit — a barcode is a permanent fact about a box', () => {
    expect(isCacheEntryFresh({ found: true, fetchedAt: '2019-01-01T00:00:00Z' }, now)).toBe(true);
  });

  it('keeps a recent miss, so an unknown code is not re-asked every unpack', () => {
    expect(isCacheEntryFresh({ found: false, fetchedAt: '2026-08-20T12:00:00Z' }, now)).toBe(true);
  });

  it('expires a miss past the window, so a catalog that caught up reaches you', () => {
    const old = new Date(now.getTime() - (GTIN_MISS_TTL_DAYS + 1) * 86_400_000).toISOString();
    expect(isCacheEntryFresh({ found: false, fetchedAt: old }, now)).toBe(false);
  });

  it('treats an unreadable stamp as stale rather than trusting it', () => {
    expect(isCacheEntryFresh({ found: false, fetchedAt: 'not a date' }, now)).toBe(false);
  });
});
