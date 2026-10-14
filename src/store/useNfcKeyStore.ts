import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { generateId } from '../utils/id';
import type { ShieldReasonKind } from '../utils/appShield';
import {
  NFC_KEYS_SETTING, NFC_KEY_LOCK_SETTING, canLock, cleanKeyName, lockAfterRemoval,
  newLinkToken, normalizeLinkToken, normalizeTagUid, parseNfcKeys, withKeyAdded,
  withKeyRemoved, type NfcKey,
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
  /** Something was blocking, and the tag ended all of it. `ended` names the reasons. */
  | { outcome: 'released'; key: NfcKey; ended: ShieldReasonKind[] }
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
  /** End the lock. The caller decides it may: a scan (`applyKeyScan`) or the emergency button. */
  unlock: () => void;
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

  unlock() {
    if (!get().locked) return;
    persistLocked(false);
    set({ locked: false });
  },
}));
