/**
 * Directions to a calendar event's location — read straight off `BusyEvent`
 * (see `calendarBusy.ts`), verbatim from EventKit. There's no place entity
 * behind it (see the `DeliverableKind` comment in `types/index.ts` on why a
 * bare string isn't one), so this only ever builds a link out, the same way
 * `phone.ts`/`email.ts` only ever build a `tel:`/`mailto:` out of a raw
 * string typed onto a task.
 *
 * Universal `https://` links rather than a custom scheme: Apple/Google Maps
 * both open straight to the app when it's installed and fall back to the
 * browser when it isn't, so — like `telUrl`/`mailtoUrl` — there's nothing to
 * gate behind `Linking.canOpenURL` first.
 */
import { Platform } from 'react-native';

/**
 * The location as a directions URL, or null if there's nothing to route to.
 * Deliberately gives no origin — the maps app fills in "current location",
 * which is what "get directions there" means from a calendar event.
 */
export function directionsUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const destination = encodeURIComponent(trimmed);
  return Platform.OS === 'ios'
    ? `https://maps.apple.com/?daddr=${destination}`
    : `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

/** Whether this is worth putting a directions button on the row for. */
export function isMappable(raw: string | null | undefined): boolean {
  return directionsUrl(raw) !== null;
}
