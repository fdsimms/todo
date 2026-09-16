import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

interface TodoPrivacyShieldNativeModule {
  isAvailable(): boolean;
  setEnabled(enabled: boolean): void;
}

// Same lazy resolve the other bridges here use, for the same reason:
// requireNativeModule throws outright when the module isn't linked (Android,
// web, Expo Go without a dev build), so resolving it once lets the exports
// below stay plain functions that do nothing rather than throwing into a
// caller with no branch for it.
let nativeModule: TodoPrivacyShieldNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoPrivacyShieldNativeModule>('TodoPrivacyShield');
  } catch {
    nativeModule = null;
  }
}

export function isPrivacyShieldAvailable(): boolean {
  if (!nativeModule) return false;
  try {
    return nativeModule.isAvailable() === true;
  } catch {
    return false;
  }
}

/**
 * Whether the app covers its own window while it isn't frontmost.
 *
 * On is `appLockEnabled`, and off again while the unlock prompt is up — iOS
 * reports the app inactive for the Face ID sheet itself, and covering the app
 * behind the prompt that unlocks it is the one case this must not fire on.
 * `AppLockGate` owns both halves of that answer and hands it over, rather than
 * the native side working out a rule it would then hold a second copy of.
 *
 * Failing silently is the right degradation and not a shrug: the lock screen
 * itself is a React view that still works, so an unlinked module costs the
 * snapshot cover and nothing else. Throwing here would take `AppLockGate`'s
 * effect down with it, which would cost the lock too.
 *
 * **No demo-mode gate, and that is not an oversight.** The rule in CLAUDE.md is
 * about anything that writes outside the app's own database, or consumes a
 * queue into one about to be thrown away. This reads nothing and writes
 * nothing: it puts an opaque view over the app's own window and takes it off
 * again. There is no seeded fiction it could put somewhere the user sees with
 * the app closed, because it shows nothing at all.
 */
export function setPrivacyShieldEnabled(enabled: boolean): void {
  if (!nativeModule) return;
  try {
    nativeModule.setEnabled(enabled);
  } catch (error) {
    console.warn('[todo-privacy-shield] native call failed; the app-switcher cover is off', error);
  }
}
