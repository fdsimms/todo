import { create } from 'zustand';
import type { BusyEvent } from '../utils/calendarBusy';
import {
  type EventTaskLinks,
  parseEventTaskLinks,
  pruneStaleEventTaskLinks,
  rekeyEventTasks,
  withEventTasks,
} from '../utils/eventTaskLinks';
import { dbGetSetting, dbSetSetting } from '../db/database';

/**
 * Device-local for `calendarEventPeople`'s reason: it names EventKit ids. Out
 * of sync (absent from the allowlist in `syncTracking.ts`) and out of backups
 * (`DEVICE_ID_SETTING_KEYS`).
 */
export const EVENT_TASK_LINKS_SETTING_KEY = 'calendarEventTasks';

function persist(links: EventTaskLinks): void {
  dbSetSetting(EVENT_TASK_LINKS_SETTING_KEY, JSON.stringify(links));
}

type EventFields = Pick<BusyEvent, 'id' | 'start' | 'end' | 'title'>;

interface EventTaskLinkState {
  links: EventTaskLinks;
  loaded: boolean;
  initialize: () => void;
  /** Records tasks as planned around an occurrence. */
  addTasks: (event: EventFields, taskIds: readonly string[]) => void;
  /** Moves a link onto where the event now sits, after the move offer is answered. */
  rekey: (oldKey: string, event: EventFields) => void;
}

export const useEventTaskLinkStore = create<EventTaskLinkState>((set, get) => ({
  links: {},
  loaded: false,

  initialize: () => {
    const pruned = pruneStaleEventTaskLinks(
      parseEventTaskLinks(dbGetSetting(EVENT_TASK_LINKS_SETTING_KEY)),
      new Date()
    );
    persist(pruned);
    set({ links: pruned, loaded: true });
  },

  addTasks: (event, taskIds) => {
    if (taskIds.length === 0) return;
    const links = withEventTasks(get().links, event, taskIds);
    persist(links);
    set({ links });
  },

  rekey: (oldKey, event) => {
    if (!(oldKey in get().links)) return;
    const links = rekeyEventTasks(get().links, oldKey, event);
    persist(links);
    set({ links });
  },
}));
