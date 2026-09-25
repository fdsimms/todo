import { create } from 'zustand';
import type { BusyEvent } from '../utils/calendarBusy';
import {
  EMPTY_EVENT_PEOPLE,
  type EventPeopleIndex,
  indexEventPeople,
  legacyEventPeopleRows,
  peopleForEvent,
  planEventPeopleWrite,
  staleEventPeopleIds,
} from '../utils/eventPeople';
import type { EventPeopleLink } from '../types';
import { presentEventCreate, readTimeBlockEvent } from '../utils/calendarSync';
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
  peopleFor: (event: Pick<BusyEvent, 'id' | 'start'>) => string[];
  setPeople: (event: Pick<BusyEvent, 'id' | 'start' | 'end' | 'title'>, personIds: readonly string[]) => void;
  /**
   * Opens the system new-event sheet and, once the user saves, links the event
   * to `personIds`. Resolves true when an event was saved.
   *
   * **Off in demo mode**: the event would land in the real calendar, which is
   * exactly the write outside the demo database `CLAUDE.md` rules out. The
   * time block's own create makes the same refusal.
   */
  createEvent: (
    fields: { title: string; start: Date; end: Date; location?: string },
    personIds?: readonly string[]
  ) => Promise<boolean>;
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
          void get().resolveExternalIds([...state.events, ...state.pastEvents]);
        }
      });
    }
    const calendar = useCalendarStore.getState();
    void get().resolveExternalIds([...calendar.events, ...calendar.pastEvents]);
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

  createEvent: async (fields, personIds = []) => {
    if (isDemoModeActive()) return false;
    const result = await presentEventCreate(fields);
    if (!result.saved) return false;

    if (result.eventId && personIds.length > 0) {
      // Read back rather than trusting the prefill: the sheet let the user
      // move it, and the link is keyed on the start they actually saved. The
      // server id is read first, so the link is written under the key the
      // other device will look for.
      const saved = await readTimeBlockEvent(result.eventId);
      if (saved) {
        await get().resolveExternalIds([{ id: result.eventId }]);
        get().setPeople(
          {
            id: result.eventId,
            start: saved.start.toISOString(),
            end: saved.end.toISOString(),
            title: saved.title,
          },
          personIds
        );
      }
    }
    // So the new event shows on Today, the calendar and the person's screen
    // without waiting for the next foreground.
    void useCalendarStore.getState().refresh();
    return true;
  },
}));
