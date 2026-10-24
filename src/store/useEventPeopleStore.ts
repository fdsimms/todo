import { create } from 'zustand';
import type { BusyEvent } from '../utils/calendarBusy';
import {
  EMPTY_EVENT_PEOPLE,
  type EventPeopleIndex,
  indexEventPeople,
  legacyEventPeopleRows,
  movedPeopleLinks,
  peopleForEvent,
  planEventPeopleWrite,
  staleEventPeopleIds,
} from '../utils/eventPeople';
import type { EventPeopleLink } from '../types';
import { deleteEventDirect, rescheduleEventDirect, saveEventDirect, updateEventDirect, type EventSaveFields } from '../utils/calendarSync';
import { isDemoModeActive } from '../utils/demoState';
import { generateId } from '../utils/id';
import {
  dbDeleteEventPeopleLinks,
  dbDeleteSetting,
  dbGetAllEventPeopleLinks,
  dbGetSetting,
  dbSetSetting,
  dbUpsertEventPeopleLink,
} from '../db/database';
import { useCalendarStore } from './useCalendarStore';

/**
 * Where links lived before they had a table (device-local, one JSON blob).
 * Read once by the migration below and then deleted. Still listed in
 * `DEVICE_ID_SETTING_KEYS` so a backup taken mid-upgrade never carries it.
 */
export const EVENT_PEOPLE_SETTING_KEY = 'calendarEventPeople';
/** Ends `_done`, which keeps it off the sync wire like every migration flag. */
export const EVENT_PEOPLE_MIGRATION_FLAG = 'event_people_links_migration_done';

/**
 * The server id for each local EventKit id, from the native module. Lazily
 * required so Jest and Android never load `expo-modules-core`, and an empty
 * answer on any failure: the local id is always a working fallback.
 */
async function readExternalIds(localIds: string[]): Promise<Record<string, string>> {
  if (localIds.length === 0) return {};
  try {
    const bridge = require('todo-eventkit-bridge') as typeof import('todo-eventkit-bridge');
    return await bridge.externalIdentifiers(localIds);
  } catch {
    return {};
  }
}

let calendarSubscribed = false;

interface EventPeopleState {
  rows: EventPeopleLink[];
  /** Rows grouped by event key, plus the server ids known so far. What readers pass around. */
  links: EventPeopleIndex;
  loaded: boolean;
  /**
   * Loads the table (migrating the old setting once), prunes rows past the
   * history window, and starts following the calendar store so server ids are
   * read for whatever events it holds.
   */
  initialize: () => void;
  /** Reads server ids for any of these events not already known. */
  resolveExternalIds: (events: readonly Pick<BusyEvent, 'id'>[]) => Promise<void>;
  /**
   * Moves a link onto the slot its event now sits in, for an event moved
   * outside the app (`movedPeopleLinks` has the rules). The edit card does the
   * same for its own saves in `updateEvent`.
   */
  followMovedEvents: () => void;
  peopleFor: (event: Pick<BusyEvent, 'id' | 'start'>) => string[];
  setPeople: (event: Pick<BusyEvent, 'id' | 'start' | 'end' | 'title'>, personIds: readonly string[]) => void;
  /**
   * Writes the event straight into the calendar, with no system sheet, and
   * links it to `personIds`. Resolves the id and calendar it went into, or null
   * when nothing was saved (access refused, no writable calendar, demo mode).
   * **Off in demo mode**: the event would land in the real calendar, which is
   * exactly the write outside the demo database `CLAUDE.md` rules out.
   */
  saveEvent: (
    fields: EventSaveFields,
    personIds?: readonly string[]
  ) => Promise<{ id: string; calendarId: string } | null>;
  /**
   * Saves the edit card's changes to an existing event (one occurrence of a
   * repeating one) and moves its people links along with it: they are keyed
   * by the occurrence's start, so a moved event would otherwise lose who it
   * is with. Resolves the event's id, or null when nothing was saved.
   */
  updateEvent: (
    eventId: string,
    before: Pick<BusyEvent, 'start' | 'end' | 'title'>,
    fields: EventSaveFields,
    personIds: readonly string[],
    occurrenceStart?: string | null,
  ) => Promise<string | null>;
  /**
   * Moves an event (one occurrence of a repeating one) to new times, the Day
   * view's drag and resize, and carries the people linked to it along: the
   * link is keyed by the occurrence's start, so a move without this would
   * drop who the event is with. Resolves the event's id, or null on failure.
   */
  moveEvent: (event: BusyEvent, start: Date, end: Date) => Promise<string | null>;
  /**
   * Deletes an event (one occurrence of a repeating one) and the people links
   * on it. Only ever called from the edit card's Delete, once confirmed.
   */
  deleteEvent: (eventId: string, occurrence: Pick<BusyEvent, 'start' | 'end' | 'title'>) => Promise<boolean>;
}

