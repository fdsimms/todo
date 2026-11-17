import { create } from 'zustand';
import type { SavedFocusFilter, SavedFocusSession } from '../types';
import { dbGetSetting, dbSetSetting } from '../db/database';
import { generateId } from '../utils/id';
import {
  MAX_SAVED_FOCUS,
  SAVED_FOCUS_SETTING,
  normalizeSavedFocus,
  parseSavedFocusSessions,
  savedFocusNameTaken,
} from '../utils/savedFocus';
import { useAlarmStore } from './useAlarmStore';

export interface SavedFocusInput {
  /** Set to edit an existing session; absent to add one. */
  id?: string;
  name: string;
  filter: SavedFocusFilter;
  windowMinutes: number | null;
}

/**
 * The focus sessions kept by name, to start when an alarm is turned off
 * (src/utils/savedFocus.ts). Device-local, in one setting, like the alarms
 * that point at them. Held in memory, so demo mode reloads it when the
 * database swaps.
 */
interface SavedFocusStore {
  sessions: SavedFocusSession[];
  initialized: boolean;
  initialize: () => void;
  reload: () => void;
  /** Adds or edits a session. Null when the name is empty or taken, or the list is full. */
  save: (input: SavedFocusInput) => SavedFocusSession | null;
  /** Deletes a session; alarms that offered it stop offering anything. */
  remove: (id: string) => void;
}

function persist(sessions: SavedFocusSession[]): void {
  dbSetSetting(SAVED_FOCUS_SETTING, JSON.stringify(sessions));
}

export const useSavedFocusStore = create<SavedFocusStore>((set, get) => ({
  sessions: [],
  initialized: false,

  initialize() {
    set({ sessions: parseSavedFocusSessions(dbGetSetting(SAVED_FOCUS_SETTING)), initialized: true });
  },

  reload() {
    get().initialize();
  },

  save(input) {
    const existing = input.id ? get().sessions.find(s => s.id === input.id) : undefined;
    const session = normalizeSavedFocus({ ...input, id: existing?.id ?? generateId() });
    if (!session || savedFocusNameTaken(session.name, get().sessions, session.id)) return null;
    if (!existing && get().sessions.length >= MAX_SAVED_FOCUS) return null;
    const sessions = existing
      ? get().sessions.map(s => (s.id === session.id ? session : s))
      : [...get().sessions, session];
    persist(sessions);
    set({ sessions });
    return session;
  },

  remove(id) {
    const sessions = get().sessions.filter(s => s.id !== id);
    persist(sessions);
    set({ sessions });
    useAlarmStore.getState().unlinkSavedFocus(id);
  },
}));
