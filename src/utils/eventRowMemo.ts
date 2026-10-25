import { dbGetSetting, dbSetSetting } from '../db/database';

/**
 * How many event rows Today drew the last time the calendar read landed, and
 * on which logical day. Today draws that many placeholder rows on a cold
 * launch until the read lands again, so the tasks under them don't jump down
 * when the events arrive.
 *
 * **A count and a day, never an event.** The calendar store keeps no copy of
 * the calendar on purpose (see useCalendarStore's header), and this doesn't
 * either: nothing here can go stale into a wrong title or time, only into the
 * wrong number of blank rows for the moment before the read replaces them.
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

/** The remembered count for `todayKey`, or 0 when it is for another day or unreadable. */
export function readEventRowMemo(raw: string | null, todayKey: string): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { dayKey?: unknown; count?: unknown };
    if (parsed.dayKey !== todayKey || typeof parsed.count !== 'number' || !Number.isFinite(parsed.count)) return 0;
    return Math.max(0, Math.min(MAX_EVENT_PLACEHOLDERS, Math.floor(parsed.count)));
  } catch {
    return 0;
  }
}

/** The stored form of a count for a day. */
export function eventRowMemoValue(todayKey: string, count: number): string {
  return JSON.stringify({ dayKey: todayKey, count: Math.max(0, Math.floor(count)) });
}

export function loadEventRowMemo(todayKey: string): number {
  return readEventRowMemo(dbGetSetting(EVENT_ROW_MEMO_KEY), todayKey);
}

/** Writes only when the value changes, since Today recomputes its rows every minute. */
export function saveEventRowMemo(todayKey: string, count: number): void {
  const value = eventRowMemoValue(todayKey, count);
  if (dbGetSetting(EVENT_ROW_MEMO_KEY) === value) return;
  dbSetSetting(EVENT_ROW_MEMO_KEY, value);
}
