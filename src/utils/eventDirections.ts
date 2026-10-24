import { Linking } from 'react-native';
import { eventCoordinate, readEventJoinLink } from './calendarSync';
import { directionsUrl } from './maps';
import { haptics } from './haptics';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * Opens the maps app on an event's location: its map pin when it has one (a
 * place picked in quick add), read for this one event on the tap, else a search
 * for the text. Shared by Today's event row and the events sheet, so the two
 * can't route differently.
 *
 * Failing to open is silent: there is no toast infrastructure for a row-level
 * action, and https links need no `canOpenURL` check (see `maps.ts`).
 */
export async function openEventDirections(eventId: string, location: string | null | undefined): Promise<void> {
  const coordinate = await eventCoordinate(eventId);
  const url = directionsUrl(location, useSettingsStore.getState().mapsApp, coordinate);
  if (!url) return;
  haptics.tap();
  try {
    await Linking.openURL(url);
  } catch {
    // silently ignore
  }
}

/**
 * Opens an event's video call. The link lives in notes the app never keeps, so
 * it is read from the calendar on the tap (`readEventJoinLink`).
 */
export async function openEventJoinLink(eventId: string, occurrenceStart: string): Promise<void> {
  const link = await readEventJoinLink(eventId, occurrenceStart);
  if (!link) return;
  haptics.tap();
  try {
    await Linking.openURL(link);
  } catch {
    // silently ignore
  }
}
