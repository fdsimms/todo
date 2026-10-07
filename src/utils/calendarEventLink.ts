import {
  calendarEventExists,
  createAllDayEvent,
  moveAllDayEvent,
  deleteCalendarEvent,
  type AllDayEventFields,
} from './calendarSync';
import { isDemoModeActive } from './demoState';

/**
 * A calendar event the app wrote, and the second name it keeps for it so the
 * event can be found again on a phone where the first one means nothing
 * (#2950).
 *
 * The first name is EventKit's local id (`calendarItemIdentifier`), what
 * expo-calendar calls an event's `id` and what every write addresses. Apple
 * documents it as meaningful on one device only and as lost on a full resync
 * with the calendar server. That is why the ids stay off the sync wire
 * (`SYNC_DEVICE_LOCAL_COLUMNS`), and it is also why a backup, which keeps them,
 * restored on a *new* phone used to duplicate every meal and deadline event:
 * the old phone's ids resolve to nothing there, so the next reconcile of each
 * row wrote a fresh event, while the old one had come down from the calendar
 * account and was still on the calendar beside it.
 *
 * The second name is the calendar server's id (`calendarItemExternalIdentifier`),
 * the one Apple means to identify an event across devices, read through the
 * `todo-eventkit-bridge` native module after every write. It lives beside the
 * local id in the same row, device-local in sync like it and kept in backups
 * like it, and is read in one place only: when the local id no longer resolves,
 * the event is looked up by it before anything fresh is written, and the row
 * adopts the local id the lookup finds (`writeAllDayEvent` for a meal or a
 * deadline, `adoptTimeBlock` in useTaskStore for a time block, each deciding
 * through `adoptableEventId` or `adoptableTimeBlockId` below).
 *
 * A delete reads it the same way (`deleteLinkedEvent`), so a meal or a
 * deadline deleted on a restored phone before its next reconcile, or a task
 * reopened there, takes the event with it rather than leaving it behind. A
 * completion event keeps one for that alone, since deleting it on uncomplete is
 * the only thing the app ever does to one after writing it.
 *
 * Nothing else reads it. Rows written before it existed gain one on their next
 * write, and once at launch (`backfillCalendarExternalIds`), so a backup taken
 * soon after the update carries them.
 */
export interface CalendarEventLink {
  /** EventKit's local id, or null when the row has no event on this device. */
  eventId: string | null;
  /** The calendar server's id for the same event, or null when none was read. */
  externalId: string | null;
}

export const NO_EVENT_LINK: CalendarEventLink = Object.freeze({ eventId: null, externalId: null });

/** One event the bridge found under a server id. See `ExternalEventMatch` in the bridge. */
export type ExternalEventMatch = import('todo-eventkit-bridge').ExternalEventMatch;

type EventKitBridge = typeof import('todo-eventkit-bridge');

/**
 * The door to `todo-eventkit-bridge` for the calendar writes, with the two
 * guards every such door here keeps (`widgetBridge()`, `healthBridge()`).
 *
 * - **Demo mode answers nothing.** A read is harmless on its own, but every
 *   caller here reads in order to write a real event, and demo mode writes
 *   nothing outside its own database.
 * - **Not iOS, or no native module in the binary, answers nothing**, and that
 *   guard is the bridge's own: it resolves its native half once, only on iOS,
 *   and each function returns empty without it. Checking `Platform` here as
 *   well would pull `react-native` into every test that reaches a meal or
 *   deadline reconcile, for no second answer.
 *
 * The require stays lazy for the reason it always is: a static import would
 * throw at module scope in Expo Go, rather than at the call.
 */
function eventKitBridge(): EventKitBridge | null {
  if (isDemoModeActive()) return null;
  try {
    return require('todo-eventkit-bridge') as EventKitBridge;
  } catch {
    return null;
  }
}

