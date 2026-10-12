/**
 * The dreams `LogDreamIntent` queued in the App Group while the app was
 * closed (Siri, the Action Button, Shortcuts), read back by
 * `processPendingDreams` in `widgetSync.ts`.
 *
 * Defensive on purpose, `parseQueuedDoses`' posture: the file is written by
 * Swift in another process, so anything that does not parse is dropped rather
 * than thrown, and a drain must never fail a launch.
 */

/** One dream as the intent queued it. */
export interface QueuedDream {
  text: string;
  /** The moment it was said, when it parsed as one. Null files it under now. */
  at: Date | null;
}

/** The longest an entry can be: `JournalEntrySheet`'s own limit. */
export const QUEUED_DREAM_MAX_LENGTH = 5000;

/** The native drain's JSON, with anything malformed dropped silently. */
export function parseQueuedDreams(json: string): QueuedDream[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: QueuedDream[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { text, at } = entry as { text?: unknown; at?: unknown };
    if (typeof text !== 'string') continue;
    const trimmed = text.trim().slice(0, QUEUED_DREAM_MAX_LENGTH);
    if (!trimmed) continue;
    const when = typeof at === 'string' ? new Date(at) : null;
    out.push({ text: trimmed, at: when && !Number.isNaN(when.getTime()) ? when : null });
  }
  return out;
}
