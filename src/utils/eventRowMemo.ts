import { dbGetSetting, dbSetSetting } from '../db/database';

/**
 * The event rows Today drew the last time the calendar read landed, as their
 * shapes only (whether each had a location line, which makes it taller), and
 * on which logical day. Today draws a placeholder of each shape on a cold
 * launch until the read lands again, so the tasks under them don't jump down
 * when the events arrive.
 *
 * **Shapes and a day, never an event.** The calendar store keeps no copy of
 * the calendar on purpose (see useCalendarStore's header), and this doesn't
 * either: nothing here can go stale into a wrong title or time, only into
 * blank rows of the wrong height for the moment before the read replaces them.
 * Device-local: it is absent from SYNCED_SETTING_KEYS, since it describes what
 * this device's calendar read found.
 */
export const EVENT_ROW_MEMO_KEY = 'todayEventRowsSeen';

/**
 * The most placeholders drawn, whatever was remembered. A day of a dozen
 * meetings would otherwise open on a screenful of blank cards, which reads as
 * broken rather than as loading.
 */
export const MAX_EVENT_PLACEHOLDERS = 6;

/** One remembered row: whether it drew a location line under its time. */
export type EventRowShape = { withLocation: boolean };

/** The remembered rows for `todayKey`, or none when they are for another day or unreadable. */
export function readEventRowMemo(raw: string | null, todayKey: string): EventRowShape[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { dayKey?: unknown; locations?: unknown };
    if (parsed.dayKey !== todayKey || !Array.isArray(parsed.locations)) return [];
    return parsed.locations
      .slice(0, MAX_EVENT_PLACEHOLDERS)
      .map(located => ({ withLocation: located === true }));
  } catch {
    return [];
  }
}

/** The stored form of a day's rows: one flag per row, in order. */
export function eventRowMemoValue(todayKey: string, rows: readonly EventRowShape[]): string {
  return JSON.stringify({ dayKey: todayKey, locations: rows.map(r => r.withLocation) });
}

export function loadEventRowMemo(todayKey: string): EventRowShape[] {
  return readEventRowMemo(dbGetSetting(EVENT_ROW_MEMO_KEY), todayKey);
}

/** Writes only when the value changes, since Today recomputes its rows every minute. */
export function saveEventRowMemo(todayKey: string, rows: readonly EventRowShape[]): void {
  const value = eventRowMemoValue(todayKey, rows);
  if (dbGetSetting(EVENT_ROW_MEMO_KEY) === value) return;
  dbSetSetting(EVENT_ROW_MEMO_KEY, value);
}
