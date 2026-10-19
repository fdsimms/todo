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
  /**
   * Each payload's record name, in the same order as `payloads`. Absent from
   * a build before compaction, which then never compacts.
   */
  ids?: string[];
  /** Payload records another device deleted since `since` (it compacted). */
  removed?: string[];
}

export interface CloudKitImageListResult {
  names: string[];
  /** Names another device deleted from the zone since the last listing. */
  removed: string[];
  /** A serialised CKServerChangeToken for the images zone, opaque like the payload one. */
  cursor: string | null;
}

interface Subscription {
  remove(): void;
}

interface TodoCloudKitNativeModule {
  isAvailable(): boolean;
  /** Optional: a build from before silent push has neither. */
  subscribeToChanges?(): Promise<void>;
  /** Optional: a build from before compaction has none, and never compacts. */
  removePayloads?(names: string[]): Promise<void>;
  remoteChangeHandled?(newData: boolean): void;
  addListener?(event: 'onRemoteChange', listener: () => void): Subscription;
  accountStatus(): Promise<CloudKitAccountStatus>;
  push(payload: string): Promise<void>;
  pull(since: string | null): Promise<CloudKitPullResult>;
  listImages(since: string | null): Promise<CloudKitImageListResult>;
  putImage(name: string, base64: string): Promise<void>;
  getImage(name: string): Promise<string | null>;
  removeImage(name: string): Promise<void>;
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

/** Whether this build can delete payload records, which compaction needs. */
export function canRemovePayloads(): boolean {
  return typeof nativeModule?.removePayloads === 'function';
}

/**
 * Deletes payload records by name. Names already gone succeed. Throws on
 * anything else, so the caller keeps the names and tries again later.
 */
export async function removePayloads(names: string[]): Promise<void> {
  if (!nativeModule?.removePayloads) throw new Error('This build can’t compact the sync history.');
  await nativeModule.removePayloads(names);
}

/**
 * Recipe photos live in a zone of their own (`TodoImages`), one record per
 * photo named by its filename, so a build that predates them never sees one:
 * its pull reads the payload zone only and fails on a record with no payload.
 */
export async function listImages(since: string | null): Promise<CloudKitImageListResult> {
  if (!nativeModule) throw new Error('CloudKit is not available in this build.');
  return nativeModule.listImages(since);
}

/** Saving a name the zone already holds succeeds without changing it. */
export async function putImage(name: string, base64: string): Promise<void> {
  if (!nativeModule) throw new Error('CloudKit is not available in this build.');
  await nativeModule.putImage(name, base64);
}

/** Null when the zone has no photo under that name. */
export async function getImage(name: string): Promise<string | null> {
  if (!nativeModule) throw new Error('CloudKit is not available in this build.');
  return nativeModule.getImage(name);
}

/** Removing a name the zone no longer holds succeeds. */
export async function removeImage(name: string): Promise<void> {
  if (!nativeModule) throw new Error('CloudKit is not available in this build.');
  await nativeModule.removeImage(name);
}

/**
 * Has CloudKit send a silent push when another device saves a payload. Safe to
 * call on every launch. Resolves false on a build without it, or when CloudKit
 * refused; sync still runs on its foreground timer either way.
 */
export async function subscribeToChanges(): Promise<boolean> {
  if (!nativeModule?.subscribeToChanges) return false;
  try {
    await nativeModule.subscribeToChanges();
    return true;
  } catch (error) {
    console.warn('[todo-cloudkit-bridge] could not subscribe to changes', error);
    return false;
  }
}

/**
 * Called when a silent push says another device saved a payload. Returns the
 * unsubscribe. The listener must end with `remoteChangeHandled`.
 */
export function addRemoteChangeListener(listener: () => void): () => void {
  if (!nativeModule || typeof nativeModule.addListener !== 'function') return () => {};
  try {
    const subscription = nativeModule.addListener('onRemoteChange', () => listener());
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

/** The sync a silent push started is over; lets iOS stop holding the app awake for it. */
export function remoteChangeHandled(newData: boolean): void {
  try {
    nativeModule?.remoteChangeHandled?.(newData);
  } catch {
    // The native side finishes it on a timer anyway.
  }
}
