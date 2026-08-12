import {
  AISLE_LEXICON,
  DEFAULT_AISLES,
  OTHER_AISLE,
  aisleForName,
  normalizeAisleOrder,
  hiddenDefaultAisles,
  shopAisleOrder,
  pruneShopAisleOrders,
  renameInShopAisleOrders,
  placeAisle,
  rememberAisles,
  remapRememberedAisle,
  forgetRememberedAisle,
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

  it('keeps a hidden default out, so a delete survives the next read', () => {
    const result = normalizeAisleOrder(['Produce'], [], ['Snacks']);
    expect(result).not.toContain('Snacks');
    expect(result).toContain('Bakery');
  });

  it('brings a hidden aisle back if a row still carries it — unplaced is worse', () => {
    const result = normalizeAisleOrder(['Produce'], ['Snacks'], ['Snacks']);
    expect(result).toContain('Snacks');
  });
});

// ─── deleting and renaming ───────────────────────────────────────────────────

describe('hiddenDefaultAisles', () => {
  it('names the built-ins a saved order left out', () => {
    expect(hiddenDefaultAisles(['Produce', 'Bakery'])).toContain('Snacks');
    expect(hiddenDefaultAisles(['Produce', 'Bakery'])).not.toContain('Produce');
  });

  it('never hides Other, which is the floor', () => {
    expect(hiddenDefaultAisles([])).not.toContain(OTHER_AISLE);
  });

  it('is empty when nothing was removed', () => {
    expect(hiddenDefaultAisles([...DEFAULT_AISLES])).toEqual([]);
  });

  it('ignores custom aisles, which need no tombstone', () => {
    expect(hiddenDefaultAisles([...DEFAULT_AISLES, 'Butcher'])).toEqual([]);
  });
});

describe('placeAisle', () => {
  it('keeps an aisle that still exists', () => {
    expect(placeAisle('Produce', ['Produce', OTHER_AISLE])).toBe('Produce');
  });

  it('falls back to Other for a deleted one, so it cannot resurrect itself', () => {
    expect(placeAisle('Snacks', ['Produce', OTHER_AISLE])).toBe(OTHER_AISLE);
  });

  it('falls back to Other for no guess at all', () => {
    expect(placeAisle(null, ['Produce', OTHER_AISLE])).toBe(OTHER_AISLE);
  });

  it('trusts the guess when no order has loaded yet', () => {
    expect(placeAisle('Produce', [])).toBe('Produce');
  });
});

describe('remapRememberedAisle', () => {
  it('carries every filing onto the renamed aisle', () => {
    const result = remapRememberedAisle({ nduja: 'Deli', salami: 'Deli', milk: 'Frozen' }, 'Deli', 'Charcuterie');
    expect(result).toEqual({ nduja: 'Charcuterie', salami: 'Charcuterie', milk: 'Frozen' });
  });

  it('returns null when nothing pointed there', () => {
    expect(remapRememberedAisle({ milk: 'Frozen' }, 'Deli', 'Charcuterie')).toBeNull();
    expect(remapRememberedAisle({ milk: 'Frozen' }, 'Frozen', 'Frozen')).toBeNull();
  });

  it('never mutates what it was given', () => {
    const current = { nduja: 'Deli' };
    remapRememberedAisle(current, 'Deli', 'Charcuterie');
    expect(current).toEqual({ nduja: 'Deli' });
  });
});

