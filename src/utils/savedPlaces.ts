import { dbGetSetting, dbSetSetting } from '../db/database';
import { generateId } from './id';

/**
 * Places the user has named ("Home", "Mom's", "Gym") so typing the name into
 * an event's location means the address behind it. Matched by name, loosely:
 * case and spacing don't make a different place.
 *
 * **One JSON setting, and it syncs.** Unlike `quickEventMemory` it holds no
 * calendar ids: a name, the text written into the event's location and
 * optionally the map pin, all of which mean the same thing on every device.
 * Listed in `SYNCED_SETTING_KEYS`. Nothing here touches the network; a pin
 * only exists when the place was first picked from Apple Maps' suggestions.
 */
export const SAVED_PLACES_KEY = 'savedPlaces';
export const SAVED_PLACES_LIMIT = 30;
/** Fewer typed characters than this don't suggest a saved place: "h" matches half the list. */
export const SAVED_PLACE_SUGGEST_MIN_LENGTH = 2;

export interface SavedPlace {
  id: string;
  /** What the user types ("Home"). */
  name: string;
  /** What is written into the event's location. */
  text: string;
  /** The map pin, or null for a place saved as plain text. */
  latitude: number | null;
  longitude: number | null;
}

/** The comparison key for a name: lowercased, spaces collapsed, trailing punctuation dropped. */
export function savedPlaceKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[\s,;:.!?-]+$/, '');
}

function readEntry(raw: unknown): SavedPlace | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  const name = typeof v.name === 'string' ? v.name.trim() : '';
  const text = typeof v.text === 'string' ? v.text.trim() : '';
  if (!name || !text || typeof v.id !== 'string' || !v.id) return null;
  const lat = typeof v.latitude === 'number' && Number.isFinite(v.latitude) && Math.abs(v.latitude) <= 90 ? v.latitude : null;
  const lon = typeof v.longitude === 'number' && Number.isFinite(v.longitude) && Math.abs(v.longitude) <= 180 ? v.longitude : null;
  // A pin is a pair: half of one is no pin.
  const pinned = lat !== null && lon !== null;
  return { id: v.id, name, text, latitude: pinned ? lat : null, longitude: pinned ? lon : null };
}

/** Tolerant of a missing or malformed stored value: entries that don't read are dropped. */
export function parseSavedPlaces(raw: string | null | undefined): SavedPlace[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const out: SavedPlace[] = [];
    for (const item of value) {
      const read = readEntry(item);
      const key = read ? savedPlaceKey(read.name) : '';
      if (!read || !key || seen.has(key)) continue;
      seen.add(key);
      out.push(read);
    }
    return out;
  } catch {
    return [];
  }
}

export interface SavedPlaceInput {
  name: string;
  text: string;
  place: { latitude: number; longitude: number } | null;
}

/**
 * The list with this place saved. A name already in the list is the same
 * place saved again, so it is replaced in position rather than duplicated.
 * Empty fields, and a new name past the limit, leave the list as it was.
 */
export function addSavedPlace(places: readonly SavedPlace[], input: SavedPlaceInput): SavedPlace[] {
  const name = input.name.trim();
  const text = input.text.trim();
  const key = savedPlaceKey(name);
  if (!key || !text) return [...places];
  const entry: SavedPlace = {
    id: '',
    name,
    text,
    latitude: input.place?.latitude ?? null,
    longitude: input.place?.longitude ?? null,
  };
  const at = places.findIndex(p => savedPlaceKey(p.name) === key);
  if (at >= 0) {
    const next = [...places];
    next[at] = { ...entry, id: places[at].id };
    return next;
  }
  if (places.length >= SAVED_PLACES_LIMIT) return [...places];
  return [...places, { ...entry, id: generateId() }];
}

/** Renames one place. Refused (list unchanged) for an empty name or one another place already has. */
export function renameSavedPlace(places: readonly SavedPlace[], id: string, name: string): SavedPlace[] {
  const trimmed = name.trim();
  const key = savedPlaceKey(trimmed);
  if (!key || places.some(p => p.id !== id && savedPlaceKey(p.name) === key)) return [...places];
  return places.map(p => (p.id === id ? { ...p, name: trimmed } : p));
}

/**
 * Rewrites one place's name, address and pin. Refused (list unchanged) for an
 * empty name or address, or a name another place already has. The pin is
 * replaced, not merged: an address typed over the old one no longer means the
 * old coordinates, so a caller passes `place: null` unless one was just picked.
 */
export function editSavedPlace(places: readonly SavedPlace[], id: string, input: SavedPlaceInput): SavedPlace[] {
  const name = input.name.trim();
  const text = input.text.trim();
  const key = savedPlaceKey(name);
  if (!key || !text || places.some(p => p.id !== id && savedPlaceKey(p.name) === key)) return [...places];
  return places.map(p => (p.id === id
    ? { ...p, name, text, latitude: input.place?.latitude ?? null, longitude: input.place?.longitude ?? null }
    : p));
}

export function removeSavedPlace(places: readonly SavedPlace[], id: string): SavedPlace[] {
  return places.filter(p => p.id !== id);
}

/** The place whose name is exactly what was typed, or null. */
export function findSavedPlace(places: readonly SavedPlace[], query: string): SavedPlace | null {
  const key = savedPlaceKey(query);
  return key ? places.find(p => savedPlaceKey(p.name) === key) ?? null : null;
}

/** The place already saved with this location text, so the card doesn't offer to save it twice. */
export function savedPlaceWithText(places: readonly SavedPlace[], text: string): SavedPlace | null {
  const wanted = text.trim().toLowerCase();
  return wanted ? places.find(p => p.text.toLowerCase() === wanted) ?? null : null;
}

/**
 * Saved places whose names start with what is being typed, for the card's
 * suggestions. An exact name is not one: that resolves on its own
 * (`findSavedPlace`), and listing it too would offer the same place twice.
 */
export function suggestSavedPlaces(places: readonly SavedPlace[], query: string, limit = 3): SavedPlace[] {
  const key = savedPlaceKey(query);
  if (key.length < SAVED_PLACE_SUGGEST_MIN_LENGTH) return [];
  return places
    .filter(p => {
      const name = savedPlaceKey(p.name);
      return name !== key && name.startsWith(key);
    })
    .slice(0, limit);
}

export function readSavedPlaces(): SavedPlace[] {
  return parseSavedPlaces(dbGetSetting(SAVED_PLACES_KEY));
}

export function writeSavedPlaces(places: readonly SavedPlace[]): void {
  dbSetSetting(SAVED_PLACES_KEY, JSON.stringify(places));
}
