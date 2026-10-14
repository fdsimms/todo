/**
 * The key codes `ToggleKeyLockIntent` queued in the App Group while the app was
 * closed (the Shortcuts action a tag automation runs), read back by
 * `processPendingKeyScans` in `widgetSync.ts`.
 *
 * Defensive on purpose, `parseQueuedDreams`' posture: the file is written by
 * Swift in another process, so anything that does not parse is dropped rather
 * than thrown, and a drain must never fail a launch. A code is not judged here:
 * whether it belongs to a key is `applyScan`'s answer, so a malformed one costs
 * the same single "not recognized" as a wrong one.
 */

/** One scan as the intent queued it. */
export interface QueuedKeyScan {
  code: string;
  /** The moment the action ran, when it parsed as one. */
  at: Date | null;
}

/** Longer than any token (`normalizeLinkToken` allows 64), so a pasted link still fits. */
export const QUEUED_KEY_CODE_MAX_LENGTH = 200;

/** The native drain's JSON, with anything malformed dropped silently. */
export function parseQueuedKeyScans(json: string): QueuedKeyScan[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: QueuedKeyScan[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { code, at } = entry as { code?: unknown; at?: unknown };
    if (typeof code !== 'string') continue;
    const trimmed = code.trim().slice(0, QUEUED_KEY_CODE_MAX_LENGTH);
    if (!trimmed) continue;
    const when = typeof at === 'string' ? new Date(at) : null;
    out.push({ code: trimmed, at: when && !Number.isNaN(when.getTime()) ? when : null });
  }
  return out;
}

/**
 * The code as a key's token: what a person pastes into the Shortcuts action is
 * sometimes the whole link they shared, so a `token=` query is read out of it.
 * Anything else is passed through for `normalizeLinkToken` to judge.
 */
export function keyCodeToken(code: string): string {
  const match = /[?&]token=([^&#\s]+)/i.exec(code);
  return match ? match[1] : code.trim();
}
