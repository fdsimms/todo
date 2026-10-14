import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { generateId } from '../utils/id';
import { useAppGroupStore } from './useAppGroupStore';
import {
  NFC_KEYS_SETTING, NFC_KEY_LOCK_SETTING, canLock, cleanKeyName, lockAfterRemoval, matchKey,
  newLinkToken, nextKeyLock, normalizeLinkToken, normalizeTagUid, parseNfcKeys, withKeyAdded,
  withKeyRemoved, type NfcKey, type NfcKeyKind,
} from '../utils/nfcKey';

/**
 * The key tags enrolled to lock and unlock the apps picked in Settings, and
 * whether the lock is on.
 *
 * Both live in the settings table and stay on this device (the sync allowlist
 * names settings that travel, and these are not on it): a lock one phone
 * raised must not lock another, and a tag enrolled on one means nothing to a
 * phone that has never read it.
 *
 * The shield itself is not written here. `useAppShieldSync` watches this store
 * and `appShield.ts` decides, because the lock is one of five reasons for the
 * one system shield and none of them may lift another's block.
 *
 * Held in memory and written through, so demo mode has to `reload()` it when
 * the database swaps (see `useDemoStore`).
 */

/** What reading a tag did, for the screen to say. */
export type KeyScanResult =
  | { outcome: 'locked'; key: NfcKey }
  | { outcome: 'unlocked'; key: NfcKey }
  /** A schedule's window was open, and the tag lifted it until it ends. */
  | { outcome: 'paused'; key: NfcKey; count: number }
  | { outcome: 'unknown' };

export type EnrollResult =
  | { ok: true; key: NfcKey }
  | { ok: false; reason: 'unreadable' | 'full' | 'duplicate' };

interface NfcKeyStore {
  keys: NfcKey[];
  /** The tag's lock is on. The shield also requires a key (`keyLockedNow`). */
  locked: boolean;
  initialize: () => void;
  /** Re-read from the current database, after a demo-mode swap. */
  reload: () => void;
  /** Enroll a tag by the hardware id a scan read. */
  enrollTag: (rawUid: string, name: string) => EnrollResult;
  /** Enroll a new link tag; the key's `secret` is the token to write into its link. */
  enrollLink: (name: string) => EnrollResult;
  removeKey: (id: string) => void;
  /** Raise the lock from the app. Refused with no key enrolled to end it. */
  lock: () => boolean;
  /** A tag was read (hardware id) or a link was opened (token): flip the lock if it is ours. */
  applyScan: (kind: NfcKeyKind, secret: string | null) => KeyScanResult;
}

function persistKeys(keys: NfcKey[]): void {
  dbSetSetting(NFC_KEYS_SETTING, JSON.stringify(keys));
}

function persistLocked(locked: boolean): void {
  dbSetSetting(NFC_KEY_LOCK_SETTING, locked ? 'true' : 'false');
}

function readState(): { keys: NfcKey[]; locked: boolean } {
  const keys = parseNfcKeys(dbGetSetting(NFC_KEYS_SETTING));
  return { keys, locked: dbGetSetting(NFC_KEY_LOCK_SETTING) === 'true' && canLock(keys) };
}

export const useNfcKeyStore = create<NfcKeyStore>((set, get) => ({
  keys: [],
  locked: false,

  initialize() {
    set(readState());
  },

  reload() {
    set(readState());
  },

  enrollTag(rawUid, name) {
    const secret = normalizeTagUid(rawUid);
    if (!secret) return { ok: false, reason: 'unreadable' };
    const key: NfcKey = {
      id: generateId(),
      name: cleanKeyName(name, 'Key tag'),
      kind: 'tag',
      secret,
      addedAt: new Date().toISOString(),
    };
    const added = withKeyAdded(get().keys, key);
    if (!added.ok) return added;
    persistKeys(added.keys);
    set({ keys: added.keys });
    return { ok: true, key };
  },

  enrollLink(name) {
    const secret = normalizeLinkToken(newLinkToken());
    if (!secret) return { ok: false, reason: 'unreadable' };
    const key: NfcKey = {
      id: generateId(),
      name: cleanKeyName(name, 'Link tag'),
      kind: 'link',
      secret,
      addedAt: new Date().toISOString(),
    };
    const added = withKeyAdded(get().keys, key);
    if (!added.ok) return added;
    persistKeys(added.keys);
    set({ keys: added.keys });
    return { ok: true, key };
  },

  removeKey(id) {
    const keys = withKeyRemoved(get().keys, id);
    persistKeys(keys);
    const locked = lockAfterRemoval(keys, get().locked);
    if (locked !== get().locked) persistLocked(locked);
    set({ keys, locked });
  },

  lock() {
    if (!canLock(get().keys)) return false;
    persistLocked(true);
    set({ locked: true });
    return true;
  },

  applyScan(kind, secret) {
    const key = matchKey(get().keys, kind, secret);
    if (!key) return { outcome: 'unknown' };
    // A lock the tag raised is ended first. Otherwise, if a schedule's window
    // is open, the scan lifts that window until it closes instead of raising
    // a lock on top of it. Either way a tag ends only what a tag may: never a
    // penalty, a gate or a focus session, which `pauseOpenSchedules` does not
    // touch.
    if (!get().locked) {
      const count = useAppGroupStore.getState().pauseOpenSchedules(new Date());
      if (count > 0) return { outcome: 'paused', key, count };
    }
    const locked = nextKeyLock(get().locked);
    persistLocked(locked);
    set({ locked });
    return { outcome: locked ? 'locked' : 'unlocked', key };
  },
}));
