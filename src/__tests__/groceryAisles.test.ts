import {
  AISLE_LEXICON,
  DEFAULT_AISLES,
  OTHER_AISLE,
  aisleForName,
  normalizeAisleOrder,
  rememberAisles,
  renameRememberedAisle,
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

// ─── remembered aisles ───────────────────────────────────────────────────────

describe('rememberAisles', () => {
  it('records a filing under the item key', () => {
    expect(rememberAisles({}, [{ nameKey: 'nduja', aisle: 'Deli' }])).toEqual({ nduja: 'Deli' });
  });

  it('overwrites an earlier filing — the latest is what the user means', () => {
    const result = rememberAisles({ nduja: 'Deli' }, [{ nameKey: 'nduja', aisle: 'Meat & Seafood' }]);
    expect(result).toEqual({ nduja: 'Meat & Seafood' });
  });

  it('returns null when nothing changed, so the caller skips the write', () => {
    expect(rememberAisles({ nduja: 'Deli' }, [{ nameKey: 'nduja', aisle: 'Deli' }])).toBeNull();
    expect(rememberAisles({}, [])).toBeNull();
  });

  it('never mutates what it was given', () => {
    const current = { nduja: 'Deli' };
    rememberAisles(current, [{ nameKey: 'milk', aisle: 'Frozen' }]);
    expect(current).toEqual({ nduja: 'Deli' });
  });

  it('takes a whole batch in one pass', () => {
    const result = rememberAisles({}, [
      { nameKey: 'nduja', aisle: 'Deli' },
      { nameKey: 'milk', aisle: 'Frozen' },
    ]);
    expect(result).toEqual({ nduja: 'Deli', milk: 'Frozen' });
  });

  it('drops entries that could never be looked up again', () => {
    expect(rememberAisles({}, [
      { nameKey: '', aisle: 'Deli' },
      { nameKey: 'milk', aisle: '  ' },
    ])).toBeNull();
  });
});

describe('renameRememberedAisle', () => {
  it('moves the filing onto the new key', () => {
    const result = renameRememberedAisle({ 'protien powder': 'Household' }, 'protien powder', 'protein powder');
    expect(result).toEqual({ 'protein powder': 'Household' });
  });

  it('is a no-op when there was nothing filed, or the key is unchanged', () => {
    expect(renameRememberedAisle({}, 'milk', 'whole milk')).toBeNull();
    expect(renameRememberedAisle({ milk: 'Frozen' }, 'milk', 'milk')).toBeNull();
  });

  it('leaves everything else alone', () => {
    const result = renameRememberedAisle({ milk: 'Frozen', nduja: 'Deli' }, 'milk', 'whole milk');
    expect(result).toEqual({ 'whole milk': 'Frozen', nduja: 'Deli' });
  });
});
