import { create } from 'zustand';
import type { BusyEvent } from '../utils/calendarBusy';
import {
  type EventPeopleLinks,
  parseEventPeople,
  peopleForEvent,
  pruneStaleEventPeople,
  withEventPeople,
} from '../utils/eventPeople';
import { presentEventCreate, readTimeBlockEvent } from '../utils/calendarSync';
import { isDemoModeActive } from '../utils/demoState';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { useCalendarStore } from './useCalendarStore';

/**
 * Device-local, like `calendarHistoryHandled`: it names EventKit ids. Kept out
 * of sync (`syncTracking.ts`, an allowlist it is deliberately absent from) and
 * out of backups (`DEVICE_ID_SETTING_KEYS` in `backup.ts`).
 */
export const EVENT_PEOPLE_SETTING_KEY = 'calendarEventPeople';

function persist(links: EventPeopleLinks): void {
  dbSetSetting(EVENT_PEOPLE_SETTING_KEY, JSON.stringify(links));
}

interface EventPeopleState {
  links: EventPeopleLinks;
  loaded: boolean;
  /** Loads the stored links and drops any past the history window. */
  initialize: () => void;
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
  links: {},
  loaded: false,

  initialize: () => {
    const pruned = pruneStaleEventPeople(parseEventPeople(dbGetSetting(EVENT_PEOPLE_SETTING_KEY)), new Date());
    persist(pruned);
    set({ links: pruned, loaded: true });
  },

  peopleFor: event => peopleForEvent(get().links, event),

  setPeople: (event, personIds) => {
    const links = withEventPeople(get().links, event, personIds);
    persist(links);
    set({ links });
  },

  createEvent: async (fields, personIds = []) => {
    if (isDemoModeActive()) return false;
    const result = await presentEventCreate(fields);
    if (!result.saved) return false;

    if (result.eventId && personIds.length > 0) {
      // Read back rather than trusting the prefill: the sheet let the user
      // move it, and the link is keyed on the start they actually saved.
      const saved = await readTimeBlockEvent(result.eventId);
      if (saved) {
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
