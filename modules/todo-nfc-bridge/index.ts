import { Platform } from 'react-native';
import { requireNativeModule } from 'expo-modules-core';

/**
 * iOS Core NFC, as much of it as a key tag needs: whether this phone can read
 * tags, and one scan that answers with the first tag's hardware id.
 *
 * Resolved lazily and every export degrades to its "unavailable" answer, the
 * `todo-screentime-bridge` shape and for the same reason: resolving is not the
 * same as working, and the caller is a settings tap where a TypeError off a
 * half-registered module would take the screen down.
 *
 * Foreground only. A tag tapped with the app closed never reaches this module;
 * iOS reads an https tag itself and opens the app on its link.
 */

interface TodoNfcNativeModule {
  isAvailable(): boolean;
  scanTag(prompt: string): Promise<string>;
}

let nativeModule: TodoNfcNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoNfcNativeModule>('TodoNfcBridge');
  } catch {
    nativeModule = null;
  }
}

/** Whether this build, on this phone, can read a tag at all. */
export function isNfcAvailable(): boolean {
  if (!nativeModule) return false;
  try {
    return nativeModule.isAvailable() === true;
  } catch (error) {
    console.warn('[todo-nfc-bridge] native call failed; treating NFC as unavailable', error);
    return false;
  }
}

/**
 * Raise the system scan sheet and resolve with the native answer as it is:
 * `uid:<HEX>`, `ended` or `unavailable`. Parsed in `src/utils/nfcBridge.ts`
 * (`scanKeyTag`), which keeps that rule testable without this module.
 */
export async function scanTag(prompt: string): Promise<string> {
  if (!nativeModule) return 'unavailable';
  try {
    return await nativeModule.scanTag(prompt);
  } catch (error) {
    console.warn('[todo-nfc-bridge] native call failed; treating the scan as ended', error);
    return 'ended';
  }
}
