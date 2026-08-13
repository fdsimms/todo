import { Platform } from 'react-native';
import { addDays } from 'date-fns/addDays';
import type { Calendar as DeviceCalendar, Event } from 'expo-calendar';
import type { BusyEvent } from './calendarBusy';

/**
 * The EventKit half of the calendar read and (as of #1493) the all-day
 * write — permission, which calendars exist, fetching a window of events,
 * and the handful of write calls a mirror needs. Everything that *decides*
 * anything lives elsewhere — `calendarBusy.ts` for what counts as busy,
 * `deadlineCalendarSync.ts` for when a deadline event should be
 * created/updated/deleted, `mealCalendarSync.ts` for the same question about
 * a planned meal (#1494); this file marshals and nothing else, so the rules
 * stay testable in a `node` environment with no native modules.
 *
 * The write calls are named for what they write (an all-day event), not for
 * who asked — the two projections differ in what they decide to put on the
 * calendar, never in how it's written, and a second copy per caller is how
 * they would drift.
 *
 * Modelled on `remindersImportSync.ts`, which is the app's other EventKit
 * consumer, and inherits its constraints — including the big one: expo-calendar
 * exposes no `EKEventStoreChanged` bridge, so there is nothing to subscribe to
 * and no way to be told an event moved (or, now, deleted out from under a
 * write this file made). Freshness comes from re-reading on foreground and on
 * focus. A calendar read is stale between those, and every caller has to be
 * fine with that.
 *
 * The deadline write goes through `createEventAsync`/`updateEventAsync`
 * /`deleteEventAsync` rather than `createEventInCalendarAsync`'s system
 * sheet, unlike the "put this task on my calendar" one-tap action #1492
 * describes and the bottom half of this file now implements — a deadline
 * reconciles silently on every save and every new
 * recurrence, and a UI sheet popping up on its own for a write nobody asked
 * to watch this moment would be its own kind of bug. That means it rides on
 * the same permission this file's read half already asks for, rather than a
 * separate write grant — EventKit's authorization for the events entity
 * covers both.
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

/**
 * Every calendar an app could plausibly write into — filtered to
 * `allowsModifications`, unlike `listEventCalendars`. That filter is exactly
 * the one this file's own read-side doc comment says "comes back when
 * something actually writes" — this is that write.
 */
export async function listWritableCalendars(): Promise<DeviceCalendar[]> {
  if (Platform.OS !== 'ios') return [];
  try {
    const calendars = await calendar().getCalendarsAsync(calendar().EntityTypes.EVENT);
    return [...calendars]
      .filter(c => c.allowsModifications)
      .sort((a, b) => (a.title ?? '').localeCompare(b.title ?? ''));
  } catch {
    return [];
  }
}

/**
 * The title and day an all-day event carries — nothing else. Shared by every
 * projection that writes one (a task's deadline, a planned meal), because
 * they differ in what they decide to write, never in how it's written.
 */
export interface AllDayEventFields {
  title: string;
  /** The event's calendar day, read as a whole day rather than a moment. */
  date: Date;
}

/**
 * Writes a fresh all-day event and returns its id, or null on any failure —
 * a missing calendar, a revoked permission, a device that stopped
 * responding. Callers (`deadlineCalendarSync.ts`, `mealCalendarSync.ts`)
 * treat null as "try again on the next reconcile" rather than an error to
 * surface — there is no user-facing failure state for a background write
 * nobody asked to watch.
 */
export async function createAllDayEvent(
  calendarId: string,
  fields: AllDayEventFields
): Promise<string | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    const id = await calendar().createEventAsync(calendarId, {
      title: fields.title,
      startDate: fields.date,
      // All-day events are exclusive on the end date in EventKit — one full
      // day is [date, date + 1).
      endDate: addDays(fields.date, 1),
      allDay: true,
    });
    return id ?? null;
  } catch {
    return null;
  }
}

/**
 * Rewrites an existing deadline event's title and date in place. Returns
 * false on any failure, including the event having been deleted out from
 * under the app — the caller falls back to creating a fresh one rather than
 * erroring, the same resolve-or-shrug rule as every other place a device id
 * can go stale.
 */
export async function updateAllDayEvent(
  eventId: string,
  fields: AllDayEventFields
): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    await calendar().updateEventAsync(eventId, {
      title: fields.title,
      startDate: fields.date,
      endDate: addDays(fields.date, 1),
      allDay: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Deletes a deadline event. Never throws — a missing id, an already-deleted
 * event and a revoked permission all mean the same thing from here: there's
 * nothing left to delete.
 */
export async function deleteCalendarEvent(eventId: string): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    await calendar().deleteEventAsync(eventId);
  } catch {
    // Already gone, or never existed — resolve-or-shrug.
  }
}

