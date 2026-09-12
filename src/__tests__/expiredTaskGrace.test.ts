import {
  EXPIRED_TASK_GRACE_OPTIONS,
  expiredTaskGraceLabel,
  parseExpiredTaskGrace,
  serializeExpiredTaskGrace,
} from '../utils/expiredTaskGrace';

describe('expiredTaskGraceLabel', () => {
  it('names each offered value', () => {
    expect(expiredTaskGraceLabel(null)).toBe('Never');
    expect(expiredTaskGraceLabel(0)).toBe('Immediately');
    expect(expiredTaskGraceLabel(7)).toBe('7 days');
  });

  it('falls back to Never for a value nothing offers', () => {
    expect(expiredTaskGraceLabel(3)).toBe('Never');
  });
});

describe('parseExpiredTaskGrace', () => {
  // The setting was a boolean before it was a duration, and it is still read
  // from the same key, so an existing install must not change behaviour on
  // upgrade.
  it("reads the legacy 'true' as deleting on window close", () => {
    expect(parseExpiredTaskGrace('true')).toBe(0);
  });

  it("reads the legacy 'false' as keeping forever", () => {
    expect(parseExpiredTaskGrace('false')).toBeNull();
  });

  it('reads an unset value as keeping forever', () => {
    expect(parseExpiredTaskGrace(null)).toBeNull();
    expect(parseExpiredTaskGrace('')).toBeNull();
  });

  it('reads a day count it offers', () => {
    expect(parseExpiredTaskGrace('30')).toBe(30);
    expect(parseExpiredTaskGrace('0')).toBe(0);
  });

  // A garbled value has to fail toward keeping tasks, never toward deleting
  // them: this is the one sweep with no way back.
  it('reads anything unrecognised as keeping forever', () => {
    expect(parseExpiredTaskGrace('banana')).toBeNull();
    expect(parseExpiredTaskGrace('3')).toBeNull();
    expect(parseExpiredTaskGrace('-1')).toBeNull();
  });
});

describe('serializeExpiredTaskGrace', () => {
  it('writes Never as an empty string', () => {
    expect(serializeExpiredTaskGrace(null)).toBe('');
  });

  it('writes a day count as its digits', () => {
    expect(serializeExpiredTaskGrace(0)).toBe('0');
    expect(serializeExpiredTaskGrace(30)).toBe('30');
  });

  it('round-trips every value the settings row can pick', () => {
    for (const option of EXPIRED_TASK_GRACE_OPTIONS) {
      expect(parseExpiredTaskGrace(serializeExpiredTaskGrace(option.value))).toBe(option.value);
    }
  });
});
