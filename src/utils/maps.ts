/**
 * Directions to a calendar event's location — read straight off `BusyEvent`
 * (see `calendarBusy.ts`), verbatim from EventKit. There's no place entity
 * behind it (see the `DeliverableKind` comment in `types/index.ts` on why a
 * bare string isn't one), so this only ever builds a link out, the same way
 * `phone.ts`/`email.ts` only ever build a `tel:`/`mailto:` out of a raw
 * string typed onto a task.
 *
 * Universal `https://` links rather than a custom scheme: Apple Maps, Google
 * Maps and Waze all open straight to the app when it's installed and fall back to the
 * browser when it isn't, so — like `telUrl`/`mailtoUrl` — there's nothing to
 * gate behind `Linking.canOpenURL` first.
 */
import { Platform } from 'react-native';

/** Which app to send directions to; the same values as the `mapsApp` setting. */
export type DirectionsApp = 'apple' | 'google' | 'waze';

/**
 * The location as a directions URL, or null if there's nothing to route to.
 * Deliberately gives no origin — the maps app fills in "current location",
 * which is what "get directions there" means from a calendar event.
 *
 * `app` is the `mapsApp` setting, and `coordinate` an event's map pin when it
 * has one (`eventCoordinate` in calendarSync.ts), which routes to the exact
 * spot instead of searching for the text. Every option is a universal link that opens
 * the app when it's installed and its website when it isn't. Off iOS there is
 * no Apple Maps, so "apple" falls back to Google Maps there, as it always has.
 */
/** A point to route to, when the location has one (an event's map pin). */
export interface DirectionsCoordinate {
  latitude: number;
  longitude: number;
}

function validCoordinate(c: DirectionsCoordinate | null | undefined): c is DirectionsCoordinate {
  return !!c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)
    && Math.abs(c.latitude) <= 90 && Math.abs(c.longitude) <= 180;
}

export function directionsUrl(
  raw: string | null | undefined,
  app: DirectionsApp = 'apple',
  coordinate?: DirectionsCoordinate | null,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // A pin routes to the exact spot; the text is a search the maps app has to
  // guess at. The text is still required: it's what says there is a place.
  if (validCoordinate(coordinate)) {
    const point = `${coordinate.latitude},${coordinate.longitude}`;
    if (app === 'waze') return `https://waze.com/ul?ll=${point}&navigate=yes`;
    if (app === 'apple' && Platform.OS === 'ios') return `https://maps.apple.com/?daddr=${point}`;
    return `https://www.google.com/maps/dir/?api=1&destination=${point}`;
  }
  const destination = encodeURIComponent(trimmed);
  if (app === 'waze') return `https://waze.com/ul?q=${destination}&navigate=yes`;
  if (app === 'apple' && Platform.OS === 'ios') return `https://maps.apple.com/?daddr=${destination}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

/** Whether this is worth putting a directions button on the row for. */
export function isMappable(raw: string | null | undefined): boolean {
  return directionsUrl(raw) !== null;
}
