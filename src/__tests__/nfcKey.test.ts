import {
  MAX_NFC_KEYS, canLock, cleanKeyName, keyLinkUrl, lockAfterRemoval, matchKey, newLinkToken,
  nextKeyLock, normalizeLinkToken, normalizeTagUid, parseNfcKeys, withKeyAdded, withKeyRemoved,
  type NfcKey,
} from '../utils/nfcKey';

const key = (over: Partial<NfcKey> = {}): NfcKey => ({
  id: 'k1', name: 'Desk tag', kind: 'tag', secret: '04A1B2C3D4E5F6', addedAt: '2026-10-14T09:00:00.000Z', ...over,
});

describe('normalizeTagUid', () => {
  it('upper-cases and strips separators', () => {
    expect(normalizeTagUid('04:a1:b2:c3:d4:e5:f6')).toBe('04A1B2C3D4E5F6');
    expect(normalizeTagUid(' 04-a1 b2.c3d4 ')).toBe('04A1B2C3D4');
  });
  it('refuses what is not a hardware id', () => {
    expect(normalizeTagUid('')).toBeNull();
    expect(normalizeTagUid(null)).toBeNull();
    expect(normalizeTagUid('zz11zz11')).toBeNull();
    expect(normalizeTagUid('04A1B')).toBeNull(); // odd length
    expect(normalizeTagUid('04A1B2')).toBeNull(); // 3 bytes
    expect(normalizeTagUid('04A1B2C3D4E5F6A7B8C9D0')).toBeNull(); // 11 bytes
  });
  it('refuses an all-zero id, which is a read that failed halfway', () => {
    expect(normalizeTagUid('00000000')).toBeNull();
  });
});

describe('link tokens', () => {
  it('makes a token its own normalizer accepts', () => {
    const token = newLinkToken();
    expect(token).toHaveLength(24);
    expect(normalizeLinkToken(token)).toBe(token);
  });
  it('uses the draw it is given', () => {
    expect(newLinkToken(() => 0)).toBe('a'.repeat(24));
  });
  it('normalizes case and refuses short or odd tokens', () => {
    expect(normalizeLinkToken('  ABCDEFGHIJKLMNOP1234 ')).toBe('abcdefghijklmnop1234');
    expect(normalizeLinkToken('short')).toBeNull();
    expect(normalizeLinkToken('has space in it 12345678')).toBeNull();
    expect(normalizeLinkToken(undefined)).toBeNull();
  });
  it('builds the link through /open/ and refuses without a host or token', () => {
    const token = 'abcdefghijklmnop1234';
    expect(keyLinkUrl(token, ['example.dev'])).toBe(`https://example.dev/open/key?token=${token}`);
    expect(keyLinkUrl(token, [])).toBeNull();
    expect(keyLinkUrl('nope', ['example.dev'])).toBeNull();
  });
});

describe('cleanKeyName', () => {
  it('trims, collapses spaces and caps the length', () => {
    expect(cleanKeyName('  Desk   tag ', 'Key')).toBe('Desk tag');
    expect(cleanKeyName('x'.repeat(100), 'Key')).toHaveLength(40);
  });
  it('falls back when nothing is left', () => {
    expect(cleanKeyName('   ', 'Key tag')).toBe('Key tag');
  });
});

describe('parseNfcKeys', () => {
  it('round-trips and re-normalizes the secret', () => {
    const raw = JSON.stringify([key({ secret: '04a1b2c3' })]);
    expect(parseNfcKeys(raw)).toEqual([key({ secret: '04A1B2C3' })]);
  });
  it('drops malformed rows instead of throwing', () => {
    const raw = JSON.stringify([
      key(), { id: 1 }, null, key({ id: 'bad', kind: 'tag', secret: 'xyz' }),
      key({ id: 'odd', kind: 'other' as never }),
    ]);
    expect(parseNfcKeys(raw).map(k => k.id)).toEqual(['k1']);
  });
  it('reads garbage and nothing as no keys', () => {
    expect(parseNfcKeys('{not json')).toEqual([]);
    expect(parseNfcKeys('{"a":1}')).toEqual([]);
    expect(parseNfcKeys(null)).toEqual([]);
  });
  it('keeps at most the cap', () => {
    const many = Array.from({ length: MAX_NFC_KEYS + 3 }, (_, i) => key({ id: `k${i}`, secret: `04A1B2C3${i.toString(16).padStart(2, '0')}` }));
    expect(parseNfcKeys(JSON.stringify(many))).toHaveLength(MAX_NFC_KEYS);
  });
});

describe('withKeyAdded / withKeyRemoved', () => {
  it('adds a new key', () => {
    const result = withKeyAdded([], key());
    expect(result).toEqual({ ok: true, keys: [key()] });
  });
  it('refuses a duplicate of the same kind, but not the same text under another kind', () => {
    expect(withKeyAdded([key()], key({ id: 'k2' }))).toEqual({ ok: false, reason: 'duplicate' });
    const link = key({ id: 'k2', kind: 'link', secret: 'abcdefghijklmnop1234' });
    expect(withKeyAdded([key()], link).ok).toBe(true);
  });
  it('refuses past the cap', () => {
    const full = Array.from({ length: MAX_NFC_KEYS }, (_, i) => key({ id: `k${i}`, secret: `04A1B2C3${i.toString(16).padStart(2, '0')}` }));
    expect(withKeyAdded(full, key({ id: 'new', secret: 'FFFFFFFF' }))).toEqual({ ok: false, reason: 'full' });
  });
  it('removes by id', () => {
    expect(withKeyRemoved([key(), key({ id: 'k2', secret: 'AABBCCDD' })], 'k1').map(k => k.id)).toEqual(['k2']);
  });
});

describe('matchKey', () => {
  const keys = [key(), key({ id: 'k2', kind: 'link', secret: 'abcdefghijklmnop1234' })];
  it('matches a tag read in any spelling', () => {
    expect(matchKey(keys, 'tag', '04:a1:b2:c3:d4:e5:f6')?.id).toBe('k1');
  });
  it('matches a link token', () => {
    expect(matchKey(keys, 'link', 'ABCDEFGHIJKLMNOP1234')?.id).toBe('k2');
  });
  it('does not cross kinds', () => {
    expect(matchKey(keys, 'link', '04A1B2C3D4E5F6')).toBeNull();
    expect(matchKey(keys, 'tag', 'abcdefghijklmnop1234')).toBeNull();
  });
  it('matches nothing for an unknown or empty read', () => {
    expect(matchKey(keys, 'tag', 'AABBCCDD')).toBeNull();
    expect(matchKey(keys, 'tag', null)).toBeNull();
    expect(matchKey([], 'tag', '04A1B2C3D4E5F6')).toBeNull();
  });
});

describe('the lock', () => {
  it('can be raised only with a key to end it', () => {
    expect(canLock([])).toBe(false);
    expect(canLock([key()])).toBe(true);
  });
  it('flips on a scan', () => {
    expect(nextKeyLock(false)).toBe(true);
    expect(nextKeyLock(true)).toBe(false);
  });
  it('comes down with the last key rather than being stranded', () => {
    expect(lockAfterRemoval([], true)).toBe(false);
    expect(lockAfterRemoval([key()], true)).toBe(true);
    expect(lockAfterRemoval([key()], false)).toBe(false);
  });
});
