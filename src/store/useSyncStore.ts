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
import { httpSyncTransport, isHttpSyncConfigured } from '../utils/httpSyncTransport';
import { loadSecureKey, saveSecureKey, SYNC_TOKEN_SECURE_KEY } from '../utils/secureApiKey';
import { databaseSyncLocal } from '../utils/syncLocal';
import { runSyncAll, summarizeRuns, type SyncSummary, type SyncTransport } from '../utils/syncEngine';
import { describeApply } from '../utils/syncMerge';

const ENABLED_KEY = 'syncEnabled';
const LAST_SYNCED_KEY = 'syncLastSyncedAt';
const SERVER_URL_KEY = 'syncServerUrl';

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

  /**
   * The payload store's origin, or '' for none. Its token lives in the
   * keychain, never here and never in the settings table — it is a credential,
   * and `secureApiKey.ts` is where this app puts those.
   */
  serverUrl: string;
  /** Whether a token is stored, which is all a settings row may say about one. */
  hasServerToken: boolean;

  initialize: () => void;
  setEnabled: (enabled: boolean) => Promise<void>;
  setServerUrl: (url: string) => void;
  setServerToken: (token: string) => Promise<boolean>;
  /** Runs a sync if one isn't already running. Safe to call on every foreground. */
  syncNow: () => Promise<SyncSummary | null>;
}

/**
 * The transports this device is set up for, in the order they run.
 *
 * iCloud first because it is the one most users have and the one whose failure
 * is most likely to be transient; a server the user runs is the one they can go
 * and restart. Neither depends on the other, and either may be absent.
 */
async function configuredTransports(state: { enabled: boolean; serverUrl: string }): Promise<SyncTransport[]> {
  const transports: SyncTransport[] = [];
  if (state.enabled && isCloudKitSyncAvailable()) transports.push(cloudKitTransport());

  const token = await loadSecureKey(SYNC_TOKEN_SECURE_KEY);
  const config = { url: state.serverUrl, token };
  if (isHttpSyncConfigured(config)) transports.push(httpSyncTransport(config));

  return transports;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  initialized: false,
  enabled: false,
  supported: false,
  phase: 'idle',
  lastSyncedAt: null,
  problem: null,
  lastSummary: null,

  serverUrl: '',
  hasServerToken: false,

  initialize: () => {
    set({
      initialized: true,
      enabled: dbGetSetting(ENABLED_KEY) === '1',
      supported: isCloudKitSyncAvailable(),
      lastSyncedAt: dbGetSetting(LAST_SYNCED_KEY),
      serverUrl: dbGetSetting(SERVER_URL_KEY) ?? '',
    });
    // The keychain read is async and initialize is not, so the flag lands a
    // tick later. Nothing gates on it except a settings row's subtitle, and a
    // sync reads the token itself rather than trusting this.
    void loadSecureKey(SYNC_TOKEN_SECURE_KEY).then(token => set({ hasServerToken: !!token }));
  },

  setServerUrl: (url: string) => {
    const trimmed = url.trim();
    dbSetSetting(SERVER_URL_KEY, trimmed);
    set({ serverUrl: trimmed, problem: null });
  },

  setServerToken: async (token: string) => {
    const saved = await saveSecureKey(SYNC_TOKEN_SECURE_KEY, token.trim());
    if (saved) set({ hasServerToken: !!token.trim(), problem: null });
    return saved;
  },

  setEnabled: async (enabled: boolean) => {
    dbSetSetting(ENABLED_KEY, enabled ? '1' : '0');
    set({ enabled, problem: null });

    if (!enabled) return;

    // Check the account the moment it's switched on rather than waiting for
    // the first sync to fail: "sign in to iCloud" is something for the user to
    // do, and the moment they asked for sync is when they're able to do it.
    //
    // Guarded because this is a native call on a switch the user just tapped,
    // and every other failure in this store arrives as a `problem` string the
    // Settings row renders. A throw here would reject a promise nobody awaits:
    // the switch would read on, nothing would sync, and the screen would say
    // nothing about why.
    let reason: string | null;
    try {
      reason = await cloudKitUnavailableReason();
    } catch {
      set({ problem: 'Could not check your iCloud account.' });
      return;
    }
    if (reason) {
      set({ problem: reason });
      return;
    }
    await get().syncNow();
  },

  syncNow: async () => {
    const { enabled, phase, serverUrl } = get();
    if (phase === 'syncing') return null;

    // No longer gated on `enabled` alone: that flag is iCloud's, and a device
    // with only a payload store configured still has somewhere to sync to.
    // `configuredTransports` is what decides, and an empty list is a no-op
    // rather than a failure.
    const transports = await configuredTransports({ enabled, serverUrl });
    if (transports.length === 0) return null;

    set({ phase: 'syncing' });
    try {
      const summary = summarizeRuns(await runSyncAll(transports, databaseSyncLocal()));

      if (summary.ok) {
        const now = new Date().toISOString();
        dbSetSetting(LAST_SYNCED_KEY, now);
        set({
          lastSyncedAt: now,
          // A failure on one transport still shows, even though another
          // succeeded: half a sync is exactly the state worth telling somebody
          // about, because the device it did not reach is the one they will
          // wonder about later.
          problem: summary.problem
            ?? (summary.unreadable > 0 ? 'Some changes need a newer version of the app.' : null),
          lastSummary: describeApply(summary.applied),
        });
      } else if (summary.problem !== null) {
        set({ problem: summary.problem });
      }
      // Neither ok nor failed means every transport skipped, which is demo
      // mode. Not a problem and not worth reporting — the user swapped their
      // data out themselves.

      return summary;
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
