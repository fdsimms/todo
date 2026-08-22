import {
  aliasDraftsFrom,
  aliasItemIdFor,
  aliasKeyFor,
  type AliasDraft,
} from '../utils/storeAliases';
import type { StoreAlias } from '../types';

function alias(overrides: Partial<StoreAlias> & { rawKey: string; itemId: string }): StoreAlias {
  return {
    id: `alias-${overrides.rawKey}-${overrides.shopId ?? ''}`,
    shopId: '',
    hitCount: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('aliasKeyFor', () => {
  it('keys two printings of one line the same', () => {
    expect(aliasKeyFor('GV MLK 2% GAL')).toBe(aliasKeyFor('  gv mlk 2% gal  '));
  });

  it('strips a trailing price, which is on the line rather than in the name', () => {
    expect(aliasKeyFor('GV MLK 2% GAL 3.48')).toBe(aliasKeyFor('GV MLK 2% GAL'));
    expect(aliasKeyFor('GV MLK 2% GAL $3.48')).toBe(aliasKeyFor('GV MLK 2% GAL'));
  });

  it('strips a leading item code', () => {
    expect(aliasKeyFor('007225 SHRP CHDR')).toBe(aliasKeyFor('SHRP CHDR'));
  });

  it('keeps a bare trailing integer, which is a pack size and not a price', () => {
    expect(aliasKeyFor('SODA 12')).not.toBe(aliasKeyFor('SODA 6'));
  });

  it('keeps two pack sizes apart rather than collapsing them', () => {
    expect(aliasKeyFor('SODA 12PK')).not.toBe(aliasKeyFor('SODA 6PK'));
  });

  it('collapses two weights of one weighed item, which is the case to merge', () => {
    // The weight varies per purchase, so it can't be part of the identity. It
    // survives keying only because it isn't a decimal price; the trailing
    // price strip is what removes the *charge*.
    expect(aliasKeyFor('CHKN BRST 4.18')).toBe(aliasKeyFor('CHKN BRST 7.92'));
  });

  it('answers empty for a line with nothing in it', () => {
    expect(aliasKeyFor('   ')).toBe('');
    expect(aliasKeyFor('12345')).toBe('12345');
  });
});

describe('aliasItemIdFor', () => {
  const aliases = [
    alias({ rawKey: aliasKeyFor('GV MLK 2% GAL'), itemId: 'milk', shopId: 'walmart' }),
    alias({ rawKey: aliasKeyFor('GV MLK 2% GAL'), itemId: 'other-milk', shopId: '' }),
    alias({ rawKey: aliasKeyFor('SHRP CHDR'), itemId: 'cheddar', shopId: '' }),
  ];

  it('resolves a phrase the store has been told about', () => {
    expect(aliasItemIdFor(aliases, 'walmart', 'GV MLK 2% GAL')).toBe('milk');
  });

  it('prefers the store-specific answer over the general one', () => {
    expect(aliasItemIdFor(aliases, 'walmart', 'GV MLK 2% GAL')).not.toBe('other-milk');
  });

  it('falls back to a store-less alias at a store that has no rule', () => {
    expect(aliasItemIdFor(aliases, 'costco', 'GV MLK 2% GAL')).toBe('other-milk');
  });

  it('answers a store-less lookup, which is what a scan does', () => {
    expect(aliasItemIdFor(aliases, null, 'SHRP CHDR')).toBe('cheddar');
  });

  it('does not let a store-scoped alias answer a store-less lookup', () => {
    const scoped = [alias({ rawKey: aliasKeyFor('BNLS CHKN'), itemId: 'chicken', shopId: 'walmart' })];
    expect(aliasItemIdFor(scoped, null, 'BNLS CHKN')).toBeNull();
  });

  it('says nothing about a phrase nobody has confirmed', () => {
    expect(aliasItemIdFor(aliases, 'walmart', 'MYSTERY ITEM')).toBeNull();
  });

  it('refuses an empty phrase rather than matching every empty line', () => {
    expect(aliasItemIdFor([alias({ rawKey: '', itemId: 'x' })], null, '   ')).toBeNull();
  });
});

describe('aliasDraftsFrom', () => {
  const draft = (o: Partial<AliasDraft> = {}): AliasDraft =>
    ({ shopId: 'walmart', rawText: 'GV MLK 2% GAL', itemId: 'milk', ...o });

  it('keeps a confirmation', () => {
    expect(aliasDraftsFrom([draft()])).toHaveLength(1);
  });

  it('drops a phrase that keys to nothing', () => {
    expect(aliasDraftsFrom([draft({ rawText: '   ' })])).toHaveLength(0);
  });

  it('drops a draft with no row attached', () => {
    expect(aliasDraftsFrom([draft({ itemId: '' })])).toHaveLength(0);
  });

  it('writes one rule per phrase, not one per line that read alike', () => {
    expect(aliasDraftsFrom([draft(), draft({ rawText: 'GV MLK 2% GAL 3.48' })])).toHaveLength(1);
  });

  it('keeps one phrase at two different stores apart', () => {
    const both = aliasDraftsFrom([draft(), draft({ shopId: 'costco' })]);
    expect(both).toHaveLength(2);
  });

  it('keeps a store-scoped draft apart from a store-less one', () => {
    expect(aliasDraftsFrom([draft(), draft({ shopId: null })])).toHaveLength(2);
  });
});
