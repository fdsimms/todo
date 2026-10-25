import type { AlarmOverride } from '../types';

/**
 * Reads `Alarm.override` back from its column. A module of its own, importing
 * nothing but types, so database.ts can read it without pulling in the date
 * helpers morningAlarm.ts uses (which reach back into the database through
 * the settings store). The rules are in morningAlarm.ts.
 */

/** A stored override, or null for anything malformed. */
export function parseAlarmOverride(json: unknown): AlarmOverride | null {
  if (typeof json !== 'string' || json === '') return null;
  try {
    const o = JSON.parse(json) as Partial<AlarmOverride>;
    if (typeof o.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) return null;
    if (!Number.isInteger(o.hour) || o.hour! < 0 || o.hour! > 23) return null;
    if (!Number.isInteger(o.minute) || o.minute! < 0 || o.minute! > 59) return null;
    return { date: o.date, hour: o.hour!, minute: o.minute! };
  } catch {
    return null;
  }
}
