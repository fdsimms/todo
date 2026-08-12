import { Platform } from 'react-native';
import type { Calendar as DeviceCalendar, Event } from 'expo-calendar';
import type { BusyEvent } from './calendarBusy';

/**
 * The EventKit half of the calendar read — permission, which calendars exist,
 * and fetching a window of events. Everything that *decides* anything lives in
 * `calendarBusy.ts`; this file marshals and nothing else, so the rules stay
 * testable in a `node` environment with no native modules.
 *
 * Modelled on `remindersImportSync.ts`, which is the app's other EventKit
 * consumer, and inherits its constraints — including the big one: expo-calendar
 * exposes no `EKEventStoreChanged` bridge, so there is nothing to subscribe to
 * and no way to be told an event moved. Freshness comes from re-reading on
 * foreground and on focus. A calendar read is stale between those, and every
 * caller has to be fine with that.
 *
 * Read-only by design for now. Nothing here creates, edits or deletes an
 * event — see #1492/#1493 for the writes, which are deliberately a separate
 * decision with a separate permission conversation.
 */

/**
 * Required where it's used rather than imported at the top, for the reason
 * spelled out in `remindersImportSync.ts`: expo-calendar resolves its native
 * half with `requireNativeModule` at module scope, and a static import would
 * hoist that throw into the app's own bundle evaluation — killing the whole
 * bundle before React mounts rather than just this feature. The type-only
 * imports above are erased at compile time and carry no such risk.
 */
function calendar(): typeof import('expo-calendar') {
  return require('expo-calendar');
}

export type CalendarPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/** Mirrors getRemindersPermission(), including the canAskAgain line. */
export async function getCalendarPermission(): Promise<CalendarPermission> {
  if (Platform.OS !== 'ios') return 'unsupported';
  try {
    const existing = await calendar().getCalendarPermissionsAsync();
    if (existing.granted) return 'granted';
    return existing.status === 'undetermined' || existing.canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export async function requestCalendarPermission(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const existing = await calendar().getCalendarPermissionsAsync();
    if (existing.granted) return true;
    const result = await calendar().requestCalendarPermissionsAsync();
    return result.granted;
  } catch {
    return false;
  }
}

/**
 * Every calendar on the device, title-sorted.
 *
 * `EntityTypes.EVENT` is passed explicitly — with no argument the native module
 * asks for reminders permission as well, which this read has no business
 * requesting. (The reminders drain passes `EntityTypes.REMINDER` for the mirror
 * image of the same reason.)
 *
 * Deliberately **not** filtered to `allowsModifications`, unlike the reminder
 * list picker: a read-only subscribed calendar — a work calendar shared to you,
 * a school term calendar — is exactly the kind whose events fill a day, and
 * refusing to read it because it can't be written to would be nonsense. That
 * filter comes back when something actually writes.
 *
 * Nor is it filtered to Google-backed sources. EventKit hands back calendars,
 * some of which happen to sync from Google; someone with one Google calendar
 * and one iCloud calendar wants both, and picking for them is not this app's
 * call. See #1495.
 */
export async function listEventCalendars(): Promise<DeviceCalendar[]> {
  if (Platform.OS !== 'ios') return [];
  try {
    const calendars = await calendar().getCalendarsAsync(calendar().EntityTypes.EVENT);
    return [...calendars].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
  } catch {
    return [];
  }
}

/** Sorted ids of the calendars that both exist right now and were picked. */
export function validCalendarIds(
  calendars: readonly DeviceCalendar[],
  selectedIds: readonly string[]
): string[] {
  const live = new Set(calendars.map(c => c.id));
  return selectedIds.filter(id => live.has(id));
}

function toBusyEvent(event: Event): BusyEvent | null {
  const start = event.startDate instanceof Date
    ? event.startDate.toISOString()
    : typeof event.startDate === 'string' ? event.startDate : null;
  const end = event.endDate instanceof Date
    ? event.endDate.toISOString()
    : typeof event.endDate === 'string' ? event.endDate : null;
  if (!event.id || !start || !end) return null;
  return {
    id: event.id,
    title: (event.title ?? '').trim(),
    start,
    end,
    allDay: !!event.allDay,
    calendarId: event.calendarId ?? '',
    location: event.location ?? null,
    // Passed through as written rather than interpreted here — `calendarBusy`
    // owns what they mean.
    status: String(event.status ?? ''),
    availability: String(event.availability ?? ''),
  };
}

/**
 * Every event in the chosen calendars between two dates.
 *
 * Returns null when the calendars couldn't be read at all, which the caller
 * needs to tell apart from a genuinely empty window — an empty day and a failed
 * read look identical as `[]`, and only one of them should make the app claim
 * the day is free.
 *
 * **Never pass an unvalidated or empty id array.** `getEventsAsync` reaches
 * `predicateForEvents(withStart:end:calendars:)`, whose `calendars: nil` means
 * *every calendar on the device* — so an empty array is at best undocumented
 * and at worst reads calendars the user didn't pick. Same rule the reminders
 * drain follows, and the same reason: cheap to rule out, not worth inferring.
 */
export async function fetchEvents(
  calendarIds: readonly string[],
  start: Date,
  end: Date
): Promise<BusyEvent[] | null> {
  if (Platform.OS !== 'ios') return null;
  if (calendarIds.length === 0) return [];
  try {
    const calendars = await calendar().getCalendarsAsync(calendar().EntityTypes.EVENT);
    const ids = validCalendarIds(calendars, calendarIds);
    // Every chosen calendar has gone. Not a failure — there is genuinely
    // nothing to read — but it is emphatically not "every calendar", which is
    // what an empty array would risk asking for.
    if (ids.length === 0) return [];
    const events = await calendar().getEventsAsync(ids, start, end);
    return events.map(toBusyEvent).filter((e): e is BusyEvent => e !== null);
  } catch {
    return null;
  }
}
