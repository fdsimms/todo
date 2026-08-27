import { create } from 'zustand';
import type { BusyEvent } from '../utils/calendarBusy';
import {
  type HiddenEvent,
  hiddenEventKey,
  hiddenEventFromEvent,
  pruneStaleHiddenEvents,
} from '../utils/hiddenEvents';
import { dbGetSetting, dbSetSetting } from '../db/database';

const SETTINGS_KEY = 'hidden_calendar_events';

function load(): Record<string, HiddenEvent> {
  const raw = dbGetSetting(SETTINGS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function persist(hiddenByKey: Record<string, HiddenEvent>): void {
  dbSetSetting(SETTINGS_KEY, JSON.stringify(hiddenByKey));
}

interface HiddenEventsState {
  hiddenByKey: Record<string, HiddenEvent>;
  loaded: boolean;
  /** Loads the persisted map and drops anything for an occurrence that's over. */
  initialize: () => void;
  isHidden: (event: Pick<BusyEvent, 'id' | 'start'>) => boolean;
  hideEvent: (event: BusyEvent) => void;
  unhideEvent: (event: Pick<BusyEvent, 'id' | 'start'>) => void;
}

export const useHiddenEventsStore = create<HiddenEventsState>((set, get) => ({
  hiddenByKey: {},
  loaded: false,

  initialize: () => {
    const pruned = pruneStaleHiddenEvents(load(), new Date());
    persist(pruned);
    set({ hiddenByKey: pruned, loaded: true });
  },

  isHidden: event => hiddenEventKey(event) in get().hiddenByKey,

  hideEvent: event => {
    const hidden = hiddenEventFromEvent(event);
    const hiddenByKey = { ...get().hiddenByKey, [hidden.key]: hidden };
    persist(hiddenByKey);
    set({ hiddenByKey });
  },

  unhideEvent: event => {
    const key = hiddenEventKey(event);
    if (!(key in get().hiddenByKey)) return;
    const hiddenByKey = { ...get().hiddenByKey };
    delete hiddenByKey[key];
    persist(hiddenByKey);
    set({ hiddenByKey });
  },
}));
