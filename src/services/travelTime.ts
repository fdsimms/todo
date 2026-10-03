import { isDemoModeActive } from '../utils/demoState';
import { useSettingsStore } from '../store/useSettingsStore';
import type { BusyEvent } from '../utils/calendarBusy';
import type { TravelMode, TravelOrigin } from '../utils/travelTasks';

/**
 * How long the trip to an event takes, from where the phone is now or from a
 * saved place (`origin`), from Apple Maps (`estimateTravelTime` in `todo-eventkit-bridge`, MapKit's ETA).
 *
 * **It sends the event's address and the starting point to Apple**, which is
 * the phone's position or the saved place's coordinates. Neither
 * needs a key, and it runs because time passed rather than because someone
 * tapped, so it is behind its own switch, `travelEstimates`, which ships off
 * (Data flow in CLAUDE.md). With no `origin` the position is read by
 * MapKit itself under the app's location permission; nothing here reads or
 * keeps it.
 *
 * Null, with no request, for the switch off (or travel tasks off), demo mode
 * (the demo's events are invented), and an event with no location; and null
 * for every failure on the way (no permission, nothing found, no route).
 * Every caller treats them alike: no estimate, so the typed lead applies.
 */
export async function estimateTravelMinutes(
  event: Pick<BusyEvent, 'id' | 'location'>,
  departAt: Date,
  mode: TravelMode,
  origin: TravelOrigin | null = null,
): Promise<number | null> {
  if (isDemoModeActive()) return null;
  const settings = useSettingsStore.getState();
  if (!settings.travelTasks || !settings.travelEstimates) return null;
  const address = (event.location ?? '').trim();
  if (!address) return null;
  try {
    const bridge = require('todo-eventkit-bridge') as typeof import('todo-eventkit-bridge');
    return await bridge.estimateTravelTime(event.id, address, departAt, mode, origin);
  } catch {
    return null;
  }
}
