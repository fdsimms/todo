import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import type { ThemeMode } from '../theme';

export type PatchNoteQaStatus = 'pass' | 'fail';

interface SettingsStore {
  dayResetTime: string;   // "HH:MM" — when the logical day flips (default midnight "00:00")
  morningStart: string;   // "HH:MM" — when morning begins (default "06:00")
  afternoonStart: string; // "HH:MM" — when afternoon begins (default "12:00")
  eveningStart: string;   // "HH:MM" — when evening begins (default "18:00")
  themeMode: ThemeMode;
  anthropicApiKey: string;
  vacationMode: boolean;
  vacationStart: string | null;
  vacationEnd: string | null; // optional ISO date — vacation mode auto-turns-off once this passes
  autoRemoveExpiredTasks: boolean;
  autoArchiveProjectsOnComplete: boolean;
  hideCategories: boolean; // Today's "Hide categories" display option, in Sort & Filter
  pinnedOnlyMode: boolean; // Today's "show only pinned tasks" toggle
  patchNotesQaStatus: Record<string, PatchNoteQaStatus>; // patch note id -> QA result
  initialized: boolean;
  initialize: () => void;
  setDayResetTime: (time: string) => void;
  setMorningStart: (time: string) => void;
  setAfternoonStart: (time: string) => void;
  setEveningStart: (time: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setAnthropicApiKey: (key: string) => void;
  setVacationMode: (on: boolean, endDate?: string | null) => void;
  setVacationEnd: (endDate: string | null) => void;
  setAutoRemoveExpiredTasks: (on: boolean) => void;
  setAutoArchiveProjectsOnComplete: (on: boolean) => void;
  setHideCategories: (on: boolean) => void;
  setPinnedOnlyMode: (on: boolean) => void;
  setPatchNoteQaStatus: (id: string, status: PatchNoteQaStatus | null) => void;
}

export const useSettingsStore = create<SettingsStore>(set => ({
  dayResetTime: '00:00',
  morningStart: '06:00',
  afternoonStart: '12:00',
  eveningStart: '18:00',
  themeMode: 'dark',
  anthropicApiKey: '',
  vacationMode: false,
  vacationStart: null,
  vacationEnd: null,
  autoRemoveExpiredTasks: false,
  autoArchiveProjectsOnComplete: false,
  hideCategories: false,
  pinnedOnlyMode: false,
  patchNotesQaStatus: {},
  initialized: false,

  initialize() {
    const resetTime = dbGetSetting('dayResetTime') ?? '00:00';
    const morningStart = dbGetSetting('morningStart') ?? '06:00';
    const afternoonStart = dbGetSetting('afternoonStart') ?? '12:00';
    const eveningStart = dbGetSetting('eveningStart') ?? '18:00';
    const themeMode = (dbGetSetting('themeMode') as ThemeMode | null) ?? 'dark';
    const anthropicApiKey = dbGetSetting('anthropicApiKey') ?? '';
    const vacationMode = dbGetSetting('vacationMode') === 'true';
    const vacationStart = dbGetSetting('vacationStart') ?? null;
    const vacationEnd = dbGetSetting('vacationEnd') || null;
    const autoRemoveExpiredTasks = dbGetSetting('autoRemoveExpiredTasks') === 'true';
    const autoArchiveProjectsOnComplete = dbGetSetting('autoArchiveProjectsOnComplete') === 'true';
    const hideCategories = dbGetSetting('hideCategories') === 'true';
    const pinnedOnlyMode = dbGetSetting('pinnedOnlyMode') === 'true';
    const storedQaStatus = dbGetSetting('patchNotesQaStatus');
    let patchNotesQaStatus: Record<string, PatchNoteQaStatus> = {};
    if (storedQaStatus) {
      try {
        patchNotesQaStatus = JSON.parse(storedQaStatus);
      } catch {
        patchNotesQaStatus = {};
      }
    }
    set({ dayResetTime: resetTime, morningStart, afternoonStart, eveningStart, themeMode, anthropicApiKey, vacationMode, vacationStart, vacationEnd, autoRemoveExpiredTasks, autoArchiveProjectsOnComplete, hideCategories, pinnedOnlyMode, patchNotesQaStatus, initialized: true });
  },

  setDayResetTime(time: string) {
    dbSetSetting('dayResetTime', time);
    dbSetSetting('morningStart', time);
    set({ dayResetTime: time, morningStart: time });
  },

  setMorningStart(time: string) {
    dbSetSetting('morningStart', time);
    set({ morningStart: time });
  },

  setAfternoonStart(time: string) {
    dbSetSetting('afternoonStart', time);
    set({ afternoonStart: time });
  },

  setEveningStart(time: string) {
    dbSetSetting('eveningStart', time);
    set({ eveningStart: time });
  },

  setThemeMode(mode: ThemeMode) {
    dbSetSetting('themeMode', mode);
    set({ themeMode: mode });
  },

  setAnthropicApiKey(key: string) {
    dbSetSetting('anthropicApiKey', key);
    set({ anthropicApiKey: key });
  },

  setVacationMode(on: boolean, endDate?: string | null) {
    if (on) {
      const start = new Date().toISOString();
      const end = endDate ?? null;
      dbSetSetting('vacationMode', 'true');
      dbSetSetting('vacationStart', start);
      dbSetSetting('vacationEnd', end ?? '');
      set({ vacationMode: true, vacationStart: start, vacationEnd: end });
    } else {
      dbSetSetting('vacationMode', 'false');
      dbSetSetting('vacationEnd', '');
      set({ vacationMode: false, vacationStart: null, vacationEnd: null });
    }
  },

  setVacationEnd(endDate: string | null) {
    dbSetSetting('vacationEnd', endDate ?? '');
    set({ vacationEnd: endDate });
  },

  setAutoRemoveExpiredTasks(on: boolean) {
    dbSetSetting('autoRemoveExpiredTasks', on ? 'true' : 'false');
    set({ autoRemoveExpiredTasks: on });
  },

  setAutoArchiveProjectsOnComplete(on: boolean) {
    dbSetSetting('autoArchiveProjectsOnComplete', on ? 'true' : 'false');
    set({ autoArchiveProjectsOnComplete: on });
  },

  setHideCategories(on: boolean) {
    dbSetSetting('hideCategories', on ? 'true' : 'false');
    set({ hideCategories: on });
  },

  setPinnedOnlyMode(on: boolean) {
    dbSetSetting('pinnedOnlyMode', on ? 'true' : 'false');
    set({ pinnedOnlyMode: on });
  },

  setPatchNoteQaStatus(id: string, status: PatchNoteQaStatus | null) {
    set(state => {
      const next = { ...state.patchNotesQaStatus };
      if (status) {
        next[id] = status;
      } else {
        delete next[id];
      }
      dbSetSetting('patchNotesQaStatus', JSON.stringify(next));
      return { patchNotesQaStatus: next };
    });
  },
}));
