import { isDemoModeActive } from '../utils/demoState';
import { useSettingsStore } from '../store/useSettingsStore';
import { parseSubwayAlerts, type TransitSnapshot } from '../utils/transitAlerts';

/**
 * The MTA's subway service alerts, over the network.
 *
 * **No key**, which is why it carries its own switch (`transitAlerts`, off by
 * default) rather than riding on anything else. That is `productLookup.ts`'s
 * reason: with no key to paste, nothing would stop it running, so turning it
 * on has to be something a person does. What it sends is a plain GET for the
 * whole city's alerts. Nothing about the user's trips, lines or calendar goes
 * with it; which lines matter is decided on the device afterwards.
 *
 * **Nothing is stored.** The snapshot lives in `useTransitStore`'s memory and
 * is read again when it goes stale, the same terms the weather has.
 */

const SUBWAY_ALERTS_URL =
  'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json';

/** Matching `weatherLookup.ts`: a slow answer means no note, not a wait. */
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * The current alerts, or null for every reason there might not be any: the
 * switch being off, demo mode, no network, a bad response or a timeout. A
 * feed that answered with no alerts at all is a snapshot with an empty list,
 * which is a different answer ("checked, nothing on") from null ("couldn't
 * check").
 */
export async function fetchTransitSnapshot(): Promise<TransitSnapshot | null> {
  if (isDemoModeActive()) return null;
  if (!useSettingsStore.getState().transitAlerts) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(SUBWAY_ALERTS_URL, {
      headers: { Accept: 'application/json' },
      // Cast and an untyped body for the reason httpSyncTransport.ts gives:
      // mcp/ reaches this file and typechecks it against Node's fetch.
      signal: controller.signal as unknown as RequestInit['signal'],
    });
    if (!response.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await response.json();
    if (!body || !Array.isArray(body.entity)) return null;
    return { alerts: parseSubwayAlerts(body), fetchedAt: new Date().toISOString() };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
