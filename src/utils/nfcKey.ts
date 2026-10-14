/**
 * A tag that locks and unlocks the apps picked in Settings: the rules, with no
 * store, no clock and no native call in them.
 *
 * **A tag is a lock held by one reason, and also the way out of all of them.**
 * `appShield.ts` ORs five reasons (focus, penalty, gate, schedule, and this).
 * A scan with anything blocking ends every live reason and writes a record of
 * it (`releaseAllBlocks`, `releaseBlocks.ts`); with nothing blocking it raises
 * this lock. That reverses an earlier rule that a tag could only end its own
 * lock: a block nothing can end early is worse than one that can be ended and
 * counted. The record is what the rule gives up in exchange.
 *
 * Two kinds of key, because two things read a tag:
 *
 * - **`tag`**: the tag's own hardware id, read by Core NFC while the app is
 *   open (`modules/todo-nfc-bridge`). Works with any tag, formatted or blank.
 * - **`link`**: a tag written with an https link carrying a token. iOS reads
 *   that one in the background with the app closed and opens it, which is what
 *   makes tap-to-lock cheap. The link is the secret: anyone who reads the tag
 *   can copy it.
 *
 * Neither is a security boundary. A hardware id can be read and cloned, and
 * the token is not cryptographic. The feature is friction and a physical
 * ritual, and iOS Settings can still turn Screen Time off. Nothing here should
 * be described as stronger than that.
 */

/** The settings row holding the enrolled keys, as JSON. Device-local. */
export const NFC_KEYS_SETTING = 'nfcKeys';
/** The settings row holding whether the tag's lock is on, `'true'` or `'false'`. Device-local. */
export const NFC_KEY_LOCK_SETTING = 'nfcKeyLocked';

export type NfcKeyKind = 'tag' | 'link';

export interface NfcKey {
  id: string;
  /** What the person calls it ("Desk tag"). */
  name: string;
  kind: NfcKeyKind;
  /** A `tag` key's normalized hardware id, or a `link` key's token. */
  secret: string;
  addedAt: string;
}

/** The most keys enrolled at once. A handful of tags is a lot of tags. */
export const MAX_NFC_KEYS = 8;

/** The longest name kept, so a pasted paragraph isn't stored as one. */
export const MAX_KEY_NAME_LENGTH = 40;

/**
 * A hardware id as the canonical text it is stored and compared as: upper-case
 * hex with no separators, or null when it isn't one.
 *
 * Tags report 4, 7 or 10 bytes (ISO 14443 UIDs) and 8 (ISO 15693 and FeliCa),
 * so anything outside 4..10 bytes is a misread rather than a tag. An
 * all-zero id is refused too: it is what a read that failed halfway looks like,
 * and enrolling it would make every misread a match.
 */
export function normalizeTagUid(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const hex = raw.replace(/[\s:.-]/g, '').toUpperCase();
  if (!/^[0-9A-F]+$/.test(hex)) return null;
  if (hex.length % 2 !== 0) return null;
  const bytes = hex.length / 2;
  if (bytes < 4 || bytes > 10) return null;
  if (/^0+$/.test(hex)) return null;
  return hex;
}

const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const TOKEN_LENGTH = 24;

/**
 * A fresh token for a `link` key. `random` is a parameter so a test can state
 * the draw; the default is `Math.random`, which is enough for what the token
 * does (tell your tag's link from any other link) and is not a secret worth
 * defending.
 */
export function newLinkToken(random: () => number = Math.random): string {
  let token = '';
  for (let i = 0; i < TOKEN_LENGTH; i += 1) {
    token += TOKEN_ALPHABET[Math.floor(random() * TOKEN_ALPHABET.length) % TOKEN_ALPHABET.length];
  }
  return token;
}

/** A token as the link carries it, or null when it isn't one of ours. */
export function normalizeLinkToken(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const token = raw.trim().toLowerCase();
  return /^[a-z0-9]{16,64}$/.test(token) ? token : null;
}

