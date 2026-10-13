import type { SavedPlace } from './savedPlaces';

/**
 * Which saved place a position is at, for the mood log's "At home" suggestion.
 * Pure: the position is read in `moodPlaceNow.ts`, and the sheet only ever
 * *offers* the tag (see `seededContextTags` and docs/arch/mood-log.md).
 *
 * **A fix that can't tell is no answer, never a wrong one.** A cell-tower fix
 * can be a kilometer off, and "At the office" offered from one is the app
 * telling somebody where they are on the strength of a guess. So a fix with no
 * reported accuracy, or a coarse one, matches nothing. Being somewhere that
 * isn't a saved place also says nothing: there is no "Away" or "Out" tag,
 * since the absence of a match is not a fact about the day.
 */
export const PLACE_MATCH_RADIUS_M = 150;
/** The coarsest fix still trusted to be inside a place's radius. */
export const PLACE_MAX_FIX_ERROR_M = 100;

export interface PlaceFix {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
}

const EARTH_RADIUS_M = 6371000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in meters (haversine). */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The places that can be matched at all: opted in, with a pin. */
export function moodPlacesOf(places: readonly SavedPlace[]): SavedPlace[] {
  return places.filter(p => p.moodTag && p.latitude !== null && p.longitude !== null);
}

/** The context tag a place offers. */
export function placeTagName(place: Pick<SavedPlace, 'name'>): string {
  return `At ${place.name}`;
}

/** The nearest opted-in place the fix is inside, or null. */
export function placeAt(places: readonly SavedPlace[], fix: PlaceFix | null): SavedPlace | null {
  if (!fix || fix.accuracyM === null || !Number.isFinite(fix.accuracyM) || fix.accuracyM > PLACE_MAX_FIX_ERROR_M) {
    return null;
  }
  let best: SavedPlace | null = null;
  let bestDistance = Infinity;
  for (const place of moodPlacesOf(places)) {
    const d = distanceMeters(fix, { latitude: place.latitude!, longitude: place.longitude! });
    if (d <= PLACE_MATCH_RADIUS_M && d < bestDistance) {
      best = place;
      bestDistance = d;
    }
  }
  return best;
}

/** The tag to offer for this fix, or null. */
export function placeTagAt(places: readonly SavedPlace[], fix: PlaceFix | null): string | null {
  const place = placeAt(places, fix);
  return place ? placeTagName(place) : null;
}
