/**
 * The meals `LogFoodIntent` queued in the App Group while the app was closed
 * (Siri, the Action Button, Shortcuts), read back by `processPendingFoods` in
 * `widgetSync.ts`, which hands each to the offline meal queue
 * (`usePendingEstimateStore`). A queued meal is a description, never a food log
 * entry: see `estimateQueue.ts` for why.
 *
 * Defensive on purpose, `parseQueuedDreams`' posture: the file is written by
 * Swift in another process, so anything that does not parse is dropped rather
 * than thrown, and a drain must never fail a launch.
 */

/** One meal as the intent queued it. */
export interface QueuedFood {
  text: string;
  /** The moment it was said, when it parsed as one. Null files it under now. */
  at: Date | null;
}

/** A spoken meal is a sentence or two; this only stops a runaway string. */
export const QUEUED_FOOD_MAX_LENGTH = 500;

/** The native drain's JSON, with anything malformed dropped silently. */
export function parseQueuedFoods(json: string): QueuedFood[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: QueuedFood[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { text, at } = entry as { text?: unknown; at?: unknown };
    if (typeof text !== 'string') continue;
    const trimmed = text.trim().slice(0, QUEUED_FOOD_MAX_LENGTH);
    if (!trimmed) continue;
    const when = typeof at === 'string' ? new Date(at) : null;
    out.push({ text: trimmed, at: when && !Number.isNaN(when.getTime()) ? when : null });
  }
  return out;
}