/**
 * The https link to write to a tag for a `link` key, or null when no
 * universal-link host is configured. It goes through `/open/`, the one path the
 * app's domain association covers, so iOS opens the app straight from a tag tap
 * and `appUrlFromUniversalLink` turns it into `dundundun://key?token=…`. The
 * hosts are passed in (`UNIVERSAL_LINK_HOSTS`) so this module imports nothing.
 */
export function keyLinkUrl(token: string, hosts: readonly string[]): string | null {
  const host = hosts[0];
  const clean = normalizeLinkToken(token);
  if (!host || !clean) return null;
  return `https://${host}/open/key?token=${clean}`;
}

/** The name as stored: trimmed, capped, and never empty. */
export function cleanKeyName(raw: string, fallback: string): string {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_KEY_NAME_LENGTH);
  return name || fallback;
}

/**
 * The enrolled keys out of the settings row. Anything malformed is dropped
 * rather than thrown on: this runs at launch, where an uncaught throw takes the
 * app down, and a lost key is re-enrolled in one scan.
 */
export function parseNfcKeys(raw: string | null | undefined): NfcKey[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const keys: NfcKey[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, name, kind, secret, addedAt } = item as Partial<NfcKey>;
    if (typeof id !== 'string' || typeof name !== 'string' || typeof addedAt !== 'string') continue;
    if (typeof secret !== 'string') continue;
    if (kind === 'tag') {
      const uid = normalizeTagUid(secret);
      if (uid) keys.push({ id, name, kind, secret: uid, addedAt });
    } else if (kind === 'link') {
      const token = normalizeLinkToken(secret);
      if (token) keys.push({ id, name, kind, secret: token, addedAt });
    }
  }
  return keys.slice(0, MAX_NFC_KEYS);
}

export type AddKeyResult =
  | { ok: true; keys: NfcKey[] }
  | { ok: false; reason: 'full' | 'duplicate' };

/**
 * Add a key, or say why not. Refused rather than replaced on a duplicate: two
 * keys with one secret would make "remove this one" leave the other still
 * working, which reads as the removal not having taken.
 */
export function withKeyAdded(keys: readonly NfcKey[], key: NfcKey): AddKeyResult {
  if (keys.some(k => k.kind === key.kind && k.secret === key.secret)) return { ok: false, reason: 'duplicate' };
  if (keys.length >= MAX_NFC_KEYS) return { ok: false, reason: 'full' };
  return { ok: true, keys: [...keys, key] };
}

export function withKeyRemoved(keys: readonly NfcKey[], id: string): NfcKey[] {
  return keys.filter(k => k.id !== id);
}

/** The enrolled key a scan read, or null when it is nobody's. */
export function matchKey(keys: readonly NfcKey[], kind: NfcKeyKind, secret: string | null): NfcKey | null {
  if (!secret) return null;
  const wanted = kind === 'tag' ? normalizeTagUid(secret) : normalizeLinkToken(secret);
  if (!wanted) return null;
  return keys.find(k => k.kind === kind && k.secret === wanted) ?? null;
}

/**
 * Whether the tag's lock may be raised at all: a tag is enrolled to lift it
 * with. A lock with no key to end it would be one only the app's own button
 * could end, which is the unlock-from-the-app door the feature is meant to
 * close.
 */
export function canLock(keys: readonly NfcKey[]): boolean {
  return keys.length > 0;
}

/** What a scan does to the lock: it flips it. */
export function nextKeyLock(locked: boolean): boolean {
  return !locked;
}

/** The line the shield screen and the settings row lead with while the lock is on. */
export const KEY_LOCK_DETAIL = 'These apps are locked until you tap your key tag.';

/**
 * Removing the last key while locked would strand the lock with nothing to end
 * it, so removal takes the lock down with it. Returned as the lock state to
 * write after the removal.
 */
export function lockAfterRemoval(remaining: readonly NfcKey[], locked: boolean): boolean {
  return locked && remaining.length > 0;
}
