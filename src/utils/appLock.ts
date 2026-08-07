/**
 * App lock — the pure half of "require Face ID to open".
 *
 * Everything the app knows sits unencrypted in a SQLite file on the device, so
 * an unlocked phone hands over the whole task list. This gates the UI behind
 * the device owner's own biometrics (see appLockAuth.ts for the native half and
 * useAppLockStore for the session state); the decisions that can be tested
 * without a device live here.
 *
 * **The grace period is the whole feature.** A lock that re-prompts every time
 * you flick to Messages and back is the one people turn off after a day, and an
 * app lock that's off protects nothing. So leaving the app starts a clock, and
 * coming back only re-locks once it has run out.
 */

/**
 * How long the app may sit in the background before it locks again, in seconds.
 *
 * Seconds rather than minutes because 0 ("Immediately") has to be sayable, and
 * a minute-granularity field would spell that as a magic null.
 */
export const APP_LOCK_GRACE_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Immediately' },
  { value: 60, label: '1 min' },
  { value: 300, label: '5 min' },
  { value: 900, label: '15 min' },
];

export const DEFAULT_APP_LOCK_GRACE_SECONDS = 60;

/** The Settings row's summary line. */
export function graceLabel(seconds: number): string {
  return (
    APP_LOCK_GRACE_OPTIONS.find(o => o.value === seconds)?.label ??
    graceLabel(DEFAULT_APP_LOCK_GRACE_SECONDS)
  );
}

/**
 * Parses the stored settings value. Anything unrecognised reads as the default
 * minute rather than as the largest window: a garbled value must never buy
 * someone a longer unlocked stretch than they asked for.
 */
export function parseGraceSeconds(raw: string | null): number {
  if (raw === null || raw === '') return DEFAULT_APP_LOCK_GRACE_SECONDS;
  const n = Number(raw);
  return APP_LOCK_GRACE_OPTIONS.some(o => o.value === n) ? n : DEFAULT_APP_LOCK_GRACE_SECONDS;
}

/**
 * Whether returning to the foreground should re-lock, given when the app last
 * stopped being active.
 *
 * `leftAt === null` means it never left — a cold start locks on its own (the
 * session simply starts locked), and an AppState event that isn't preceded by
 * a real departure isn't one to lock for.
 *
 * A clock that moved backwards while we were away locks. It's one Face ID
 * against a signal we can't trust, and the untrusted direction is the one that
 * hands out free unlocked time.
 */
export function shouldLockOnResume(
  leftAt: number | null,
  now: number,
  graceSeconds: number
): boolean {
  if (leftAt === null) return false;
  const elapsed = now - leftAt;
  if (elapsed < 0) return true;
  return elapsed >= graceSeconds * 1000;
}

// AuthenticationType from expo-local-authentication, inlined so this module
// stays free of the native import (and so its tests do too).
const FINGERPRINT = 1;
const FACIAL_RECOGNITION = 2;

/**
 * What to call the thing in the Settings row and the unlock prompt. Face ID and
 * Touch ID are the names on the device, and a row offering "biometrics" reads
 * like it belongs to a different phone — so the label comes from what the
 * hardware actually reports, falling back to the platform's usual name rather
 * than to a generic word.
 */
export function biometryLabel(types: number[], isIOS: boolean): string {
  if (types.includes(FACIAL_RECOGNITION)) return isIOS ? 'Face ID' : 'face unlock';
  if (types.includes(FINGERPRINT)) return isIOS ? 'Touch ID' : 'fingerprint';
  return isIOS ? 'Face ID' : 'biometrics';
}
