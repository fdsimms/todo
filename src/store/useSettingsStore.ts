import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import type { ThemeMode } from '../theme';

interface SettingsStore {
  dayResetTime: string;   // "HH:MM" — when the logical day flips (default midnight "00:00")
  morningStart: string;   // "HH:MM" — when morning begins (default "06:00")
  afternoonStart: string; // "HH:MM" — when afternoon begins (default "12:00")
  eveningStart: string;   // "HH:MM" — when evening begins (default "18:00")
  themeMode: ThemeMode;
  anthropicApiKey: string;
  vacationMode: boolean;
  vacationStart: string | null;
  initialized: boolean;
  initialize: () => void;
  setDayResetTime: (time: string) => void;
  setMorningStart: (time: string) => void;
  setAfternoonStart: (time: string) => void;
  setEveningStart: (time: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setAnthropicApiKey: (key: string) => void;
  setVacationMode: (on: boolean) => void;
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
    set({ dayResetTime: resetTime, morningStart, afternoonStart, eveningStart, themeMode, anthropicApiKey, vacationMode, vacationStart, initialized: true });
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

  setVacationMode(on: boolean) {
    if (on) {
      const start = new Date().toISOString();
      dbSetSetting('vacationMode', 'true');
      dbSetSetting('vacationStart', start);
      set({ vacationMode: true, vacationStart: start });
    } else {
      dbSetSetting('vacationMode', 'false');
      set({ vacationMode: false, vacationStart: null });
    }
  },
}));
