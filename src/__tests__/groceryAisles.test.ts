import {
  AISLE_LEXICON,
  DEFAULT_AISLES,
  OTHER_AISLE,
  aisleForName,
  normalizeAisleOrder,
} from '../utils/groceryAisles';

// ─── the lexicon's own invariant ─────────────────────────────────────────────

describe('AISLE_LEXICON', () => {
  it('only ever names an aisle that exists', () => {
    // A typo here would invent a section with no place in the walk order, so
    // its items would render in an unordered heap at the bottom of the list.
    const known = new Set<string>(DEFAULT_AISLES);
    const strays = Object.entries(AISLE_LEXICON)
      .filter(([, aisle]) => !known.has(aisle))
      .map(([name, aisle]) => `${name} → ${aisle}`);
    expect(strays).toEqual([]);
  });

  it('is keyed by normalised names, so lookups can hit', () => {
    const unnormalised = Object.keys(AISLE_LEXICON).filter(k => k !== k.toLowerCase().trim());
    expect(unnormalised).toEqual([]);
  });

  it('ends its walk order with the catch-all', () => {
    expect(DEFAULT_AISLES[DEFAULT_AISLES.length - 1]).toBe(OTHER_AISLE);
  });
});

// ─── aisleForName ────────────────────────────────────────────────────────────

describe('aisleForName', () => {
  it('resolves an exact name', () => {
    expect(aisleForName('milk')).toBe('Dairy & Eggs');
    expect(aisleForName('Bananas')).toBe('Produce');
    expect(aisleForName('toilet paper')).toBe('Household');
  });

  it('is case- and punctuation-insensitive, via the same key the catalog uses', () => {
    expect(aisleForName('  MILK ')).toBe('Dairy & Eggs');
  });

  it('falls back to the last token — English puts the head noun last', () => {
    expect(aisleForName('greek yogurt')).toBe('Dairy & Eggs');
    expect(aisleForName('organic whole milk')).toBe('Dairy & Eggs');
  });

  it('prefers a multi-word entry over its last token', () => {
    // "ice cream" is Frozen even though "cream" alone is Dairy & Eggs.
    expect(aisleForName('ice cream')).toBe('Frozen');
    expect(aisleForName('cream')).toBe('Dairy & Eggs');
  });

  it('falls back to any token when the last one is unknown', () => {
    expect(aisleForName('chicken casserole')).toBe('Meat & Seafood');
  });

  it('returns null when nothing matches, so the caller files it under Other', () => {
    expect(aisleForName('nduja')).toBeNull();
    expect(aisleForName('harissa paste')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(aisleForName('')).toBeNull();
    expect(aisleForName('   ')).toBeNull();
  });
});

// ─── normalizeAisleOrder ─────────────────────────────────────────────────────

describe('normalizeAisleOrder', () => {
  it('returns the defaults when nothing is stored', () => {
    expect(normalizeAisleOrder(null)).toEqual([...DEFAULT_AISLES]);
  });

  it("preserves a user's stored sequence ahead of the defaults", () => {
    const stored = ['Frozen', 'Produce'];
    const result = normalizeAisleOrder(stored);
    expect(result[0]).toBe('Frozen');
    expect(result[1]).toBe('Produce');
  });

  it('appends defaults the stored order predates, so a bigger lexicon needs no migration', () => {
    const result = normalizeAisleOrder(['Produce', 'Bakery']);
    for (const aisle of DEFAULT_AISLES) expect(result).toContain(aisle);
  });

  it('appends an aisle a row uses but the order has never heard of', () => {
    const result = normalizeAisleOrder(['Produce'], ['Butcher']);
    expect(result).toContain('Butcher');
  });

  it('dedupes', () => {
    const result = normalizeAisleOrder(['Produce', 'Produce'], ['Produce']);
    expect(result.filter(a => a === 'Produce')).toHaveLength(1);
  });

  it('forces Other last however it arrived', () => {
    const result = normalizeAisleOrder([OTHER_AISLE, 'Produce']);
    expect(result[result.length - 1]).toBe(OTHER_AISLE);
    expect(result.filter(a => a === OTHER_AISLE)).toHaveLength(1);
  });

  it('drops blanks', () => {
    const result = normalizeAisleOrder(['', '   ', 'Produce']);
    expect(result).not.toContain('');
    expect(result).toContain('Produce');
  });
});
