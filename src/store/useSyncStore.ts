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
import { dbGetSetting, dbGetSyncCursor, dbSetSetting, dbSetSyncCursor } from '../db/database';
import { HEALTH_SYNC_SETTING_KEYS, HEALTH_SYNC_TABLES } from '../db/syncTracking';
import { cloudKitTransport, cloudKitUnavailableReason, isCloudKitSyncAvailable } from '../utils/cloudKitTransport';
import { HTTP_SYNC_SOURCE, httpSyncTransport, isHttpSyncConfigured } from '../utils/httpSyncTransport';
import { loadSecureKey, saveSecureKey, SYNC_TOKEN_SECURE_KEY } from '../utils/secureApiKey';
import { databaseSyncLocal } from '../utils/syncLocal';
import {
  pushCursorKey,
  runSyncAll,
  summarizeRuns,
  type SyncSummary,
  type SyncTransport,
  type SyncWithholding,
} from '../utils/syncEngine';
import { describeApply, type ApplyReport } from '../utils/syncMerge';

const ENABLED_KEY = 'syncEnabled';
const LAST_SYNCED_KEY = 'syncLastSyncedAt';
const SERVER_URL_KEY = 'syncServerUrl';
export const SERVER_HEALTH_LOGS_KEY = 'syncServerHealthLogs';
/**
 * Where the server's push cursor has to go back to before health logs are
 * next sent. Absent means from the very start, which is the default: off
 * since the first sync, so nothing was ever sent. `NOTHING_OWED` means they
 * are on and caught up.
 */
export const SERVER_HEALTH_RESEND_KEY = 'syncServerHealthResendFrom';
export const NOTHING_OWED = 'none';

/** A push cursor older than every row, so a rewind to it resends everything. */
export const SYNC_EPOCH = '1970-01-01T00:00:00.000Z';

const HEALTH_WITHHOLDING: SyncWithholding = {
  tables: HEALTH_SYNC_TABLES,
  settingKeys: HEALTH_SYNC_SETTING_KEYS,
};

/**
 * Turning health logs off: remember where the server's cursor stood.
 *
 * A withheld row is refused rather than left pending, so the cursor moves past
 * it like any other, and turning the switch back on has to rewind to here (see
 * `settleHealthLogResend`). An existing mark is kept, since an earlier one
 * covers more. Safe to run mid-sync: a run in flight can only move the cursor
 * forward past this mark, which makes the eventual resend larger, never short.
 */
export function markHealthLogsWithheld(): void {
  if (dbGetSetting(SERVER_HEALTH_RESEND_KEY) !== NOTHING_OWED) return;
  dbSetSetting(SERVER_HEALTH_RESEND_KEY, dbGetSyncCursor(pushCursorKey(HTTP_SYNC_SOURCE)) ?? SYNC_EPOCH);
}

/**
 * With health logs on, rewind the server's cursor to whatever is owed.
 *
 * Run at the start of a sync, under its lock, never from the switch itself: a
 * run already pushing writes its own `until` over the cursor when it lands, and
 * would undo a rewind made while it was in the air, losing every log written
 * while the switch was off. Only ever moves the cursor back; a server never
 * synced has no cursor and reads everything anyway.
 *
 * The resend repeats rows the server already has. Applying a row twice is a
 * no-op under `remoteRowWins`' tie rule, so that costs bandwidth and nothing
 * else.
 */
