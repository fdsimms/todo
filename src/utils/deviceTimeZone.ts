/**
 * The phone's IANA time zone, written to a synced setting so a sync peer that
 * has no clock of its own to trust can answer in the person's day.
 *
 * The peer this exists for is the MCP server (docs/arch/mcp-server.md). It runs
 * on a host whose zone is whatever the host was given, which on Fly is UTC, and
 * every logical-day answer it gives (`getLogicalToday`, `isTaskVisible`, a log
 * range's "today") is computed in that zone. So an evening question from New
 * York was answered about tomorrow. The server adopts this value after each
 * sync (`mcp/src/timeZone.ts`).
 *
 * Written only when it changes, because every settings write restamps the row
 * as a local edit, and a launch that rewrote the same zone each time would push
 * a row nobody changed. With two phones in different zones, the one opened last
 * wins, which is the zone the person is most likely in.
 *
 * The app itself reads nothing from this: a device always has its own clock.
 */
import { dbGetSetting, dbSetSetting } from '../db/database';

export const DEVICE_TIME_ZONE_KEY = 'deviceTimeZone';

/** True for a zone `Intl` accepts: "America/New_York", "UTC". */
export function isValidTimeZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** This device's zone, or null where the runtime cannot say. */
export function currentTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : null;
  } catch {
    return null;
  }
}

/** Record this device's zone if it differs from the stored one. Returns whether it wrote. */
export function recordDeviceTimeZone(
  zone: string | null = currentTimeZone(),
  read: (key: string) => string | null = dbGetSetting,
  write: (key: string, value: string) => void = dbSetSetting,
): boolean {
  if (!isValidTimeZone(zone)) return false;
  if (read(DEVICE_TIME_ZONE_KEY) === zone) return false;
  write(DEVICE_TIME_ZONE_KEY, zone);
  return true;
}