/** The server id of the event this device knows as `eventId`, or null. */
export async function readExternalEventId(eventId: string): Promise<string | null> {
  const bridge = eventKitBridge();
  if (!bridge || !eventId) return null;
  try {
    const ids = await bridge.externalIdentifiers([eventId]);
    const externalId = ids?.[eventId];
    return typeof externalId === 'string' && externalId ? externalId : null;
  } catch {
    return null;
  }
}

/**
 * Whether the bridge can read server ids at all on this device: iOS, a build
 * with the native module in it, and not demo mode. False means every read here
 * answers empty for want of the module rather than for want of ids, which a
 * one-time pass has to tell apart before it records itself as done.
 */
export function canReadExternalEventIds(): boolean {
  const bridge = eventKitBridge();
  if (!bridge) return false;
  try {
    return bridge.isEventKitBridgeAvailable();
  } catch {
    return false;
  }
}

/**
 * The server id of each of `eventIds` that resolves on this device and has
 * one, in one native call. Ids that name nothing, or an event the server
 * hasn't named yet, are left out. Empty on any failure.
 */
export async function readExternalEventIds(eventIds: readonly string[]): Promise<Record<string, string>> {
  const bridge = eventKitBridge();
  const ids = [...new Set(eventIds.filter(Boolean))];
  if (!bridge || ids.length === 0) return {};
  try {
    const found = await bridge.externalIdentifiers(ids);
    const out: Record<string, string> = {};
    for (const id of ids) {
      const externalId = found?.[id];
      if (typeof externalId === 'string' && externalId) out[id] = externalId;
    }
    return out;
  } catch {
    return {};
  }
}

/** Every event this device holds under the server id `externalId`. Empty on any failure. */
export async function eventsWithExternalId(externalId: string): Promise<ExternalEventMatch[]> {
  const bridge = eventKitBridge();
  if (!bridge || !externalId) return [];
  try {
    const matches = await bridge.eventsWithExternalIdentifier(externalId);
    return Array.isArray(matches) ? matches : [];
  } catch {
    return [];
  }
}

/**
 * The server id a link should hold once `found` has been read: its own when it
 * has one, else the one `found` holds for its local id, else null. What the
 * launch backfill patches each row in memory with, matching the database write
 * (`dbFillTaskCalendarExternalIds`), which applies the same rule.
 */
export function filledExternalId(
  eventId: string | null | undefined,
  externalId: string | null | undefined,
  found: Readonly<Record<string, string>>
): string | null {
  if (externalId) return externalId;
  return (eventId && found[eventId]) || null;
}

/**
 * `links` with one entry per local id, the first kept. A sync can report the
 * same removal from both of its transports.
 */
export function uniqueLinks(links: readonly CalendarEventLink[]): CalendarEventLink[] {
  const seen = new Set<string>();
  return links.filter(l => !!l.eventId && (seen.has(l.eventId) ? false : (seen.add(l.eventId), true)));
}

