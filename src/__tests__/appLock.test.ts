import {
  APP_LOCK_GRACE_OPTIONS,
  DEFAULT_APP_LOCK_GRACE_SECONDS,
  biometryLabel,
  graceLabel,
  parseGraceSeconds,
  shouldLockOnResume,
} from '../utils/appLock';

// ─── parseGraceSeconds ───────────────────────────────────────────────────────

describe('parseGraceSeconds', () => {
  it('defaults to a minute when nothing is stored', () => {
    expect(parseGraceSeconds(null)).toBe(DEFAULT_APP_LOCK_GRACE_SECONDS);
    expect(parseGraceSeconds('')).toBe(DEFAULT_APP_LOCK_GRACE_SECONDS);
  });

  it('reads back every offered option', () => {
    for (const opt of APP_LOCK_GRACE_OPTIONS) {
      expect(parseGraceSeconds(String(opt.value))).toBe(opt.value);
    }
  });

  it('keeps "Immediately" distinct from an empty value', () => {
    expect(parseGraceSeconds('0')).toBe(0);
  });

  // A garbled value must not buy a longer unlocked stretch than was asked for.
  it('falls back to the default rather than to the longest window', () => {
    expect(parseGraceSeconds('banana')).toBe(DEFAULT_APP_LOCK_GRACE_SECONDS);
    expect(parseGraceSeconds('86400')).toBe(DEFAULT_APP_LOCK_GRACE_SECONDS);
    expect(parseGraceSeconds('-1')).toBe(DEFAULT_APP_LOCK_GRACE_SECONDS);
  });
});

describe('graceLabel', () => {
  it('names each option', () => {
    expect(graceLabel(0)).toBe('Immediately');
    expect(graceLabel(60)).toBe('1 min');
    expect(graceLabel(900)).toBe('15 min');
  });

  it('falls back to the default option for an unknown value', () => {
    expect(graceLabel(12345)).toBe(graceLabel(DEFAULT_APP_LOCK_GRACE_SECONDS));
  });
});

// ─── shouldLockOnResume ──────────────────────────────────────────────────────

describe('shouldLockOnResume', () => {
  const NOW = 1_700_000_000_000;

  it('does not lock when the app never left', () => {
    expect(shouldLockOnResume(null, NOW, 0)).toBe(false);
  });

  it('does not lock inside the grace period', () => {
    expect(shouldLockOnResume(NOW - 30_000, NOW, 60)).toBe(false);
  });

  it('locks once the grace period has run out', () => {
    expect(shouldLockOnResume(NOW - 61_000, NOW, 60)).toBe(true);
  });

  it('locks exactly at the boundary', () => {
    expect(shouldLockOnResume(NOW - 60_000, NOW, 60)).toBe(true);
  });

  it('locks on any departure at all when the grace period is zero', () => {
    expect(shouldLockOnResume(NOW, NOW, 0)).toBe(true);
  });

  // The one signal we can't trust is worth a single Face ID.
  it('locks when the clock moved backwards while away', () => {
    expect(shouldLockOnResume(NOW + 5_000, NOW, 900)).toBe(true);
  });
});

// ─── biometryLabel ───────────────────────────────────────────────────────────

describe('biometryLabel', () => {
  const FINGERPRINT = 1;
  const FACIAL_RECOGNITION = 2;

  it('names Face ID and Touch ID on iOS', () => {
    expect(biometryLabel([FACIAL_RECOGNITION], true)).toBe('Face ID');
    expect(biometryLabel([FINGERPRINT], true)).toBe('Touch ID');
  });

  it('prefers face over fingerprint when the device reports both', () => {
    expect(biometryLabel([FINGERPRINT, FACIAL_RECOGNITION], true)).toBe('Face ID');
  });

  it('falls back to the platform name when nothing is reported', () => {
    expect(biometryLabel([], true)).toBe('Face ID');
    expect(biometryLabel([], false)).toBe('biometrics');
  });

  it('uses generic names off iOS', () => {
    expect(biometryLabel([FACIAL_RECOGNITION], false)).toBe('face unlock');
    expect(biometryLabel([FINGERPRINT], false)).toBe('fingerprint');
  });
});
