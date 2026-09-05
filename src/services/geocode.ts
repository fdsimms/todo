import { isDemoModeActive } from '../utils/demoState';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * A place name to a latitude and longitude, over the network.
 *
 * **Open-Meteo's geocoding API, and no key**, the same source and the same
 * terms as `weatherLookup.ts` beside it. It exists because a forecast needs
 * coordinates and a trip's `Project.destination` is free text: "Lisbon" is what
 * somebody types, and nothing on the device turns that into a point on a map.
 *
 * **It carries its own switch** (`destinationForecastEnabled`), off by default,
 * for `productLookup.ts`'s reason rather than the general one. Everything
 * behind the user's own Anthropic key is inert until they paste one in, so "no
 * key, no traffic" answers the privacy question for it. Neither this nor the
 * forecast needs a key, so nothing would stop them running, and this one sends
 * a place somebody typed to a third party. That is a thing to opt into rather
 * than a thing to find out about.
 *
 * **Nothing is stored.** The coordinates are handed straight to the forecast
 * and forgotten; `Project.destination` stays the free text it was. A geocoded
 * pair written back onto the row would be a second, staler answer to a question
 * this can just ask again, and "Mum's" would have nothing to write.
 */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/** Matching `weatherLookup.ts`: a slow answer means no forecast line, not a wait. */
const REQUEST_TIMEOUT_MS = 8_000;

export interface GeocodedPlace {
  latitude: number;
  longitude: number;
  /** What the gazetteer calls it, for the line to name rather than echoing the query. */
  name: string;
}

/**
 * The first match for `query`, or null for every reason there might not be one
 * — the switch being off, demo mode, no network, nothing found, a bad response,
 * or a timeout. Every caller treats them the same way: no forecast line.
 *
 * **Demo mode asks nothing**, the refusal every integration here makes: a demo
 * trip's destination is invented, and looking it up would put real traffic on
 * the network about fiction.
 */
export async function geocodePlace(query: string): Promise<GeocodedPlace | null> {
  if (isDemoModeActive()) return null;
  if (!useSettingsStore.getState().destinationForecastEnabled) return null;
  const trimmed = query.trim();
  if (!trimmed) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const url = `${GEOCODE_URL}?name=${encodeURIComponent(trimmed)}&count=1&format=json`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const body = await response.json();
    const hit = body?.results?.[0];
    const latitude = hit?.latitude;
    const longitude = hit?.longitude;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    return { latitude, longitude, name: typeof hit?.name === 'string' ? hit.name : trimmed };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
