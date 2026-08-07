/**
 * The Anthropic API key, in the device keychain instead of the settings table.
 *
 * It used to go through dbSetSetting like any other preference, which put a
 * live billing credential in the same unencrypted SQLite file as the task list
 * — readable by anything that can get at the app's container, and carried along
 * by any copy of that file. expo-secure-store puts it in the iOS keychain
 * (Android: encrypted SharedPreferences) instead.
 *
 * **Plaintext is never written again, even as a fallback.** If the keychain
 * can't be reached the key simply isn't persisted this launch — falling back to
 * the settings row would quietly restore the exact hole this closes.
 *
 * The migration is the delicate part, and it's ordered so no step can lose the
 * key: the keychain copy is written *first* and the plaintext row is deleted
 * only once that write has returned. A failure between the two leaves both
 * copies, which the next launch resolves (keychain wins, row gets cleared) —
 * whereas deleting first and failing to write would destroy a credential the
 * user pasted in months ago and no longer has.
 */

import { dbDeleteSetting, dbGetSetting } from '../db/database';

/**
 * Required where it's used rather than imported at the top.
 *
 * useSettingsStore reaches this file, and most of the test suite reaches that
 * store — in Jest's `node` environment, where loading expo-secure-store pulls
 * in expo-modules-core and its native runtime and throws on sight. Every native
 * import in this app is otherwise reachable only from a screen or a root hook,
 * which is what has kept the stores loadable without one; a lazy require keeps
 * that true. Nothing here runs in a test that hasn't mocked the module anyway.
 */
function secureStore(): typeof import('expo-secure-store') {
  return require('expo-secure-store');
}

/** Keychain item. Same name as the old row, so the two are easy to trace to each other. */
export const API_KEY_SECURE_KEY = 'anthropicApiKey';

/** The pre-keychain settings row. Read once per launch, only to be emptied. */
export const API_KEY_LEGACY_SETTING = 'anthropicApiKey';

/**
 * Reads the key, migrating a plaintext row into the keychain if one is still
 * there. Returns '' when there is no key — the same "AI features are inert"
 * state an install that never pasted one is in.
 */
export async function loadAnthropicApiKey(): Promise<string> {
  let stored: string | null = null;
  try {
    stored = await secureStore().getItemAsync(API_KEY_SECURE_KEY);
  } catch {
    stored = null;
  }

  const legacy = dbGetSetting(API_KEY_LEGACY_SETTING);

  // The keychain is authoritative once it holds anything: a row still sitting
  // alongside it is either a migration that was interrupted before its delete,
  // or an old backup restored over the top. Either way it's stale, and the
  // point of the exercise is that it stops existing.
  if (stored) {
    if (legacy !== null) dbDeleteSetting(API_KEY_LEGACY_SETTING);
    return stored;
  }

  if (!legacy) {
    // An empty row is still a row. Nothing to migrate, but nothing to keep.
    if (legacy !== null) dbDeleteSetting(API_KEY_LEGACY_SETTING);
    return '';
  }

  try {
    await secureStore().setItemAsync(API_KEY_SECURE_KEY, legacy);
  } catch {
    // Keep the row. A key we can't re-store is a key we mustn't drop — the
    // next launch tries the migration again.
    return legacy;
  }
  dbDeleteSetting(API_KEY_LEGACY_SETTING);
  return legacy;
}

/**
 * Writes the key to the keychain, or clears it when given ''. Reports whether
 * it stuck, so a caller can tell "saved" from "works until you quit".
 */
export async function saveAnthropicApiKey(key: string): Promise<boolean> {
  try {
    if (key) {
      await secureStore().setItemAsync(API_KEY_SECURE_KEY, key);
    } else {
      await secureStore().deleteItemAsync(API_KEY_SECURE_KEY);
    }
  } catch {
    return false;
  }
  // Covers the install whose migration couldn't write earlier and whose user
  // has now pasted a key by hand: the stale row goes with it.
  if (dbGetSetting(API_KEY_LEGACY_SETTING) !== null) dbDeleteSetting(API_KEY_LEGACY_SETTING);
  return true;
}
