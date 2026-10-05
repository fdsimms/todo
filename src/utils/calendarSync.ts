import { Platform } from 'react-native';
import { addDays } from 'date-fns/addDays';
import type {
  Alarm,
  Calendar as DeviceCalendar,
  Event,
  RecurrenceRule,
  RecurringEventOptions,
} from 'expo-calendar/legacy';
import type { BusyEvent } from './calendarBusy';
import { isDemoModeActive } from './demoState';
import type { EventRecurrence } from './quickEvent';

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
function calendar(): typeof import('expo-calendar/legacy') {
  return require('expo-calendar/legacy');
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

/** One calendar's outcome from a `fetchEvents` read. */
export interface CalendarReadStatus {
  /** How many events this calendar contributed to the window. */
  eventCount: number;
  /** False when this specific calendar's own `getEventsAsync` call threw. */
  ok: boolean;
}

/** A calendar's own name and color — what an event row needs to say where it came from. */
export interface CalendarInfo {
  title: string;
  color: string;
}

export interface FetchEventsResult {
  /** Every event across every calendar that could be read, unfiltered. */
  events: BusyEvent[];
  /**
   * One entry per chosen-and-still-live calendar, keyed by id (#1744). A
   * calendar missing from this map was never asked about — either it isn't
   * one of `calendarIds`, or it's since been removed from the device (see
   * `validCalendarIds`), which is a different, already-surfaced problem.
   */
  perCalendar: Record<string, CalendarReadStatus>;
  /**
   * Title and color for every chosen-and-still-live calendar, keyed by id.
   * Built from the same `getCalendarsAsync` call `validCalendarIds` already
   * needed, so an event row can name and color its source without a second
   * EventKit round trip.
   */
  calendarsById: Record<string, CalendarInfo>;
}

/**
 * Every event in the chosen calendars between two dates.
 *
 * Returns null when the calendars couldn't be read at all — permission
 * revoked, `getCalendarsAsync` itself failing — which the caller needs to
 * tell apart from a genuinely empty window: an empty day and a failed read
 * look identical as `[]`, and only one of them should make the app claim the
 * day is free.
 *
 * **One `getEventsAsync` call per calendar, not one batched call across all
 * of them (#1744).** A batched call fails or succeeds as a unit, so a single
 * calendar EventKit can't actually read right now — a shared calendar whose
 * access was revoked, a CalDAV account mid-resync — used to blank the whole
 * window and read as "calendar reading is broken" rather than naming the one
 * calendar at fault. Reading one at a time costs nothing a person would
 * notice (the window is 14 days, not a year, and this only runs on
 * foreground/focus) and turns that into `perCalendar`, which Settings uses to
 * say exactly which calendar(s) aren't contributing.
 *
 * **Never pass an unvalidated or empty id array to `getEventsAsync`.** It
 * reaches `predicateForEvents(withStart:end:calendars:)`, whose
 * `calendars: nil` means *every calendar on the device* — so an empty array
 * is at best undocumented and at worst reads calendars the user didn't pick.
 * Same rule the reminders drain follows, and the same reason: cheap to rule
 * out, not worth inferring. That's still true per-calendar here: each id is
 * already known live (from `validCalendarIds` below) before it's ever passed
 * as a single-element array.
 */
export async function fetchEvents(
  calendarIds: readonly string[],
  start: Date,
  end: Date
): Promise<FetchEventsResult | null> {
  if (Platform.OS !== 'ios') return null;
  if (calendarIds.length === 0) return { events: [], perCalendar: {}, calendarsById: {} };
  let calendars: DeviceCalendar[];
  try {
    calendars = await calendar().getCalendarsAsync(calendar().EntityTypes.EVENT);
  } catch {
    return null;
  }
  const ids = validCalendarIds(calendars, calendarIds);
  // Every chosen calendar has gone. Not a failure — there is genuinely
  // nothing to read — but it is emphatically not "every calendar", which is
  // what an empty array would risk asking for.
  if (ids.length === 0) return { events: [], perCalendar: {}, calendarsById: {} };

  const calendarsById: Record<string, CalendarInfo> = {};
  for (const id of ids) {
    const match = calendars.find(c => c.id === id);
    if (match) calendarsById[id] = { title: match.title ?? '', color: match.color ?? '' };
  }

  const events: BusyEvent[] = [];
  const perCalendar: Record<string, CalendarReadStatus> = {};
  for (const id of ids) {
    try {
      const raw = await calendar().getEventsAsync([id], start, end);
      const mapped = raw.map(toBusyEvent).filter((e): e is BusyEvent => e !== null);
      events.push(...mapped);
      perCalendar[id] = { eventCount: mapped.length, ok: true };
    } catch {
      perCalendar[id] = { eventCount: 0, ok: false };
    }
  }
  return { events, perCalendar, calendarsById };
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
 * The fields of an existing event an update has to send back unchanged, in
 * the shape the save takes.
 *
 * **Why an update has to send them at all.** expo-calendar's save
 * (`initializeEvent` in its `CalendarModule.swift`) assigns `location`,
 * `notes`, `alarms`, `isAllDay` and `availability` on every save, not only
 * when the details carry them, and its `Event` record declares the first
 * three non-optional with defaults of "" and [] (`Records/CalendarRecords.swift`).
 * So an update naming only the title and the day reset a location, a note or
 * an alert the user had added to the event by hand in the Calendar app, every
 * time the app rewrote it. Everything else the save touches (the calendar, the
 * dates, the URL, a repeat rule, the time zone) is assigned only when present,
 * which is why none of those are here: left out, they're left alone.
 *
 * **The read and the write disagree on the alarm shape**, so this is a
 * translation rather than a copy. The read (`serialize(alarms:)` in
 * `Conversions.swift`) gives `relativeOffset` in minutes as a fraction and
 * a location under `coord`; the write takes a whole number of minutes
 * (`relativeOffset: Int?`) and the location under `coords`, with a
 * non-optional `title`. A location alert whose coordinates didn't read back is
 * left out rather than written as the plain "at the time of the event" alert
 * its zero offset would otherwise make it.
 *
 * **Never null.** A null sent for one of the non-optional fields fails the
 * whole save natively, so a field the read didn't hold is simply omitted and
 * the save's own default applies, which is what it was going to be anyway.
 */
export type CarriedEventFields = Pick<
  Partial<Event>,
  'location' | 'notes' | 'alarms' | 'availability' | 'allDay'
>;

export function carriedEventFields(existing: unknown): CarriedEventFields {
  if (!existing || typeof existing !== 'object') return {};
  const event = existing as Record<string, unknown>;
  const carried: CarriedEventFields = {};
  if (typeof event.location === 'string') carried.location = event.location;
  if (typeof event.notes === 'string') carried.notes = event.notes;
  if (Array.isArray(event.alarms)) {
    carried.alarms = event.alarms.map(writableAlarm).filter((a): a is Alarm => a !== null);
  }
  if (typeof event.availability === 'string' && event.availability) {
    carried.availability = event.availability as Event['availability'];
  }
  if (typeof event.allDay === 'boolean') carried.allDay = event.allDay;
  return carried;
}

function writableAlarm(raw: unknown): Alarm | null {
  if (!raw || typeof raw !== 'object') return null;
  const alarm = raw as Record<string, unknown>;
  const location = alarm.structuredLocation;
  const place = writableAlarmLocation(location);
  // A location alert that can't be written back as one is not an alert to
  // turn into something else.
  if (location && !place) return null;

  const out: Alarm = {};
  if (typeof alarm.absoluteDate === 'string' && alarm.absoluteDate) {
    out.absoluteDate = alarm.absoluteDate;
  } else if (typeof alarm.relativeOffset === 'number' && Number.isFinite(alarm.relativeOffset)) {
    // Rounded because the write's field is an `Int`: a fraction of a minute
    // would fail the save, and nothing Calendar offers is finer than a minute.
    out.relativeOffset = Math.round(alarm.relativeOffset);
  }
  if (place) out.structuredLocation = place;
  return out.absoluteDate !== undefined || out.relativeOffset !== undefined || out.structuredLocation
    ? out
    : null;
}

function writableAlarmLocation(raw: unknown): NonNullable<Alarm['structuredLocation']> | null {
  if (!raw || typeof raw !== 'object') return null;
  const location = raw as Record<string, unknown>;
  const coord = (location.coord ?? location.coords) as Record<string, unknown> | null | undefined;
  const latitude = coord?.latitude;
  const longitude = coord?.longitude;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  return {
    title: typeof location.title === 'string' ? location.title : '',
    ...(location.proximity === 'enter' || location.proximity === 'leave'
      ? { proximity: location.proximity }
      : {}),
    ...(typeof location.radius === 'number' ? { radius: location.radius } : {}),
    coords: { latitude, longitude },
  };
}

/**
 * Every rewrite of an existing event goes through here: it reads the event
 * first and sends back what `carriedEventFields` says the save would otherwise
 * reset, with the fields the caller owns written over the top, so an update
 * changes only what the app owns.
 *
 * The read is best-effort. If it fails, the owned fields are still written,
 * which costs what every update cost before this existed rather than the
 * update itself; an event that has really gone fails the write too, and the
 * caller's own fallback takes it from there. `options` is passed to both, so
 * the instance read is the instance written.
 *
 * Throws whatever the write throws, for the caller to catch.
 */
async function rewriteEvent(
  eventId: string,
  owned: Omit<Partial<Event>, 'id'>,
  options?: RecurringEventOptions
): Promise<string> {
  let carried: CarriedEventFields = {};
  try {
    carried = carriedEventFields(await calendar().getEventAsync(eventId, options));
  } catch {
    // Unread: write the owned fields alone.
  }
  return calendar().updateEventAsync(eventId, { ...carried, ...owned }, options);
}

/**
 * Rewrites an existing all-day event's title and day, puts it in `calendarId`,
 * and returns the id EventKit reports for it afterwards. Null on any failure,
 * including the event having been deleted out from under the app: the caller
 * falls back to writing a fresh one rather than erroring, the same
 * resolve-or-shrug rule as every other place a device id can go stale.
 *
 * The calendar is in every rewrite because both mirrors write to a calendar
 * that is a setting the user can change: without it, the event stayed wherever
 * it was first created, so switching "Write meals to" (#2949) or "Write
 * deadlines to" from a shared calendar to a private one kept rewriting the old
 * events in the shared one. `EKCalendarItem.calendar` is settable, and
 * expo-calendar's save path assigns it when the details carry a `calendarId`
 * (`initializeEvent` in its `CalendarModule.swift`), so this is a move of the
 * same event rather than a delete and a fresh write. When the event is already
 * in that calendar it is a plain rewrite in place.
 *
 * **The id is read back rather than assumed.** The save returns
 * `calendarItemIdentifier`, and nothing in Apple's documentation promises it
 * survives a move to a calendar on another account; the caller links whatever
 * this returns.
 *
 * A location, a note or an alert added to the event by hand stays with it:
 * expo-calendar's save resets all three unless they're sent back, and
 * `rewriteEvent` sends them back. Invitees, the URL and a repeat rule were
 * never touched.
 */
export async function moveAllDayEvent(
  eventId: string,
  calendarId: string,
  fields: AllDayEventFields
): Promise<string | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    const id = await rewriteEvent(eventId, {
      calendarId,
      title: fields.title,
      startDate: fields.date,
      endDate: addDays(fields.date, 1),
      allDay: true,
    });
    return id || eventId;
  } catch {
    return null;
  }
}