export const useEventPeopleStore = create<EventPeopleState>((set, get) => ({
  rows: [],
  links: EMPTY_EVENT_PEOPLE,
  loaded: false,

  initialize: () => {
    if (dbGetSetting(EVENT_PEOPLE_MIGRATION_FLAG) === null) {
      const legacy = legacyEventPeopleRows(dbGetSetting(EVENT_PEOPLE_SETTING_KEY), generateId, new Date().toISOString());
      legacy.forEach(dbUpsertEventPeopleLink);
      dbDeleteSetting(EVENT_PEOPLE_SETTING_KEY);
      dbSetSetting(EVENT_PEOPLE_MIGRATION_FLAG, '1');
    }
    const all = dbGetAllEventPeopleLinks();
    const stale = staleEventPeopleIds(all, new Date());
    if (stale.length > 0) dbDeleteEventPeopleLinks(stale);
    const rows = all.filter(r => !stale.includes(r.id));
    set({ rows, links: indexEventPeople(rows, get().links.externalIds), loaded: true });

    if (!calendarSubscribed) {
      calendarSubscribed = true;
      useCalendarStore.subscribe((state, prev) => {
        if (state.events !== prev.events || state.pastEvents !== prev.pastEvents) {
          void get().resolveExternalIds([...state.events, ...state.pastEvents]).then(() => get().followMovedEvents());
        }
      });
    }
    const calendar = useCalendarStore.getState();
    void get().resolveExternalIds([...calendar.events, ...calendar.pastEvents]).then(() => get().followMovedEvents());
  },

  followMovedEvents: () => {
    if (isDemoModeActive()) return;
    const calendar = useCalendarStore.getState();
    // An unread window is not an empty one: every future link would look moved.
    if (!calendar.loaded || !calendar.windowStart || !calendar.windowEnd) return;
    const moved = movedPeopleLinks(
      get().rows, calendar.events, get().links.externalIds,
      new Date(calendar.windowStart), new Date(calendar.windowEnd), new Date(),
    );
    if (moved.length === 0) return;
    for (const { row, event } of moved) {
      // Unioned with anyone already on the new slot; the old row goes.
      const people = [...new Set([...peopleForEvent(get().links, event), ...row.personIds])];
      dbDeleteEventPeopleLinks([row.id]);
      const rows = dbGetAllEventPeopleLinks();
      set({ rows, links: indexEventPeople(rows, get().links.externalIds) });
      get().setPeople(event, people);
    }
  },

  resolveExternalIds: async events => {
    const known = get().links.externalIds;
    const missing = [...new Set(events.map(e => e.id))].filter(id => !(id in known));
    if (missing.length === 0) return;
    const found = await readExternalIds(missing);
    if (Object.keys(found).length === 0) return;
    const externalIds = { ...get().links.externalIds, ...found };
    set({ links: indexEventPeople(get().rows, externalIds) });
  },

  peopleFor: event => peopleForEvent(get().links, event),

  setPeople: (event, personIds) => {
    const write = planEventPeopleWrite(get().links, event, personIds, {
      id: generateId(),
      now: new Date().toISOString(),
    });
    if (write.deleteIds.length > 0) dbDeleteEventPeopleLinks(write.deleteIds);
    if (write.upsert) dbUpsertEventPeopleLink(write.upsert);
    const rows = dbGetAllEventPeopleLinks();
    set({ rows, links: indexEventPeople(rows, get().links.externalIds) });
  },

  saveEvent: async (fields, personIds = []) => {
    if (isDemoModeActive()) return null;
    const saved = await saveEventDirect(fields);
    if (!saved) return null;

    if (personIds.length > 0) {
      // The span is what was just written, so there is nothing to read back.
      // The server id is resolved first so the link is keyed the way the
      // other device will look for it.
      await get().resolveExternalIds([{ id: saved.id }]);
      get().setPeople(
        {
          id: saved.id,
          start: fields.start.toISOString(),
          end: fields.end.toISOString(),
          title: fields.title,
        },
        personIds
      );
    }
    void useCalendarStore.getState().refresh();
    return saved;
  },

  updateEvent: async (eventId, before, fields, personIds, occurrenceStart) => {
    if (isDemoModeActive()) return null;
    const id = await updateEventDirect(eventId, fields, occurrenceStart);
    if (!id) return null;
    const old = { id: eventId, start: before.start, end: before.end, title: before.title };
    const moved = id !== eventId || old.start !== fields.start.toISOString();
    if (moved) get().setPeople(old, []);
    get().setPeople(
      { id, start: fields.start.toISOString(), end: fields.end.toISOString(), title: fields.title },
      personIds,
    );
    void useCalendarStore.getState().refresh();
    return id;
  },

  moveEvent: async (event, start, end) => {
    if (isDemoModeActive()) return null;
    const id = await rescheduleEventDirect(event.id, event.title, start, end, event.start);
    if (!id) return null;
    const personIds = peopleForEvent(get().links, event);
    if (personIds.length > 0) {
      get().setPeople(event, []);
      get().setPeople({ id, start: start.toISOString(), end: end.toISOString(), title: event.title }, personIds);
    }
    void useCalendarStore.getState().refresh();
    return id;
  },

  deleteEvent: async (eventId, occurrence) => {
    if (isDemoModeActive()) return false;
    const deleted = await deleteEventDirect(eventId, occurrence.start);
    if (!deleted) return false;
    get().setPeople({ id: eventId, start: occurrence.start, end: occurrence.end, title: occurrence.title }, []);
    void useCalendarStore.getState().refresh();
    return true;
  },
}));
