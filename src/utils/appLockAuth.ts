/**
 * The native half of the app lock — everything that talks to
 * expo-local-authentication. The decisions live in appLock.ts so they can be
 * tested; this file is the thin part, mirroring how remindersImportSync.ts sits
 * in front of expo-calendar.
 */

import { Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { biometryLabel } from './appLock';

/**
 * What the device can actually authenticate with:
 *
 * - `biometric` — Face ID / Touch ID enrolled. The intended case.
 * - `passcode`  — no biometrics, but a device passcode is set, which
 *   authenticateAsync falls back to on its own.
 * - `none`      — nothing enrolled at all. There is no way to *pass* a prompt,
 *   so a lock in this state is a locked-out app, not a secure one.
 * - `unsupported` — no biometric hardware and no way to ask.
 */
export type AppLockCapability = 'biometric' | 'passcode' | 'none' | 'unsupported';

export interface AppLockSupport {
  capability: AppLockCapability;
  /** "Face ID", "Touch ID", … — what to call it in the UI. */
  label: string;
}

export async function getAppLockSupport(): Promise<AppLockSupport> {
  const isIOS = Platform.OS === 'ios';
  try {
    const [hasHardware, types, level] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
    ]);
    const label = biometryLabel(types, isIOS);

    // SECRET is a PIN/pattern/passcode; anything above it is a biometric. The
    // enrolled *level* is what matters rather than hasHardware alone — a phone
    // with a Face ID sensor nobody has enrolled a face on can still be
    // unlocked, just by passcode.
    if (level >= LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK) {
      return { capability: 'biometric', label };
    }
    if (level === LocalAuthentication.SecurityLevel.SECRET) {
      return { capability: 'passcode', label };
    }
    return { capability: hasHardware ? 'none' : 'unsupported', label };
  } catch {
    return { capability: 'unsupported', label: biometryLabel([], isIOS) };
  }
}

export type UnlockResult =
  /** Authenticated. */
  | 'success'
  /** Dismissed, failed, or cancelled — stay locked and offer another go. */
  | 'denied'
  /**
   * Nothing on this device can answer the prompt. The lock has to open: there
   * is no second way in, and a permanently sealed task list is a worse outcome
   * than an unlocked one on a phone whose owner has turned off every lock the
   * OS offers. The caller says so out loud rather than opening quietly.
   */
  | 'unavailable';

export async function authenticateForAppLock(promptMessage: string): Promise<UnlockResult> {
  const support = await getAppLockSupport();
  if (support.capability === 'none' || support.capability === 'unsupported') return 'unavailable';

  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      // Deliberately left at the default (false) so iOS offers the device
      // passcode after failed biometrics. That fallback is the only thing
      // standing between a scratched sensor and a task list nobody can open.
      disableDeviceFallback: false,
    });
    if (result.success) return 'success';
    // not_enrolled / passcode_not_set can appear between the capability check
    // above and the prompt (biometrics removed in Settings mid-session), and
    // they mean the same thing it does: there's nothing left to authenticate
    // against.
    if (result.error === 'not_enrolled' || result.error === 'passcode_not_set') return 'unavailable';
    return 'denied';
  } catch {
    return 'denied';
  }
}