/**
 * Whether `eventId` still names an event on this device. False for an id that
 * names nothing, and on any failure (no permission, not iOS), since from here
 * those are one answer: there is no event under this id to act on.
 *
 * Its own read rather than something `deleteCalendarEvent` reports, because
 * expo-calendar's delete returns quietly for an id that names nothing, and a
 * caller that also holds the calendar server's id needs to know which of the
 * two happened (`deleteLinkedEvent` in calendarEventLink.ts, #2950).
 */
export async function calendarEventExists(eventId: string): Promise<boolean> {
  if (Platform.OS !== 'ios' || !eventId) return false;
  try {
    await calendar().getEventAsync(eventId, { futureEvents: false });
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

/**
 * The title and span a point-in-time event carries. Separate from
 * `AllDayEventFields` rather than a shared shape with an optional end: an
 * all-day event is a whole calendar day and a timed one is a real interval,
 * and giving the timed shape its own `start`/`end` keeps a caller from
 * passing a bare `date` here and getting a zero-length event by accident.
 */
export interface TimedEventFields {
  title: string;
  start: Date;
  end: Date;
}

/**
 * Writes a fresh, silent, point-in-time event and returns its id, or null on
 * any failure — same resolve-or-shrug shape as `createAllDayEvent` above.
 * Modeled on it directly: only `allDay: false` and a real `start`/`end`
 * differ, since a timed event has no exclusive-end-date quirk to work around.
 */
export async function createTimedEvent(
  calendarId: string,
  fields: TimedEventFields
): Promise<string | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    const id = await calendar().createEventAsync(calendarId, {
      title: fields.title,
      startDate: fields.start,
      endDate: fields.end,
      allDay: false,
    });
    return id ?? null;
  } catch {
    return null;
  }
}

