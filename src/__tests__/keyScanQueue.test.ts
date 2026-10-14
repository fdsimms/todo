import { keyCodeToken, parseQueuedKeyScans, QUEUED_KEY_CODE_MAX_LENGTH } from '../utils/keyScanQueue';

describe('parseQueuedKeyScans', () => {
  it('reads a code and the moment it ran', () => {
    const [scan] = parseQueuedKeyScans('[{"code":"abcdefghij0123456789","at":"2026-10-14T08:00:00Z"}]');
    expect(scan.code).toBe('abcdefghij0123456789');
    expect(scan.at?.toISOString()).toBe('2026-10-14T08:00:00.000Z');
  });

  it('trims the code and keeps a scan whose time did not parse', () => {
    expect(parseQueuedKeyScans('[{"code":"  abc ","at":"nonsense"}]')).toEqual([{ code: 'abc', at: null }]);
    expect(parseQueuedKeyScans('[{"code":"abc"}]')).toEqual([{ code: 'abc', at: null }]);
  });

  it('drops anything malformed rather than throwing', () => {
    expect(parseQueuedKeyScans('')).toEqual([]);
    expect(parseQueuedKeyScans('not json')).toEqual([]);
    expect(parseQueuedKeyScans('{"code":"x"}')).toEqual([]);
    expect(parseQueuedKeyScans('[null, 3, {"code":5}, {"code":"   "}, {"at":"2026-10-14T08:00:00Z"}]')).toEqual([]);
  });

  it('keeps the good records around a bad one, in order', () => {
    expect(parseQueuedKeyScans('[{"code":"one"},{"code":7},{"code":"two"}]').map(s => s.code)).toEqual(['one', 'two']);
  });

  it('caps a runaway code', () => {
    const [scan] = parseQueuedKeyScans(JSON.stringify([{ code: 'x'.repeat(QUEUED_KEY_CODE_MAX_LENGTH + 50) }]));
    expect(scan.code).toHaveLength(QUEUED_KEY_CODE_MAX_LENGTH);
  });
});

describe('keyCodeToken', () => {
  it('passes a bare code through', () => {
    expect(keyCodeToken('  abcdefghij0123456789 ')).toBe('abcdefghij0123456789');
  });

  it('reads the token out of a pasted link', () => {
    expect(keyCodeToken('https://example.com/open/key?token=abcdefghij0123456789')).toBe('abcdefghij0123456789');
    expect(keyCodeToken('dundundun://key?x=1&token=abcdefghij0123456789#top')).toBe('abcdefghij0123456789');
  });
});
