import { isDemoModeActive } from '../utils/demoState';
import { useSettingsStore } from '../store/useSettingsStore';
import { parsePlaceResults, PLACE_QUERY_MIN_LENGTH, type PlaceResult } from '../utils/places';

/**
 * Places in Apple Maps matching what someone is typing into an event's
 * location, for the quick-add card's suggestions and a person's Location field
 * (`usePlaceSuggestions`).
 *
 * **It sends what is typed to Apple**, through MapKit's search
 * (`searchPlaces` in `todo-eventkit-bridge`). That needs no key, so "no key, no
 * traffic" can't answer the privacy question, and it runs as you type rather
 * than on a tap. So it carries its own switch, `placeSuggestionsEnabled`, which
 * ships off: the rule for every keyless call (see Data flow in CLAUDE.md).
 * MapKit is not given the device's location; results are Apple's own ranking
 * for the words.
 *
 * **Nothing is stored here.** A picked place's text goes into the event's
 * location and its coordinate onto the event (`setStructuredLocation`), both in
 * the calendar rather than the app's database.
 *
 * Empty, without a request, for the switch off, demo mode (a demo's places are
 * invented and shouldn't reach Apple), and a query too short to be useful.
 */
export async function searchPlaces(query: string): Promise<PlaceResult[]> {
  if (isDemoModeActive()) return [];
  if (!useSettingsStore.getState().placeSuggestionsEnabled) return [];
  const trimmed = query.trim();
  if (trimmed.length < PLACE_QUERY_MIN_LENGTH) return [];
  try {
    const bridge = require('todo-eventkit-bridge') as typeof import('todo-eventkit-bridge');
    return parsePlaceResults(await bridge.searchPlacesRaw(trimmed));
  } catch {
    return [];
  }
}
