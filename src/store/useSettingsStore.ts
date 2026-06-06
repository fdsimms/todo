import { create } from 'zustand';
import { dbGetSetting, dbSetSetting } from '../db/database';
import type { ThemeMode } from '../theme';

interface SettingsStore {
  dayResetTime: string; // "HH:MM" — when the logical day flips (default midnight "00:00")
  themeMode: ThemeMode;
  initialized: boolean;
  initialize: () => void;
  setDayResetTime: (time: string) => void;
  setThemeMode: (mode: ThemeMode) => void;
}

export const useSettingsStore = create<SettingsStore>(set => ({
  dayResetTime: '00:00',
  themeMode: 'dark',
  initialized: false,

  initialize() {
    const resetTime = dbGetSetting('dayResetTime') ?? '00:00';
    const themeMode = (dbGetSetting('themeMode') as ThemeMode | null) ?? 'dark';
    set({ dayResetTime: resetTime, themeMode, initialized: true });
  },

  setDayResetTime(time: string) {
    dbSetSetting('dayResetTime', time);
    set({ dayResetTime: time });
  },

  setThemeMode(mode: ThemeMode) {
    dbSetSetting('themeMode', mode);
    set({ themeMode: mode });
  },
}));
