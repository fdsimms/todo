import { dbGetSetting, dbSetSetting } from '../db/database';
import type { EventAvailability } from './quickEventDefaults';

/**
 * What the last quick-add event with a given title was saved with, so typing
 * "gym" again fills in the place, the length, the calendar and the alert the
 * last "gym" had. The card says when it has done this and offers to undo it,
 * and anything typed or picked for this event wins over it.
 *
 * Keyed by the title as typed (people's names included), compared loosely:
 * case, spacing and trailing punctuation don't make a different event. Kept to
 * the most recent `EVENT_MEMORY_LIMIT` titles.
 *
 * **One JSON setting, device-local**, for `quickEventDefaults`' reason: it
 * holds calendar ids. Listed in `DEVICE_ID_SETTING_KEYS` (`backup.ts`) and left
 * off sync's allowlist.
 */
export const EVENT_MEMORY_KEY = 'quickEventMemory';
export const EVENT_MEMORY_LIMIT = 50;

export interface RememberedEvent {
  location: string | null;
  /** The map pin of a place picked from Apple Maps, so the next one gets it too. */
  place: { latitude: number; longitude: number } | null;
  /** Null for an all-day event. */
  durationMinutes: number | null;
  calendarId: string | null;
  alertMinutes: number | null;
  availability: EventAvailability;
  /** Epoch ms of the save, for keeping the most recent. */
  at: number;
}

export type EventMemory = Readonly<Record<string, RememberedEvent>>;

/** The comparison key for a title: lowercased, spaces collapsed, trailing punctuation dropped. */
export function eventMemoryKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s,;:.!?-]+$/, '');
}

function readEntry(raw: unknown): RememberedEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
  const place = v.place && typeof v.place === 'object' ? v.place as Record<string, unknown> : null;
  const lat = place ? num(place.latitude) : null;
  const lon = place ? num(place.longitude) : null;
  const duration = num(v.durationMinutes);
  const alert = num(v.alertMinutes);
  const at = num(v.at);
  if (at === null) return null;
  return {
    location: typeof v.location === 'string' && v.location.trim() ? v.location.trim() : null,
    place: lat !== null && lon !== null ? { latitude: lat, longitude: lon } : null,
    durationMinutes: duration !== null && duration >= 1 && duration <= 24 * 60 ? Math.round(duration) : null,
    calendarId: typeof v.calendarId === 'string' && v.calendarId ? v.calendarId : null,
    alertMinutes: alert !== null && alert >= 0 ? alert : null,
    availability: v.availability === 'free' ? 'free' : 'busy',
    at,
  };
}

/** Tolerant of a missing or malformed stored value: entries that don't read are dropped. */
export function parseEventMemory(raw: string | null | undefined): EventMemory {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Record<string, RememberedEvent> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const read = readEntry(entry);
      if (key && read) out[key] = read;
    }
    return out;
  } catch {
    return {};
  }
}

/** The memory with this event recorded under its title, trimmed to the most recent titles. */
export function rememberEvent(memory: EventMemory, title: string, entry: RememberedEvent): EventMemory {
  const key = eventMemoryKey(title);
  if (!key) return memory;
  const next: Record<string, RememberedEvent> = { ...memory, [key]: entry };
  const keys = Object.keys(next);
  if (keys.length <= EVENT_MEMORY_LIMIT) return next;
  const kept = keys.sort((a, b) => next[b].at - next[a].at).slice(0, EVENT_MEMORY_LIMIT);
  return Object.fromEntries(kept.map(k => [k, next[k]]));
}

/** The remembered event for a title, or null. */
export function recallEvent(memory: EventMemory, title: string): RememberedEvent | null {
  const key = eventMemoryKey(title);
  return key ? memory[key] ?? null : null;
}

export function readEventMemory(): EventMemory {
  return parseEventMemory(dbGetSetting(EVENT_MEMORY_KEY));
}

export function writeEventMemory(memory: EventMemory): void {
  dbSetSetting(EVENT_MEMORY_KEY, JSON.stringify(memory));
}
