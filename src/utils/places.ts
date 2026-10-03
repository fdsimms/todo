/**
 * A place picked from Apple Maps' suggestions for an event's location, and the
 * text it is written as. The search itself is `src/services/placeSearch.ts`;
 * this is the part that can be tested.
 */
export interface PlaceResult {
  /** The place's own name ("Joe's Pizza"), or null for a bare address. */
  name: string | null;
  /** The postal address, or null when MapKit gave none. */
  address: string | null;
  latitude: number;
  longitude: number;
}

/** Validates the native search's answer, dropping anything malformed. */
export function parsePlaceResults(raw: readonly unknown[]): PlaceResult[] {
  const out: PlaceResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { name, address, latitude, longitude } = item as Record<string, unknown>;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') continue;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    const n = typeof name === 'string' && name.trim() ? name.trim() : null;
    const a = typeof address === 'string' && address.trim() ? address.trim() : null;
    if (!n && !a) continue;
    out.push({ name: n, address: a, latitude, longitude });
  }
  return out;
}

/**
 * What a picked place is written into the event's location as: the name and
 * the address, so Calendar and any maps app routing by text land on the same
 * spot. The name is left off when the address already starts with it, which
 * is how an address-only result comes back ("7 Carmine St" named "7 Carmine St").
 */
export function placeLocationText(place: PlaceResult): string {
  if (!place.name) return place.address ?? '';
  if (!place.address) return place.name;
  if (place.address.toLowerCase().startsWith(place.name.toLowerCase())) return place.address;
  return `${place.name}, ${place.address}`;
}

/** The second line of a suggestion row: the address, unless it would repeat the name. */
export function placeSubtitle(place: PlaceResult): string | null {
  if (!place.name || !place.address) return null;
  return placeLocationText(place) === place.address ? null : place.address;
}

/** Fewer characters than this isn't worth a request: "jo" matches half a city. */
export const PLACE_QUERY_MIN_LENGTH = 3;
