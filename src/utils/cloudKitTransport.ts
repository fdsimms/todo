/**
 * The CloudKit SyncTransport (#1551).
 *
 * All the adapter turned out to be: two methods forwarding to the native
 * bridge. That is the payoff for building the merge rules, the apply engine
 * and the sync loop first — none of them know CloudKit exists, and swapping
 * this out for something else would touch nothing but this file.
 *
 * The native module is reached through `require` rather than a static import,
 * the same way widgetSync.ts and liveActivity.ts reach theirs: a static import
 * is hoisted and evaluated before any statement in this module runs, so on a
 * build without the native half it would throw at module scope and take the
 * whole bundle down. See index.js for what that failure looks like.
 */
import type { PullResult, SyncTransport } from './syncEngine';

type Bridge = typeof import('todo-cloudkit-bridge');

function bridge(): Bridge | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('todo-cloudkit-bridge') as Bridge;
  } catch {
    return null;
  }
}

export const CLOUDKIT_SOURCE = 'cloudkit';

/** Whether this build can sync at all. Not whether iCloud is signed in. */
export function isCloudKitSyncAvailable(): boolean {
  return bridge()?.isCloudKitAvailable() ?? false;
}

/**
 * Why sync isn't running, in the app's own words.
 *
 * Returns null when everything is fine. Separate from the transport because
 * this is the answer a settings screen needs *before* a sync is attempted —
 * "sign in to iCloud" is not an error to be retried, it is a thing for the
 * user to do.
 */
export async function cloudKitUnavailableReason(): Promise<string | null> {
  const b = bridge();
  if (!b || !b.isCloudKitAvailable()) return 'This build of the app cannot sync.';

  const status = await b.cloudKitAccountStatus();
  switch (status) {
    case 'available':
      return null;
    case 'noAccount':
      return 'Sign in to iCloud on this device to sync.';
    case 'restricted':
      return 'iCloud is restricted on this device.';
    case 'temporarilyUnavailable':
      return 'iCloud is temporarily unavailable. Sync will resume on its own.';
    default:
      return 'Could not reach iCloud.';
  }
}

export function cloudKitTransport(): SyncTransport {
  return {
    name: CLOUDKIT_SOURCE,

    async push(payload: string): Promise<void> {
      const b = bridge();
      if (!b) throw new Error('CloudKit is not available in this build.');
      await b.pushPayload(payload);
    },

    async pull(since: string | null): Promise<PullResult> {
      const b = bridge();
      if (!b) throw new Error('CloudKit is not available in this build.');
      const result = await b.pullPayloads(since);
      return { payloads: result.payloads, cursor: result.cursor };
    },
  };
}