describe('forgetRememberedAisle', () => {
  it('drops the filings rather than rewriting them to Other', () => {
    // Rewriting would record a filing the user never made, and it would
    // outrank the lexicon for ever after.
    expect(forgetRememberedAisle({ nduja: 'Deli', milk: 'Frozen' }, 'Deli')).toEqual({ milk: 'Frozen' });
  });

  it('returns null when nothing pointed there', () => {
    expect(forgetRememberedAisle({ milk: 'Frozen' }, 'Deli')).toBeNull();
  });

  it('never mutates what it was given', () => {
    const current = { nduja: 'Deli' };
    forgetRememberedAisle(current, 'Deli');
    expect(current).toEqual({ nduja: 'Deli' });
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

describe('shopAisleOrder', () => {
  // An already-normalized default order, as normalizeAisleOrder would hand it over.
  const base = ['Produce', 'Bakery', 'Dairy & Eggs', 'Frozen', OTHER_AISLE];

  it('falls back to the default order when the store has no entry of its own', () => {
    expect(shopAisleOrder(base, null)).toEqual(base);
    expect(shopAisleOrder(base, undefined)).toEqual(base);
    expect(shopAisleOrder(base, [])).toEqual(base);
  });

  it('reorders the default set', () => {
    expect(shopAisleOrder(base, ['Frozen', 'Produce'])).toEqual([
      'Frozen', 'Produce', 'Bakery', 'Dairy & Eggs', OTHER_AISLE,
    ]);
  });

  // The property that keeps a bigger DEFAULT_AISLES migration-free: a new
  // built-in reaches a store that diverged before it existed.
  it('appends anything the entry never mentioned, in the default order', () => {
    expect(shopAisleOrder(base, ['Frozen'])).toEqual([
      'Frozen', 'Produce', 'Bakery', 'Dairy & Eggs', OTHER_AISLE,
    ]);
  });

  // A per-store entry reorders; it never adds. Otherwise a store could
  // resurrect a deleted aisle that hiddenAisles is holding down globally.
  it('drops a name the default order no longer has', () => {
    expect(shopAisleOrder(base, ['Snacks', 'Frozen'])).toEqual([
      'Frozen', 'Produce', 'Bakery', 'Dairy & Eggs', OTHER_AISLE,
    ]);
  });

  it('never loses an aisle the default has', () => {
    const result = shopAisleOrder(base, ['Frozen', 'Bakery']);
    expect([...result].sort()).toEqual([...base].sort());
  });

  it('forces Other last however the entry arrived', () => {
    expect(shopAisleOrder(base, [OTHER_AISLE, 'Frozen'])).toEqual([
      'Frozen', 'Produce', 'Bakery', 'Dairy & Eggs', OTHER_AISLE,
    ]);
  });

  it('ignores duplicates and blanks in a stored entry', () => {
    expect(shopAisleOrder(base, ['Frozen', 'Frozen', '  ', 'Produce'])).toEqual([
      'Frozen', 'Produce', 'Bakery', 'Dairy & Eggs', OTHER_AISLE,
    ]);
  });

  it('trims a stored name so it still matches', () => {
    expect(shopAisleOrder(base, ['  Frozen  '])[0]).toBe('Frozen');
  });
});

describe('pruneShopAisleOrders', () => {
  it('returns null when every entry names a live store', () => {
    expect(pruneShopAisleOrders({ a: ['Frozen'] }, ['a', 'b'])).toBeNull();
  });

  it('drops an entry whose store is gone', () => {
    expect(pruneShopAisleOrders({ a: ['Frozen'], gone: ['Bakery'] }, ['a'])).toEqual({
      a: ['Frozen'],
    });
  });

  it('drops a malformed or empty entry', () => {
    const stored = { a: ['Frozen'], b: [], c: 'nope' as unknown as string[] };
    expect(pruneShopAisleOrders(stored, ['a', 'b', 'c'])).toEqual({ a: ['Frozen'] });
  });
});

describe('renameInShopAisleOrders', () => {
  it('renames in place, keeping the store\'s own position', () => {
    const result = renameInShopAisleOrders(
      { costco: ['Frozen', 'Snacks', 'Produce'] },
      'Snacks',
      'Crisps'
    );
    expect(result).toEqual({ costco: ['Frozen', 'Crisps', 'Produce'] });
  });

  it('reaches every store that had an opinion', () => {
    const result = renameInShopAisleOrders(
      { costco: ['Snacks', 'Produce'], safeway: ['Produce', 'Snacks'] },
      'Snacks',
      'Crisps'
    );
    expect(result).toEqual({
      costco: ['Crisps', 'Produce'],
      safeway: ['Produce', 'Crisps'],
    });
  });

  it('leaves stores that never mentioned it alone', () => {
    const result = renameInShopAisleOrders(
      { costco: ['Snacks'], safeway: ['Produce'] },
      'Snacks',
      'Crisps'
    );
    expect(result?.safeway).toEqual(['Produce']);
  });

  it('is null when no store had an opinion about that name', () => {
    expect(renameInShopAisleOrders({ costco: ['Produce'] }, 'Snacks', 'Crisps')).toBeNull();
    expect(renameInShopAisleOrders({}, 'Snacks', 'Crisps')).toBeNull();
  });
});