// ---- Time blocks (#1492) -------------------------------------------------
//
// The other half of the write, and it works the opposite way round to the
// deadline mirror above: these go through **the system event sheet**
// (`createEventInCalendarAsync` / `editEventInCalendarAsync`), which presents
// Apple's own event UI and hands back what the user did with it.
//
// That buys three things a `createEventAsync` version wouldn't. There is no
// calendar to pick in Settings, because the sheet has a calendar picker and
// it's already the one the user knows. There is no form to design, and so no
// second-rate copy of a date picker Apple ships. And there is nothing written
// that the user didn't watch being written — which is the whole reason this
// path can be a one-tap action on a task, where the deadline mirror had to be
// an opt-in toggle plus a named target calendar.
//
// The corollary is the rule this file holds to: **nothing here deletes a time
// block.** There is no `deleteEventAsync` call on this side, deliberately.
// An event the user saved in their own calendar app — possibly moved to a
// shared calendar, possibly with people invited — is not this app's to remove
// because a task got ticked off. Removing one is a tap in the sheet
// `presentTimeBlockEdit` opens, where it's their own decision in their own UI,
// and `deleted` comes back so the task can drop its pointer.

/** What the user did with an event sheet, and the event it left behind. */
export interface TimeBlockSheetResult {
  /** True if an event was saved or edited — as opposed to cancelled. */
  saved: boolean;
  /** True if the user deleted the event from inside the sheet. */
  deleted: boolean;
  /** The event's id, when iOS gave us one. */
  eventId: string | null;
}

const NO_RESULT: TimeBlockSheetResult = { saved: false, deleted: false, eventId: null };

/**
 * Presents the system "new event" sheet, prefilled with a task's block.
 *
 * No calendar id is passed: the sheet defaults to the user's default calendar
 * and lets them change it, which is a better answer than any id this app could
 * choose — and is why the time block, unlike the deadline mirror, needs no
 * setting of its own.
 */
export async function presentTimeBlockCreate(fields: {
  title: string;
  start: Date;
  end: Date;
  notes?: string;
}): Promise<TimeBlockSheetResult> {
  if (Platform.OS !== 'ios') return NO_RESULT;
  try {
    const result = await calendar().createEventInCalendarAsync({
      title: fields.title,
      startDate: fields.start,
      endDate: fields.end,
      notes: fields.notes,
    });
    return {
      saved: result.action === 'saved',
      deleted: result.action === 'deleted',
      eventId: result.id ?? null,
    };
  } catch {
    return NO_RESULT;
  }
}

/**
 * Presents the system sheet for an event that already exists, so the user can
 * move, resize or delete it.
 *
 * A `deleted` result is the one thing the caller must act on — that's the
 * user saying the block is gone, and the task's pointer has to go with it.
 */
export async function presentTimeBlockEdit(eventId: string): Promise<TimeBlockSheetResult> {
  if (Platform.OS !== 'ios') return NO_RESULT;
  try {
    const result = await calendar().editEventInCalendarAsync({ id: eventId });
    return {
      saved: result.action === 'saved',
      deleted: result.action === 'deleted',
      eventId: result.id ?? eventId,
    };
  } catch {
    // Deliberately *not* reported as a deletion. A throw here is most often an
    // event that's gone, but a refused permission and a sheet that failed to
    // present throw identically — and treating those as "the user deleted it"
    // would drop a pointer to an event that still exists. Whether the event is
    // really gone is `readTimeBlockEvent`'s question, and the caller asks it.
    return NO_RESULT;
  }
}

/** A time block as it currently stands on the device. */
export interface TimeBlockEvent {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
}

/**
 * Reads a block back, or null if it isn't there any more.
 *
 * `futureEvents: false` with no `instanceStartDate` resolves to the *first*
 * instance when the id names a recurring series — which it can, because the
 * user is free to add a repeat rule in the system sheet, and EventKit shares
 * one id across every instance of a series. Taking the first instance is the
 * one interpretation that's stable across calls; guessing an instance from the
 * task's due date would silently retarget as the task moved.
 */
export async function readTimeBlockEvent(eventId: string): Promise<TimeBlockEvent | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    const event = await calendar().getEventAsync(eventId, { futureEvents: false });
    if (!event) return null;
    const start = new Date(event.startDate as string | Date);
    const end = new Date(event.endDate as string | Date);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return { title: (event.title ?? '').trim(), start, end, allDay: !!event.allDay };
  } catch {
    return null;
  }
}

/**
 * Rewrites the two fields the task owns — title and end — leaving the start,
 * the calendar, the alerts, the invitees and everything else the user set in
 * the sheet exactly as they left them.
 *
 * `futureEvents: false` again, and it matters more here than on the read: on a
 * series it confines the change to one instance rather than rewriting every
 * future one, which is the conservative half of a choice EventKit forces.
 */
export async function updateTimeBlockEvent(
  eventId: string,
  fields: { title: string; endDate: Date }
): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    await calendar().updateEventAsync(
      eventId,
      { title: fields.title, endDate: fields.endDate },
      { futureEvents: false }
    );
    return true;
  } catch {
    return false;
  }
}
