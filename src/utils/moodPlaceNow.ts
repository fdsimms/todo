import { getCurrentLocation } from './weatherLocation';
import { moodPlacesOf, placeTagAt } from './moodPlaces';
import { readSavedPlaces } from './savedPlaces';

/**
 * The context tag for where the phone is right now, or null for every reason
 * there isn't one: no saved place opted in (which is also why nothing reads the
 * location at all then), no permission, demo mode, a coarse fix, or being
 * somewhere that isn't a saved place. Never asks for permission, the same
 * stance `getCurrentLocation` takes; the switch on a saved place is the ask.
 */
export async function moodPlaceTagNow(): Promise<string | null> {
  const places = readSavedPlaces();
  if (moodPlacesOf(places).length === 0) return null;
  const fix = await getCurrentLocation({ accuracy: 'balanced' });
  if (!fix) return null;
  return placeTagAt(places, { ...fix, accuracyM: fix.accuracyM ?? null });
}
