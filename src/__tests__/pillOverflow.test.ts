import {
  resolvePillOverflow,
  resolvePillSubmit,
  DEFAULT_PILL_LIMIT,
  type OverflowPill,
} from '../utils/pillOverflow';

const pills = (...labels: string[]): OverflowPill[] =>
  labels.map(label => ({ key: label, label }));

/** n plain unselected options, "A1".."An". */
const many = (n: number): OverflowPill[] =>
  Array.from({ length: n }, (_, i) => ({ key: `k${i}`, label: `A${i + 1}` }));

const labels = (os: OverflowPill[]) => os.map(o => o.label);

describe('resolvePillOverflow', () => {
  describe('under the cap', () => {
    it('shows everything and offers no filter field', () => {
      const r = resolvePillOverflow(pills('Produce', 'Bakery', 'Deli'));
      expect(labels(r.visible)).toEqual(['Produce', 'Bakery', 'Deli']);
      expect(r.hiddenCount).toBe(0);
      expect(r.filterable).toBe(false);
    });

    it('shows everything at exactly the cap', () => {
      const r = resolvePillOverflow(many(DEFAULT_PILL_LIMIT));
      expect(r.visible).toHaveLength(DEFAULT_PILL_LIMIT);
      expect(r.hiddenCount).toBe(0);
      expect(r.filterable).toBe(false);
    });

    it('handles an empty set', () => {
      const r = resolvePillOverflow([]);
      expect(r.visible).toEqual([]);
      expect(r.hiddenCount).toBe(0);
      expect(r.filterable).toBe(false);
      expect(r.noMatches).toBe(false);
    });
  });

  describe('over the cap', () => {
    it('caps the grid and reports the remainder', () => {
      const r = resolvePillOverflow(many(16));
      expect(r.visible).toHaveLength(DEFAULT_PILL_LIMIT);
      expect(r.hiddenCount).toBe(8);
      expect(r.filterable).toBe(true);
    });

    it('shows one over the cap rather than hiding a single pill', () => {
      // A "1 more" costs a tap to save nothing — see the note in foldRows.
      const r = resolvePillOverflow(many(DEFAULT_PILL_LIMIT + 1));
      expect(r.visible).toHaveLength(DEFAULT_PILL_LIMIT + 1);
      expect(r.hiddenCount).toBe(0);
      // Still filterable: the set is genuinely past the cap.
      expect(r.filterable).toBe(true);
    });

    it('lifts the cap once showAll is set', () => {
      const r = resolvePillOverflow(many(16), { showAll: true });
      expect(r.visible).toHaveLength(16);
      expect(r.hiddenCount).toBe(0);
      expect(r.filterable).toBe(true);
    });

    it('respects a caller-supplied limit', () => {
      const r = resolvePillOverflow(many(16), { limit: 4 });
      expect(r.visible).toHaveLength(4);
      expect(r.hiddenCount).toBe(12);
    });
  });

  describe('what the cap may not hide', () => {
    it('keeps a selected pill that sits past the cap, in its own position', () => {
      const options = many(16);
      options[14] = { ...options[14], selected: true };
      const r = resolvePillOverflow(options);

      expect(labels(r.visible)).toContain('A15');
      // Not hoisted to the front — aisleOrder is the user's walk round the shop.
      expect(labels(r.visible)).toEqual([
        'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A15',
      ]);
      expect(r.hiddenCount).toBe(8);
    });

    it('keeps every selected pill even when they alone exceed the cap', () => {
      const options = many(16).map((o, i) => (i >= 6 ? { ...o, selected: true } : o));
      const r = resolvePillOverflow(options);
      expect(r.visible.filter(o => o.selected)).toHaveLength(10);
      // Nothing unselected got room, so the six unselected ones are all hidden.
      expect(r.visible).toHaveLength(10);
      expect(r.hiddenCount).toBe(6);
    });

    it('keeps a pinned pill — the "no choice" option is never buried', () => {
      const options: OverflowPill[] = [
        ...many(15),
        { key: 'none', label: 'No store', pinned: true },
      ];
      const r = resolvePillOverflow(options);
      expect(labels(r.visible)).toContain('No store');
      expect(r.visible).toHaveLength(DEFAULT_PILL_LIMIT);
      expect(r.hiddenCount).toBe(8);
    });

    it('preserves the original order across forced and filler pills', () => {
      const options = many(16).map((o, i) =>
        i === 12 ? { ...o, selected: true } : i === 3 ? { ...o, pinned: true } : o,
      );
      const r = resolvePillOverflow(options);
      const idx = labels(r.visible).map(l => Number(l.slice(1)));
      expect(idx).toEqual([...idx].sort((a, b) => a - b));
    });
  });

  describe('filtering', () => {
    const aisles = pills(
      'Produce', 'Bakery', 'Deli', 'Meat & Seafood', 'Dairy & Eggs', 'Frozen',
      'Pantry', 'Canned & Jarred', 'Snacks', 'Beverages', 'Breakfast',
      'Baking & Spices', 'Household', 'Personal Care', 'Medicine & Supplements', 'Other',
    );

    it('matches anywhere in the label, case-insensitively', () => {
      const r = resolvePillOverflow(aisles, { query: 'ak' });
      expect(labels(r.visible)).toEqual(['Bakery', 'Breakfast', 'Baking & Spices']);
    });

    it('lifts the cap while filtering', () => {
      // "a" matches more than the cap would otherwise allow through.
      const r = resolvePillOverflow(aisles, { query: 'a' });
      expect(r.visible.length).toBeGreaterThan(DEFAULT_PILL_LIMIT);
      expect(r.hiddenCount).toBe(0);
    });

    it('ignores surrounding whitespace and case in the query', () => {
      const r = resolvePillOverflow(aisles, { query: '  FROZEN ' });
      expect(labels(r.visible)).toEqual(['Frozen']);
    });

    it('reports an exact match so the caller can offer picking over adding', () => {
      const r = resolvePillOverflow(aisles, { query: 'produce' });
      expect(r.exact?.label).toBe('Produce');
      expect(r.noMatches).toBe(false);
    });

    it('does not call a substring match exact', () => {
      const r = resolvePillOverflow(aisles, { query: 'Bak' });
      expect(r.exact).toBeNull();
      expect(labels(r.visible)).toEqual(['Bakery', 'Baking & Spices']);
    });

    it('reports no matches so the caller can offer creating one', () => {
      const r = resolvePillOverflow(aisles, { query: 'Baby' });
      expect(r.visible).toEqual([]);
      expect(r.noMatches).toBe(true);
      expect(r.exact).toBeNull();
    });

    it('keeps the field on screen when the query narrows the set below the cap', () => {
      // The field must not vanish under the person typing into it.
      const r = resolvePillOverflow(aisles, { query: 'Frozen' });
      expect(r.visible).toHaveLength(1);
      expect(r.filterable).toBe(true);
    });

    it('filters a small set without ever offering the field', () => {
      const r = resolvePillOverflow(pills('Produce', 'Bakery'), { query: 'bak' });
      expect(labels(r.visible)).toEqual(['Bakery']);
      expect(r.filterable).toBe(false);
    });
  });
});

