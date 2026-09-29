import { createAllDayEvent, moveAllDayEvent, deleteCalendarEvent, type AllDayEventFields } from './calendarSync';
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
 * Nothing else reads it. Deleting an event still goes by the local id alone, so
 * a row deleted on a restored phone before its next reconcile still leaves its
 * event behind: deleting something found only by a server id is a bigger step
 * than rewriting it, and was left out on purpose. A completion event keeps no
 * server id for the same reason, since the only thing the app ever does to one
 * after writing it is delete it.
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
  const allDay = uniqueById(matches.filter(m => m.allDay));
  if (allDay.length === 1) return allDay[0].id;
  const inPicked = allDay.filter(m => m.calendarId === calendarId);
  return inPicked.length === 1 ? inPicked[0].id : null;
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