export function settleHealthLogResend(): void {
  const owed = dbGetSetting(SERVER_HEALTH_RESEND_KEY);
  if (owed === NOTHING_OWED) return;

  const key = pushCursorKey(HTTP_SYNC_SOURCE);
  const from = owed || SYNC_EPOCH;
  const current = dbGetSyncCursor(key);
  if (current !== null && from < current) dbSetSyncCursor(key, from);
  dbSetSetting(SERVER_HEALTH_RESEND_KEY, NOTHING_OWED);
}

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
   * Bumped whenever a sync writes recipe photos to this device (#2704). A photo
   * can arrive in a sync that changes no row, and then nothing else re-renders
   * a recipe still showing that its photo isn't here, so the recipe screens
   * read this to look again.
   */
  recipeImagesVersion: number;

  /**
   * The payload store's origin, or '' for none. Its token lives in the
   * keychain, never here and never in the settings table — it is a credential,
   * and `secureApiKey.ts` is where this app puts those.
   */
  serverUrl: string;
  /** Whether a token is stored, which is all a settings row may say about one. */
  hasServerToken: boolean;
  /**
   * Whether the mood, medication and food logs go to the sync server. Off by
   * default, and per device like the server address itself. iCloud never gets
   * them either way (see HEALTH_SYNC_TABLES).
   */
  serverHealthLogs: boolean;

  initialize: () => void;
  setEnabled: (enabled: boolean) => Promise<void>;
  setServerUrl: (url: string) => void;
  setServerToken: (token: string) => Promise<boolean>;
  setServerHealthLogs: (on: boolean) => void;
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
async function configuredTransports(
  state: { enabled: boolean; serverUrl: string; serverHealthLogs: boolean }
): Promise<SyncTransport[]> {
  const transports: SyncTransport[] = [];
  if (state.enabled && isCloudKitSyncAvailable()) {
    transports.push({ ...cloudKitTransport(), withhold: HEALTH_WITHHOLDING });
  }

  const token = await loadSecureKey(SYNC_TOKEN_SECURE_KEY);
  const config = { url: state.serverUrl, token };
  if (isHttpSyncConfigured(config)) {
    const server = httpSyncTransport(config);
    transports.push(state.serverHealthLogs ? server : { ...server, withhold: HEALTH_WITHHOLDING });
  }

  return transports;
}

// See syncNow: claimed synchronously, so two calls can't both reach runSyncAll.
let syncInFlight = false;

/**
 * Re-reads every data store from the database after a sync wrote to it.
 *
 * A sync writes straight to SQLite, and before this nothing re-read it: the
 * other device's changes stayed off screen until the next launch, and worse,
 * the stores save a row by writing their whole in-memory copy back, so the next
 * local edit of a synced row wrote the stale copy over it with a fresh stamp,
 * which then won on every device. Injected rather than imported because the
 * task store fans out to every other store and this one has to stay importable
 * without them (see App.tsx and backgroundRefresh.ts for the registration).
 *
 * Handed what the sync applied, for the work a reload alone can't do: a meal's
 * calendar event, and a task's deadline event and time block, live on this
 * device and only this device can move or delete them (#2950,
 * `reconcileSyncedEvents` in useMealPlanStore and useTaskStore).
 */
let reloadAfterSync: (applied: ApplyReport) => void = () => {};
export function registerSyncReload(reload: (applied: ApplyReport) => void): void {
  reloadAfterSync = reload;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  initialized: false,
  enabled: false,
  supported: false,
  phase: 'idle',
  lastSyncedAt: null,
  problem: null,
  lastSummary: null,
  recipeImagesVersion: 0,

  serverUrl: '',
  hasServerToken: false,
  serverHealthLogs: false,

  initialize: () => {
    set({
      initialized: true,
      enabled: dbGetSetting(ENABLED_KEY) === '1',
      supported: isCloudKitSyncAvailable(),
      lastSyncedAt: dbGetSetting(LAST_SYNCED_KEY),
      serverUrl: dbGetSetting(SERVER_URL_KEY) ?? '',
      serverHealthLogs: dbGetSetting(SERVER_HEALTH_LOGS_KEY) === '1',
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

  setServerHealthLogs: (on: boolean) => {
    if (on === get().serverHealthLogs) return;
    if (!on) markHealthLogsWithheld();
    dbSetSetting(SERVER_HEALTH_LOGS_KEY, on ? '1' : '0');
    set({ serverHealthLogs: on });
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
    const { enabled, phase, serverUrl, serverHealthLogs } = get();
    if (phase === 'syncing' || syncInFlight) return null;
    // Claimed before the first await rather than by `phase`, which is only set
    // once the transports are known: the keychain read in between left a window
    // where a foreground return and the mount-time sync both got past the check
    // and ran runSyncAll twice, interleaved, which is what running the
    // transports sequentially exists to prevent.
    syncInFlight = true;
    try {
      return await syncOnce({ enabled, serverUrl, serverHealthLogs });
    } finally {
      syncInFlight = false;
    }
  },
}));

async function syncOnce(
  state: { enabled: boolean; serverUrl: string; serverHealthLogs: boolean }
): Promise<SyncSummary | null> {
  const set = useSyncStore.setState;

  // No longer gated on `enabled` alone: that flag is iCloud's, and a device
  // with only a payload store configured still has somewhere to sync to.
  // `configuredTransports` is what decides, and an empty list is a no-op
  // rather than a failure.
  if (state.serverHealthLogs) settleHealthLogResend();
  const transports = await configuredTransports(state);
  if (transports.length === 0) return null;

  set({ phase: 'syncing' });
  try {
    const summary = summarizeRuns(await runSyncAll(transports, databaseSyncLocal()));

    // Before the summary is recorded, and whenever anything landed, including
    // on a run where the other transport then failed: the rows are in the
    // database either way. Skipped when nothing came in, which is most runs.
    const a = summary.applied;
    if (a.inserted + a.updated + a.deleted > 0) reloadAfterSync(a);
    if (summary.imagesReceived > 0) set(s => ({ recipeImagesVersion: s.recipeImagesVersion + 1 }));

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
          ?? (summary.unreadable > 0 ? 'Some changes need a newer version of the app.' : null)
          // Last, and only when the rows went: a photo that didn't send is
          // retried on its own, so this names it without calling the sync failed.
          ?? (summary.imageProblem
            ? `Some recipe photos didn't send (${summary.imageProblem}). They go again with the next sync.`
            : null),
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
}

/**
 * Whether the sync feature should appear at all.
 *
 * Kept separate from the store's `supported` so a screen can ask before the
 * store has initialized.
 */
export function isSyncSupported(): boolean {
  return isCloudKitSyncAvailable();
}