describe('resolvePillSubmit', () => {
  const aisles = pills(
    'Produce', 'Bakery', 'Deli', 'Meat & Seafood', 'Dairy & Eggs', 'Frozen',
    'Pantry', 'Canned & Jarred', 'Snacks', 'Beverages', 'Breakfast',
    'Baking & Spices', 'Household', 'Personal Care', 'Medicine & Supplements', 'Other',
  );
  const submit = (query: string, canCreate = true) =>
    resolvePillSubmit(resolvePillOverflow(aisles, { query }), { text: query, canCreate });

  it('does nothing on an empty field', () => {
    expect(submit('')).toEqual({ action: 'none' });
    expect(submit('   ')).toEqual({ action: 'none' });
  });

  it('picks an exact match rather than creating a duplicate', () => {
    const d = submit('bakery');
    expect(d).toEqual({ action: 'pick', option: expect.objectContaining({ label: 'Bakery' }) });
  });

  it('picks the sole remaining match', () => {
    const d = submit('froz');
    expect(d).toEqual({ action: 'pick', option: expect.objectContaining({ label: 'Frozen' }) });
  });

  it('waits when several still match, rather than creating from a fragment', () => {
    // "ba" is a state the field passes through on the way to "Bakery".
    expect(labels(resolvePillOverflow(aisles, { query: 'ba' }).visible).length)
      .toBeGreaterThan(1);
    expect(submit('ba')).toEqual({ action: 'none' });
  });

  it('creates when nothing matches', () => {
    expect(submit('Baby')).toEqual({ action: 'create' });
  });

  it('does not create when the caller has no create handler', () => {
    expect(submit('Baby', false)).toEqual({ action: 'none' });
  });

  it('creates from a small set, where the field is the add input and not a filter', () => {
    // Below the cap there is no filter, so the text is a name being typed —
    // "Bak" there means add "Bak", not "narrow the grid to Bakery".
    const small = pills('Produce', 'Bakery');
    const d = resolvePillSubmit(resolvePillOverflow(small), { text: 'Bak', canCreate: true });
    expect(d).toEqual({ action: 'create' });
  });
});