function uniqueById(matches: readonly ExternalEventMatch[]): ExternalEventMatch[] {
  const seen = new Set<string>();
  return matches.filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

/**
 * Which of the events found under a meal's or a deadline's server id is the
 * one the row wrote, or null to write a fresh one as before.
 *
 * Adopting is the less destructive of the two answers only while it's right:
 * a wrong pick rewrites somebody else's event. So this refuses to guess.
 *
 * - **Only an all-day event counts.** Both mirrors only ever write all-day
 *   events (`createAllDayEvent`, `moveAllDayEvent`), and the server id was read
 *   off one. A timed event under the same id is not the one this row wrote.
 * - **One of those, and it's the one**, whichever calendar it sits in. The
 *   rewrite that follows puts it in the calendar picked now, the move #2949
 *   gave every rewrite, which is what a restored phone needs: the calendar
 *   setting is device-local and isn't in the backup, so it may well have been
 *   picked again as a different calendar.
 * - **Several, and only one in the calendar picked now: that one.** Apple
 *   documents how copies of one event come to share a server id (an ICS file
 *   imported into two calendars, an invitation to an event in a calendar
 *   shared with you, a delegate's copy, a subscribed calendar added to two
 *   accounts), and says to choose between them "based on other factors, such
 *   as the calendar or source". The picked calendar is the one factor this row
 *   has.
 * - **Anything else is null**, and the caller writes a fresh event exactly as
 *   it did before this existed. A duplicate on the calendar is the known cost
 *   of that, and a visible one; moving the wrong event is neither.
 *
 * The event's day is deliberately not compared with the row's. The reconcile
 * that finds the event is most often the one moving the meal or the deadline to
 * a new day, so the event is expected on the day the row *had*, which the
 * reconcile doesn't carry; and the server id was read off this very event,
 * which the day could only second-guess.
 */
export function adoptableEventId(matches: readonly ExternalEventMatch[], calendarId: string): string | null {
  return oneOf(matches.filter(m => m.allDay), calendarId);
}

/**
 * Which event found under a completion event's server id is the one the task
 * wrote, or null to leave the calendar alone. `adoptableEventId`'s rule with a
 * timed event in place of an all-day one, since `logTaskCompletionToCalendar`
 * only ever writes a point in time, and the picked calendar being the
 * completion calendar. Read only to delete, which is the one thing the app does
 * to a completion event once it is written.
 */
export function completionEventMatch(matches: readonly ExternalEventMatch[], calendarId: string): string | null {
  return oneOf(matches.filter(m => !m.allDay), calendarId);
}

/** The one match, or the one match in `calendarId` when there are several. */
function oneOf(matches: readonly ExternalEventMatch[], calendarId: string): string | null {
  const unique = uniqueById(matches);
  if (unique.length === 1) return unique[0].id;
  const inPicked = unique.filter(m => m.calendarId === calendarId);
  return inPicked.length === 1 ? inPicked[0].id : null;
}

/**
 * Which event found under an agent request's server id is the one the request
 * wrote, or null to leave the calendar alone: the only one, or the only one in
 * the calendar requests are written to. Read only to change or delete an event
 * that same request wrote.
 */
export function requestEventMatch(matches: readonly ExternalEventMatch[], calendarId: string | null): string | null {
  return oneOf(matches, calendarId ?? '');
}

/**
 * Which event found under a time block's server id is the block, or null to
 * drop the pointer as before: exactly one, and nothing is inferred to choose
 * between several.
 *
 * Looser than `adoptableEventId` on purpose, and stricter in the one way left.
 * A block is the user's own event, made through the system sheet in whichever
 * calendar they chose there, so there is no setting to narrow copies by, and
 * the user is free to make it all-day in that sheet. Nor is a block ever
 * recreated when it can't be found: the task drops its pointer and offers a
 * fresh one. So adopting only ever saves a pointer that path would lose.
 */
export function adoptableTimeBlockId(matches: readonly ExternalEventMatch[]): string | null {
  const unique = uniqueById(matches);
  return unique.length === 1 ? unique[0].id : null;
}

/**
 * The server id to link with an event just written as `written`: the one read
 * back for it, or, when the read gave nothing (an older build, a server that
 * hasn't assigned one yet), the one already known for that same event. Null
 * for a different event, whose server id was never read.
 */
export function externalIdAfterWrite(
  read: string | null,
  written: string,
  known: CalendarEventLink
): string | null {
  if (read) return read;
  return known.eventId === written ? known.externalId : null;
}

async function linkAfterWrite(written: string, known: CalendarEventLink): Promise<CalendarEventLink> {
  return { eventId: written, externalId: externalIdAfterWrite(await readExternalEventId(written), written, known) };
}

/**
 * Brings the all-day event a row is linked to in line with `fields`, in
 * `calendarId`, and returns what the row should now be linked to. The one write
 * path for both mirrors (`syncMealEvent`, `syncDeadlineEvent`), which decide
 * *whether* a row has an event and leave *how* to this.
 *
 * 1. **Move the linked event** into the picked calendar with the new title and
 *    day (`moveAllDayEvent`, which keeps a hand-added location, note or alert).
 * 2. **Or, when that fails, delete whatever is left under the old id**, so a
 *    refused move can't leave the row on two calendars once a replacement is
 *    written. For an id that no longer resolves this does nothing.
 * 3. **Then look the event up by its server id** and move the one
 *    `adoptableEventId` picks, if it picks one (#2950). This is the restored
 *    backup on a new phone, and the local id lost to a full resync. After a
 *    refused move the event was just deleted and the lookup finds nothing.
 * 4. **Else write a fresh one**, resolve-or-shrug: better a new event than a
 *    row pointing at nothing.
 *
 * Each event written or moved has its server id read back, so a row gains one
 * on its next reconcile even when it had none. Returns `NO_EVENT_LINK` when
 * every write failed, which the caller treats as "try again next time".
 */
export async function writeAllDayEvent(
  link: CalendarEventLink,
  calendarId: string,
  fields: AllDayEventFields
): Promise<CalendarEventLink> {
  if (link.eventId) {
    const moved = await moveAllDayEvent(link.eventId, calendarId, fields);
    if (moved) return linkAfterWrite(moved, link);
    await deleteCalendarEvent(link.eventId);

    if (link.externalId) {
      const adopted = adoptableEventId(await eventsWithExternalId(link.externalId), calendarId);
      if (adopted) {
        const movedAdopted = await moveAllDayEvent(adopted, calendarId, fields);
        if (movedAdopted) return linkAfterWrite(movedAdopted, { eventId: adopted, externalId: link.externalId });
        // Refused as well. Left where it is rather than deleted: it was found
        // only by a server id, and a fresh event beside it is what the row got
        // before this existed.
      }
    }
  }

  const created = await createAllDayEvent(calendarId, fields);
  return created ? linkAfterWrite(created, NO_EVENT_LINK) : NO_EVENT_LINK;
}

/**
 * Deletes the event a row is linked to, by its local id, or by its server id
 * when the local id no longer names anything here (#2950). The delete half of
 * `writeAllDayEvent`'s fallback, for the three deletes a restored phone used to
 * miss: a meal or a deadline deleted before its next reconcile, and a task
 * reopened, each of which left the old phone's event on the calendar because
 * the only id tried named nothing on this one.
 *
 * - **A row with no local id has no event**, whatever else it holds, and this
 *   does nothing, as the delete it replaces did.
 * - **The server id is tried only when the local id names nothing.** Tried
 *   first, it would find the event the local id names and then, among copies
 *   sharing its server id, possibly another; asking the local id first means a
 *   working link never reaches a lookup at all. That costs one read per delete
 *   of a row holding a server id, which is what knowing costs: expo-calendar's
 *   own delete returns quietly for an id that names nothing.
 * - **`pick` chooses, and it refuses to guess** (`adoptableEventId` for a meal
 *   or a deadline, `completionEventMatch` for a completion). A delete is harder
 *   to take back than the rewrite an adoption does, so nothing looser than the
 *   rule an adoption already trusts.
 * - **Nothing is deleted in demo mode.** The write halves (`syncMealEvent`,
 *   `syncDeadlineEvent`, `createCompletionEvent`) each refuse there, and this is
 *   the one door their three deletes go through, so the gate lives here rather
 *   than in each of them: a seeded row carrying a real event id would otherwise
 *   have its event deleted from the user's calendar when the demo removed it.
 *
 * Fire-and-forget like the delete it replaces, and never throws.
 */
export async function deleteLinkedEvent(
  link: CalendarEventLink,
  pick: (matches: readonly ExternalEventMatch[]) => string | null
): Promise<void> {
  if (!link.eventId || isDemoModeActive()) return;
  try {
    if (link.externalId && !(await calendarEventExists(link.eventId))) {
      const found = pick(await eventsWithExternalId(link.externalId));
      if (found) await deleteCalendarEvent(found);
      return;
    }
    await deleteCalendarEvent(link.eventId);
  } catch {
    // Resolve-or-shrug, like deleteCalendarEvent itself.
  }
}
