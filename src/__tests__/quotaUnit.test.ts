import {
  MAX_TARGET_UNIT_LENGTH,
  normalizeTargetUnit,
  formatQuotaProgress,
  formatQuotaTarget,
} from '../utils/quotaUnit';

describe('normalizeTargetUnit', () => {
  it('keeps a typed unit as typed', () => {
    expect(normalizeTargetUnit('8oz glasses')).toBe('8oz glasses');
  });

  it('treats nothing, blank and whitespace as no unit', () => {
    expect(normalizeTargetUnit(null)).toBeNull();
    expect(normalizeTargetUnit(undefined)).toBeNull();
    expect(normalizeTargetUnit('')).toBeNull();
    expect(normalizeTargetUnit('   ')).toBeNull();
  });

  it('trims and collapses whitespace', () => {
    expect(normalizeTargetUnit('  8oz   glasses  ')).toBe('8oz glasses');
  });

  it('caps the length, and never leaves the cut edge trailing a space', () => {
    const long = 'a'.repeat(MAX_TARGET_UNIT_LENGTH + 10);
    expect(normalizeTargetUnit(long)).toHaveLength(MAX_TARGET_UNIT_LENGTH);
    // The slice lands mid-gap here; the result must not end in a space.
    const cut = normalizeTargetUnit(`${'a'.repeat(MAX_TARGET_UNIT_LENGTH - 1)} bbbb`);
    expect(cut).toBe('a'.repeat(MAX_TARGET_UNIT_LENGTH - 1));
  });
});

describe('formatQuotaProgress', () => {
  it('reads as the bare count when there is no unit', () => {
    expect(formatQuotaProgress(5, 12, null)).toBe('5/12');
    expect(formatQuotaProgress(5, 12, '  ')).toBe('5/12');
  });

  it('puts the unit after the count', () => {
    expect(formatQuotaProgress(5, 12, '8oz glasses')).toBe('5/12 8oz glasses');
  });

  it('does not switch to a singular at one — the noun goes with the target', () => {
    expect(formatQuotaProgress(1, 12, 'glasses')).toBe('1/12 glasses');
  });

  it('normalizes on the way out, so an unclean stored value still reads right', () => {
    expect(formatQuotaProgress(0, 8, ' reps ')).toBe('0/8 reps');
  });
});

describe('formatQuotaTarget', () => {
  it('keeps the × that makes a bare number read as a count', () => {
    expect(formatQuotaTarget(12, null)).toBe('12×');
  });

  it('drops the × once the unit says what is being counted', () => {
    expect(formatQuotaTarget(12, 'glasses')).toBe('12 glasses');
  });
});
