import type { MoodLevel } from '../types';

/**
 * What the four Shortcuts actions in `ShortcutActionIntents.swift` queued in
 * the App Group while the app was closed (Log Water, Log Mood, Add to Grocery
 * List, Open Screen), read back by `processPendingShortcutActions` in
 * `widgetSync.ts`.
 *
 * Defensive on purpose, `parseQueuedFoods`' posture: the file is written by
 * Swift in another process, so anything that does not parse is dropped rather
 * than thrown, and a drain must never fail a launch.
 */
export type QueuedShortcutAction =
  | { kind: 'water'; glasses: number; at: Date | null }
  /** Null mood: the action ran with none picked, which opens the mood log to pick one. */
  | { kind: 'mood'; mood: MoodLevel | null; at: Date | null }
  | { kind: 'grocery'; item: string; at: Date | null }
  | { kind: 'open'; screen: string; at: Date | null };

/** The most glasses one action logs; the intent clamps to the same. */
export const QUEUED_WATER_MAX_GLASSES = 20;

/** An item name is a few words; this only stops a runaway string. */
export const QUEUED_ITEM_MAX_LENGTH = 200;

function parseAt(at: unknown): Date | null {
  if (typeof at !== 'string') return null;
  const when = new Date(at);
  return Number.isNaN(when.getTime()) ? null : when;
}

/** The native drain's JSON, with anything malformed dropped silently. */
export function parseShortcutActions(json: string): QueuedShortcutAction[] {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: QueuedShortcutAction[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { kind, value, count, at } = entry as { kind?: unknown; value?: unknown; count?: unknown; at?: unknown };
    const when = parseAt(at);
    const text = typeof value === 'string' ? value.trim() : '';
    switch (kind) {
      case 'water': {
        const n = typeof count === 'number' && Number.isFinite(count) ? Math.round(count) : 1;
        out.push({ kind: 'water', glasses: Math.min(Math.max(n, 1), QUEUED_WATER_MAX_GLASSES), at: when });
        break;
      }
      case 'mood': {
        const level = Number(text);
        const mood = text && Number.isInteger(level) && level >= 1 && level <= 5 ? (level as MoodLevel) : null;
        out.push({ kind: 'mood', mood, at: when });
        break;
      }
      case 'grocery':
        if (text) out.push({ kind: 'grocery', item: text.slice(0, QUEUED_ITEM_MAX_LENGTH), at: when });
        break;
      case 'open':
        if (text) out.push({ kind: 'open', screen: text, at: when });
        break;
      default:
        break;
    }
  }
  return out;
}