// ---- Events the user writes: time blocks (#1492), quick add, edits -------
//
// The other half of the write, and it works the opposite way round to the
// deadline mirror above: every one of these is a person's own tap on a card
// that showed them what would be written (`QuickEventSheet`). Time blocks
// used to go through Apple's own event sheet for that reason; the card now
// does the same job inside the app, and every write here goes straight
// through EventKit (`saveEventDirect`, `updateEventDirect`).
//
// The rule this file holds to: **nothing deletes an event on its own.** An
// event in the user's calendar, possibly moved to a shared calendar, possibly
// with people invited, is not this app's to remove because a task got ticked
// off or a sync ran. The one delete is `deleteEventDirect`, called only from
// the card's own Delete, after the user confirms it; the caller then drops
// whatever pointed at the event (a task's block, its people links).

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
 * Presents the system "new event" sheet for a plain event rather than a task's
 * block: the calendar-first half of the app, where the event is the thing
 * being made and nothing on the task list points at it.
 *
 * The user picks the calendar there (a Google account shows up in it like any other),
 * so the event syncs wherever that calendar does, and nothing is written that
 * they didn't watch being written. Anything the app wants to remember about
 * the event (who it's with) is kept on its own side, see `eventPeople.ts`.
 *
 * Its one caller now is the itinerary import (`calendarEventImport.ts`'s
 * `eventImportCreateFields`), which supplies `allDay` and `alarms` for an event
 * read off a confirmation and wants the form to check them. Quick add and the
 * screens that start a blank event save through `saveEventDirect` instead.
 */
export async function presentEventCreate(fields: {
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  location?: string;
  notes?: string;
  alarms?: Alarm[];
}): Promise<TimeBlockSheetResult> {
  if (Platform.OS !== 'ios') return NO_RESULT;
  try {
    const result = await calendar().createEventInCalendarAsync({
      title: fields.title,
      startDate: fields.start,
      endDate: fields.end,
      ...(fields.allDay ? { allDay: true } : {}),
      ...(fields.location ? { location: fields.location } : {}),
      ...(fields.notes ? { notes: fields.notes } : {}),
      ...(fields.alarms ? { alarms: fields.alarms } : {}),
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
 * An event's map pin, for its directions button: the coordinate of its
 * structured location, which a place picked from Apple Maps writes. Null for
 * an event with none (most typed locations), in demo mode, and on any failure,
 * all of which mean "route by the location text".
 *
 * Read one event at a time, when its button is tapped, rather than for every
 * event a list shows: a pin is only worth reading for the trip about to start.
 */
export async function eventCoordinate(eventId: string): Promise<{ latitude: number; longitude: number } | null> {
  if (Platform.OS !== 'ios' || !eventId || isDemoModeActive()) return null;
  try {
    const bridge = require('todo-eventkit-bridge') as typeof import('todo-eventkit-bridge');
    const raw = (await bridge.eventCoordinatesRaw([eventId]))[eventId];
    if (!raw || typeof raw !== 'object') return null;
    const { latitude, longitude } = raw as Record<string, unknown>;
    if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude };
  } catch {
    return null;
  }
}

/** What a quick-add event is saved with, with no system sheet in between. */
export interface EventSaveFields {
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
  location?: string;
  notes?: string;
  url?: string;
  alarms?: Alarm[];
  /** A repeat rule, as `eventRecurrenceFor` builds it. */
  recurrence?: EventRecurrence;
  /**
   * The coordinate of a place picked from Apple Maps for `location`. Written
   * as the event's structured location after the save, so Calendar can draw
   * its map and estimate travel time. Ignored without a `location`.
   */
  place?: { latitude: number; longitude: number };
  availability?: 'busy' | 'free';
  /** The calendar to write to. A missing or stale id falls back to the default. */
  calendarId?: string | null;
}

/**
 * The calendar a quick-add event goes into: the one asked for when it is still
 * writable, else the device's default calendar when that is, else the first
 * writable one. Shared with the quick-add card so the calendar chip names the
 * calendar the save will actually use, never one it would silently replace.
 */
export async function resolveEventCalendar(
  writable: readonly DeviceCalendar[],
  preferredId: string | null | undefined
): Promise<DeviceCalendar | undefined> {
  const preferred = writable.find(c => c.id === preferredId);
  if (preferred) return preferred;
  const fallback = await calendar().getDefaultCalendarAsync().catch(() => null);
  return writable.find(c => c.id === fallback?.id) ?? writable[0];
}

/**
 * Writes a new event straight into a calendar, the one write in this file
 * that a person asked for and did not watch happen in Apple's sheet. Quick add
 * uses it because the sheet was the thing being cut: the calendar, alert and
 * Busy/Free rows it asked for are chips on quick add now (remembered in
 * `quickEventDefaults.ts`), so what is saved is exactly what the card showed.
 *
 * Returns the event's id and the calendar it went into (so the caller can
 * remember the one actually used), or null on any failure, including calendar
 * access being refused. This asks for access itself, since a person tapping Add
 * is the deliberate ask the permission needs.
 *
 * **The calendar falls back rather than failing.** A remembered id can name a
 * calendar that has since been removed or made read-only, and an event that
 * didn't save for that reason would be the worst outcome for a quick capture:
 * the device's default calendar (when writable), then the first writable one.
 *
 * Nothing here deletes or rewrites; the "never deletes a time block" rule above
 * holds for this path too.
 */
export async function saveEventDirect(
  fields: EventSaveFields
): Promise<{ id: string; calendarId: string } | null> {
  if (Platform.OS !== 'ios') return null;
  try {
    if (!(await requestCalendarPermission())) return null;
    const target = await resolveEventCalendar(await listWritableCalendars(), fields.calendarId);
    if (!target) return null;
    const id = await calendar().createEventAsync(target.id, {
      title: fields.title,
      startDate: fields.start,
      endDate: fields.end,
      allDay: fields.allDay === true,
      ...(fields.location ? { location: fields.location } : {}),
      ...(fields.notes ? { notes: fields.notes } : {}),
      ...(fields.url ? { url: fields.url } : {}),
      ...(fields.alarms ? { alarms: fields.alarms } : {}),
      // Plain data to the library's enum-typed rule: the frequency words and
      // day numbers are the same values its enums hold.
      ...(fields.recurrence ? { recurrenceRule: fields.recurrence as unknown as RecurrenceRule } : {}),
      availability:
        fields.availability === 'free'
          ? calendar().Availability.FREE
          : calendar().Availability.BUSY,
    });
    if (!id) return null;
    // A second write, since expo-calendar's save has no structured location.
    // Best-effort: the event is saved either way, it just has no map.
    if (fields.place && fields.location) {
      try {
        const bridge = require('todo-eventkit-bridge') as typeof import('todo-eventkit-bridge');
        await bridge.setStructuredLocation(id, fields.location, fields.place.latitude, fields.place.longitude);
      } catch {
        // No bridge (an older build): the location text alone.
      }
    }
    return { id, calendarId: target.id };
  } catch {
    return null;
  }
}

/**
 * Opens an event in the system's own calendar UI (Apple's event view on iOS,
 * the default calendar app on Android). `occurrenceStart` picks the instance of
 * a repeating event. Returns false when it couldn't be opened (event gone, no
 * access); the caller has nothing to explain, so it just stays where it is.
 */
export async function openEventInSystemCalendar(eventId: string, occurrenceStart?: Date): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    await calendar().openEventInCalendarAsync({
      id: eventId,
      ...(occurrenceStart ? { instanceStartDate: occurrenceStart } : {}),
    });
    return true;
  } catch {
    return false;
  }
}

/** An existing event, as the edit card opens it. */
export interface EventForEdit {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string | null;
  notes: string | null;
  url: string | null;
  /** The first alert's offset, as EventKit stores it (minutes, negative before the start). Null for none. */
  alertOffset: number | null;
  availability: 'busy' | 'free';
  calendarId: string | null;
  /** Whether the event repeats; an edit then applies to the occurrence opened. */
  recurring: boolean;
  /** False when its calendar is read-only (a subscription, a shared calendar you can only view). */
  editable: boolean;
}

/**
 * Reads an event for the edit card, or null when it isn't there (deleted, no
 * access, not iOS). `occurrenceStart` picks the instance of a repeating event
 * the user tapped; without one EventKit answers with the first.
 */
export async function readEventForEdit(eventId: string, occurrenceStart?: string | null): Promise<EventForEdit | null> {
  if (Platform.OS !== 'ios' || !eventId) return null;
  try {
    const event = await calendar().getEventAsync(
      eventId,
      occurrenceStart ? { futureEvents: false, instanceStartDate: occurrenceStart } : { futureEvents: false },
    );
    if (!event) return null;
    const start = new Date(event.startDate as string | Date);
    const end = new Date(event.endDate as string | Date);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
    const firstAlarm = Array.isArray(event.alarms) ? event.alarms[0] : undefined;
    const calendarId = text(event.calendarId);
    const writable = await listWritableCalendars();
    const offset = firstAlarm && typeof firstAlarm.relativeOffset === 'number' ? firstAlarm.relativeOffset : null;
    return {
      title: event.title ?? '',
      start,
      end,
      allDay: event.allDay === true,
      location: text(event.location),
      notes: text(event.notes),
      url: text(event.url),
      alertOffset: offset,
      availability: event.availability === calendar().Availability.FREE ? 'free' : 'busy',
      calendarId,
      recurring: event.recurrenceRule != null,
      editable: calendarId !== null && writable.some(c => c.id === calendarId),
    };
  } catch {
    return null;
  }
}

/** The occurrence an edit or a delete applies to: that one instance, never the rest of the series. */
function occurrenceOptions(occurrenceStart?: string | null): RecurringEventOptions | undefined {
  return occurrenceStart ? { futureEvents: false, instanceStartDate: occurrenceStart } : undefined;
}

/**
 * Saves the edit card's changes to an existing event, through `rewriteEvent`
 * so anything the card doesn't show (invitees, a repeat rule, a time zone,
 * every alert past the first) is sent back unchanged. The fields the card
 * does show are written as they stand: an emptied location or alert clears
 * it. Notes and the URL are written only when given, so the card can leave
 * them alone when nobody touched the field. Resolves the event's id (EventKit
 * can hand back a new one for a moved occurrence), or null on any failure.
 */
export async function updateEventDirect(
  eventId: string,
  fields: EventSaveFields,
  occurrenceStart?: string | null,
): Promise<string | null> {
  if (Platform.OS !== 'ios' || isDemoModeActive()) return null;
  try {
    if (!(await requestCalendarPermission())) return null;
    const writable = await listWritableCalendars();
    const calendarId = writable.some(c => c.id === fields.calendarId) ? fields.calendarId : undefined;
    const owned: Omit<Partial<Event>, 'id'> = {
      title: fields.title,
      startDate: fields.start,
      endDate: fields.end,
      allDay: fields.allDay === true,
      location: fields.location ?? '',
      alarms: fields.alarms ?? [],
      availability: fields.availability === 'free' ? calendar().Availability.FREE : calendar().Availability.BUSY,
      ...(calendarId ? { calendarId } : {}),
      ...(fields.notes !== undefined ? { notes: fields.notes } : {}),
      ...(fields.url !== undefined ? { url: fields.url } : {}),
    };
    const id = (await rewriteEvent(eventId, owned, occurrenceOptions(occurrenceStart))) || eventId;
    if (fields.place && fields.location) {
      try {
        const bridge = require('todo-eventkit-bridge') as typeof import('todo-eventkit-bridge');
        await bridge.setStructuredLocation(id, fields.location, fields.place.latitude, fields.place.longitude);
      } catch {
        // No bridge (an older build): the location text alone.
      }
    }
    return id;
  } catch {
    return null;
  }
}

/**
 * Deletes an event, or one occurrence of a repeating one. Only ever called
 * from the edit card's Delete, after the user confirms (see the rule at the
 * top of this section). True when it went; false on any failure, in which
 * case the caller keeps whatever pointed at the event.
 */
export async function deleteEventDirect(eventId: string, occurrenceStart?: string | null): Promise<boolean> {
  if (Platform.OS !== 'ios' || isDemoModeActive()) return false;
  try {
    await calendar().deleteEventAsync(eventId, occurrenceOptions(occurrenceStart) ?? { futureEvents: false });
    return true;
  } catch {
    return false;
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
 * The alerts, the location and the notes survive because `rewriteEvent` reads
 * them back and sends them with the write, not because leaving them out of the
 * details would: expo-calendar's save resets all three when they're missing,
 * and until that read existed every retitle of a block cleared the alert the
 * user had set on it in the sheet.
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
    await rewriteEvent(
      eventId,
      { title: fields.title, endDate: fields.endDate },
      { futureEvents: false }
    );
    return true;
  } catch {
    return false;
  }
}
