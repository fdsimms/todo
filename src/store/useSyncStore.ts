/**
 * Sync state, and the one place a sync is ever started (#1551).
 *
 * Thin on purpose. Everything that decides what happens is already tested
 * elsewhere — the merge rules in utils/syncMerge, the loop in utils/syncEngine,
 * the transport in utils/cloudKitTransport. What lives here is the state a
 * screen can render and the guard against two syncs running at once.
 *
 * **Opt-in, and off by default.** This is the only feature in the app that
 * sends user data anywhere except the one AI call, so it does nothing at all
 * until the user turns it on. The flag is a settings row (`syncEnabled`),
 * which is deliberately *not* on the allowlist of settings that sync — a
 * device must not be able to switch the feature on for another one.
 */
import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { cloudKitTransport, cloudKitUnavailableReason, isCloudKitSyncAvailable } from '../utils/cloudKitTransport';
import { databaseSyncLocal } from '../utils/syncLocal';
import { runSync, type SyncRunResult } from '../utils/syncEngine';
import { describeApply } from '../utils/syncMerge';

const ENABLED_KEY = 'syncEnabled';
const LAST_SYNCED_KEY = 'syncLastSyncedAt';

export type SyncPhase = 'idle' | 'syncing';

interface SyncState {
  initialized: boolean;
  enabled: boolean;
  /** False when the build has no native module — not when iCloud is signed out. */
  supported: boolean;
  phase: SyncPhase;
  /** ISO timestamp of the last sync that completed without error. */
  lastSyncedAt: string | null;
  /** Why the last attempt failed, or why sync can't run. Null when fine. */
  problem: string | null;
  /** What the last successful sync brought in, for the status line. */
  lastSummary: string | null;

  initialize: () => void;
  setEnabled: (enabled: boolean) => Promise<void>;
  /** Runs a sync if one isn't already running. Safe to call on every foreground. */
  syncNow: () => Promise<SyncRunResult | null>;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  initialized: false,
  enabled: false,
  supported: false,
  phase: 'idle',
  lastSyncedAt: null,
  problem: null,
  lastSummary: null,

  initialize: () => {
    set({
      initialized: true,
      enabled: dbGetSetting(ENABLED_KEY) === '1',
      supported: isCloudKitSyncAvailable(),
      lastSyncedAt: dbGetSetting(LAST_SYNCED_KEY),
    });
  },

  setEnabled: async (enabled: boolean) => {
    dbSetSetting(ENABLED_KEY, enabled ? '1' : '0');
    set({ enabled, problem: null });

    if (!enabled) return;

    // Check the account the moment it's switched on rather than waiting for
    // the first sync to fail: "sign in to iCloud" is something for the user to
    // do, and the moment they asked for sync is when they're able to do it.
    const reason = await cloudKitUnavailableReason();
    if (reason) {
      set({ problem: reason });
      return;
    }
    await get().syncNow();
  },

  syncNow: async () => {
    const { enabled, phase } = get();
    if (!enabled || phase === 'syncing') return null;

    set({ phase: 'syncing' });
    try {
      const result = await runSync(cloudKitTransport(), databaseSyncLocal());

      if (result.status === 'ok') {
        const now = new Date().toISOString();
        dbSetSetting(LAST_SYNCED_KEY, now);
        set({
          lastSyncedAt: now,
          problem: result.unreadable > 0
            ? 'Some changes need a newer version of the app.'
            : null,
          lastSummary: describeApply(result.applied),
        });
      } else if (result.status === 'failed') {
        set({ problem: result.reason ?? 'Sync failed.' });
      }
      // 'skipped' means demo mode. Not a problem and not worth reporting —
      // the user swapped their data out themselves.

      return result;
    } finally {
      set({ phase: 'idle' });
    }
  },
}));

/**
 * Whether the sync feature should appear at all.
 *
 * Kept separate from the store's `supported` so a screen can ask before the
 * store has initialized.
 */
export function isSyncSupported(): boolean {
  return isCloudKitSyncAvailable();
}
