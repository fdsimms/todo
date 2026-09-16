import { isSingleTransposition, withinOneEdit } from '../utils/textSimilar';

// ─── withinOneEdit ───────────────────────────────────────────────────────────

describe('withinOneEdit', () => {
  it('accepts an identical pair', () => {
    expect(withinOneEdit('skyr', 'skyr')).toBe(true);
  });

  it('accepts a substitution', () => {
    expect(withinOneEdit('skir', 'skyr')).toBe(true);
  });

  it('accepts an insertion at either end and in the middle', () => {
    expect(withinOneEdit('sky', 'skyr')).toBe(true);
    expect(withinOneEdit('kyr', 'skyr')).toBe(true);
    expect(withinOneEdit('yoghurt', 'yohurt')).toBe(true);
  });

  it('refuses two edits', () => {
    expect(withinOneEdit('butter', 'batter')).toBe(true); // one substitution
    expect(withinOneEdit('butter', 'bitten')).toBe(false);
  });

  it('refuses a length gap wider than one', () => {
    expect(withinOneEdit('milk', 'milkshake')).toBe(false);
  });

  it('counts a transposition as two edits, so it is refused', () => {
    // Deliberate: see the doc comment. Damerau would accept this one.
    expect(withinOneEdit('yogurt', 'yougrt')).toBe(false);
  });
});

// ─── isSingleTransposition ───────────────────────────────────────────────────

describe('isSingleTransposition', () => {
  it('accepts one adjacent swap', () => {
    expect(isSingleTransposition('dentsit', 'dentist')).toBe(true);
    expect(isSingleTransposition('yoghrut', 'yoghurt')).toBe(true);
  });

  it('is symmetric', () => {
    expect(isSingleTransposition('dentist', 'dentsit')).toBe(true);
  });

  it('refuses an identical pair, which is not a swap', () => {
    expect(isSingleTransposition('dentist', 'dentist')).toBe(false);
  });

  it('refuses a swap of characters that are not adjacent', () => {
    expect(isSingleTransposition('tsenid', 'dentis')).toBe(false);
    expect(isSingleTransposition('dintest', 'dentist')).toBe(false);
  });

  it('refuses two separate swaps', () => {
    expect(isSingleTransposition('edntsit', 'dentist')).toBe(false);
  });

  // A swap moves characters; it never adds or removes one.
  it('refuses a length difference', () => {
    expect(isSingleTransposition('dentis', 'dentist')).toBe(false);
  });

  it('refuses a plain substitution', () => {
    expect(isSingleTransposition('dentost', 'dentist')).toBe(false);
  });
});
