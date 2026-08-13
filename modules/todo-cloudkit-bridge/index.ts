import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type CloudKitAccountStatus =
  | 'available'
  | 'noAccount'
  | 'restricted'
  | 'couldNotDetermine'
  | 'temporarilyUnavailable'
  | 'unavailable';

export interface CloudKitPullResult {
  payloads: string[];
  /**
   * A serialised CKServerChangeToken, opaque to JavaScript. Handed straight
   * back on the next pull and never parsed — see the cursor note in
   * src/utils/syncEngine.ts.
   */
  cursor: string | null;
}

interface TodoCloudKitNativeModule {
  isAvailable(): boolean;
  accountStatus(): Promise<CloudKitAccountStatus>;
  push(payload: string): Promise<void>;
  pull(since: string | null): Promise<CloudKitPullResult>;
}

// Same lazy resolve as todo-alarmkit-bridge, for the same reason:
// requireNativeModule throws at module scope when the native half isn't in the
// binary (Android, web, a build predating this module), and a module-scope
// throw takes the whole bundle down before React exists. See index.js.
let nativeModule: TodoCloudKitNativeModule | null = null;
if (Platform.OS === 'ios') {
  try {
    nativeModule = requireNativeModule<TodoCloudKitNativeModule>('TodoCloudKit');
  } catch {
    nativeModule = null;
  }
}

/** Whether the native half is present at all. Not whether iCloud is usable. */
export function isCloudKitAvailable(): boolean {
  if (!nativeModule) return false;
  try {
    return nativeModule.isAvailable();
  } catch (error) {
    console.warn('[todo-cloudkit-bridge] native call failed; treating CloudKit as unavailable', error);
    return false;
  }
}

/**
 * Whether the signed-in Apple ID can actually be used.
 *
 * Distinct from isCloudKitAvailable on purpose: the module can be present and
 * working while the user is signed out, and those two need different answers
 * on screen — "this build doesn't support sync" versus "sign in to iCloud".
 */
export async function cloudKitAccountStatus(): Promise<CloudKitAccountStatus> {
  if (!nativeModule) return 'unavailable';
  try {
    return await nativeModule.accountStatus();
  } catch {
    return 'couldNotDetermine';
  }
}

/**
 * Errors are deliberately *not* swallowed here, unlike the alarm bridge.
 *
 * A failed alarm is one missed reminder and the app carries on; a push that
 * silently reports success would advance the sync cursor past changes that
 * never left the device, and nothing would ever retry them. The sync engine
 * catches these and leaves its cursor alone — see runSync.
 */
export async function pushPayload(payload: string): Promise<void> {
  if (!nativeModule) throw new Error('CloudKit is not available in this build.');
  await nativeModule.push(payload);
}

export async function pullPayloads(since: string | null): Promise<CloudKitPullResult> {
  if (!nativeModule) throw new Error('CloudKit is not available in this build.');
  return nativeModule.pull(since);
}
